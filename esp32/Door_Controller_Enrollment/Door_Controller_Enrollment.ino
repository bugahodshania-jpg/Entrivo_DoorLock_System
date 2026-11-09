#include <WiFi.h>
// Keep hardware dependencies visible to Arduino's incremental library discovery.
#include <Wire.h>
#include <RTClib.h>
#include "Config.h"
#include "API.h"
#include "DoorHardware.h"
#include "DoorStatus.h"
#include "Fingerprint.h"
#include "SensorMemory.h"
#include "Rfid.h"
#include "WiFiManager.h"
#include "SerialLog.h"

namespace {
    bool sensorReady = false;
    bool waitingForFingerRemoval = true;
    bool fingerprintExitArmed = false;
    bool previousDoorState = false;
    unsigned long lastSensorAttemptAt = 0;
    unsigned long lastJobPollAt = 0;
    unsigned long lastAccessScanAt = 0;
    unsigned long fingerprintExitArmedAt = 0;
    // Sensor slot of the finger that unlocked the door (0 = not unlocked by a
    // fingerprint). Touch-then-fingerprint locking accepts only that finger.
    uint16_t unlockedByFingerSlot = 0;
    // 15-minute reminder (track 5) for the schedule the room was opened on.
    bool reminderArmed = false;
    unsigned long reminderAt = 0;

    // Voice prompt for a refusal, from the backend's reason code.
    uint16_t deniedTrack(const String &reason) {
        if (reason == "not_registered") return AUDIO_NOT_REGISTERED;
        if (reason == "no_schedule" || reason == "schedule_not_started") return AUDIO_OUTSIDE_SCHEDULE;
        if (reason == "expired_schedule") return AUDIO_SCHEDULE_EXPIRED;
        return AUDIO_ACCESS_DENIED;
    }

    // Voice prompt for a granted entry: an approved override has its own track.
    uint16_t entryTrack(const DoorDecision &decision) {
        return decision.scheduleKind == "override" ? AUDIO_OVERRIDE_APPROVED : AUDIO_ACCESS_GRANTED;
    }

    // Plan the reminder 15 minutes before the schedule ends. With several
    // entries the latest end wins; under 15 minutes left there is no reminder.
    void armReminder(long secondsRemaining) {
        constexpr long REMINDER_LEAD_S = 15L * 60L;
        if (secondsRemaining <= REMINDER_LEAD_S) return;
        const unsigned long at = millis() + static_cast<unsigned long>(secondsRemaining - REMINDER_LEAD_S) * 1000UL;
        if (!reminderArmed || static_cast<long>(at - reminderAt) > 0) {
            reminderAt = at;
            reminderArmed = true;
            SerialLog::step("15-minute reminder in " + String((secondsRemaining - REMINDER_LEAD_S) / 60) + " min.");
        }
    }

    void serviceReminder() {
        if (reminderArmed && static_cast<long>(millis() - reminderAt) >= 0) {
            reminderArmed = false;
            SerialLog::step("Reminder: 15 minutes left in the scheduled session.");
            playTrack(AUDIO_REMINDER);
        }
    }

    void printStatus() {
        SerialLog::section("DOOR CONTROLLER STATUS");
        SerialLog::kv("Door", isDoorUnlocked() ? "UNLOCKED" : "LOCKED");
        SerialLog::kv("EXIT touch armed", isExitAuthorized() ? "yes" : "no");
        SerialLog::kv("Fingerprint exit", fingerprintExitArmed ? "waiting for a finger" : "touch after the door is unlocked");
        SerialLog::kv("Locking finger", unlockedByFingerSlot ? "sensor slot " + String(unlockedByFingerSlot) : String("any registered finger"));
        SerialLog::kv("Fingerprint sensor", sensorReady ? "ready" : "UNAVAILABLE");
        SerialLog::kv("WiFi", WiFi.status() == WL_CONNECTED ? String("connected (") + WiFi.localIP().toString() + ")"
                              : isWiFiConnecting() ? String("connecting...") : String("OFFLINE"));
        SerialLog::kv("Backend", SERVER_URL);
        SerialLog::kv("Device token", String(DOOR_DEVICE_TOKEN).length() ? "configured" : "MISSING - set Config.h and backend/.env");
        SerialLog::kv("Enrollment device", String(ENROLLMENT_DEVICE_ID));
        SerialLog::blank();
        SerialLog::step("Registered identities and schedules are verified by the backend.");
        SerialLog::step("Serial commands: M = status, T = RTC time, L = lock.");
        if (!sensorReady) SerialLog::debug("Sensor unavailable: check the R307S wiring/power. It is retried automatically.");
        if (WiFi.status() != WL_CONNECTED && !isWiFiConnecting()) SerialLog::debug("WiFi offline: check WIFI_SSID / WIFI_PASSWORD in Config.h.");
        SerialLog::blank();
    }

    void readSerialCommands() {
        while (Serial.available() > 0) {
            const char command = Serial.read();
            if (command == 'm' || command == 'M') printStatus();
            else if (command == 't' || command == 'T') { printDeviceTime(); Serial.println(); }
            else if (command == 'l' || command == 'L') lockDoorRelay();
        }
    }

    void discardBufferedScans() {
        waitingForFingerRemoval = true;
        fingerprintExitArmed = false;
        resetRfidReaders();
    }

    bool scanRfid() {
        String uid;
        bool isExit = false;
        if (!pollRfidReader(uid, isExit)) return false;
        SerialLog::section(String("DOOR ACCESS  RFID ") + (isExit ? "EXIT" : "ENTRY"));
        SerialLog::kv("Card UID", uid);
        String message;
        DoorDecision decision;
        const bool granted = authorizeRfid(uid, isExit, message, &decision);
        const bool lockedIn = isExit && !isDoorUnlocked();
        SerialLog::result(granted, granted
            ? (lockedIn ? "Exit approved, door unlocked so you can leave. Touch outside to lock"
                : isExit ? "Exit approved, touch to lock" : "Access granted, door unlocked")
            : "Access denied", message);
        if (!granted) playDeniedFeedback(deniedTrack(decision.reason));
        else if (isExit) {
            // The exit reader is inside: a locked door is opened only to let
            // this user out, then touch outside locks it again.
            if (lockedIn) openDoorRelay(AUDIO_DOOR_UNLOCK);
            authorizeExit();
        }
        else {
            openDoorRelay(entryTrack(decision));
            unlockedByFingerSlot = 0;
            armReminder(decision.secondsRemaining);
        }
        discardBufferedScans();
        return true;
    }

    void retryFingerprintConnection() {
        sensorReady = false;
        lastSensorAttemptAt = millis();
        waitingForFingerRemoval = true;
        SerialLog::fail("Fingerprint communication lost. RFID remains available; retrying the sensor.");
        SerialLog::debug("Check the R307S TX/RX wires and power. A loose wire gives 0x01 / 0xFE / 0xFF.");
    }

    void scanFingerprint(bool isExit) {
        const uint8_t imageStatus = finger.getImage();
        if (DoorFingerprintSearch::communicationError(imageStatus)) {
            logFingerprintStatus("image", imageStatus);
            retryFingerprintConnection();
            return;
        }
        if (imageStatus == FINGERPRINT_NOFINGER) {
            waitingForFingerRemoval = false;
            return;
        }
        if (waitingForFingerRemoval) return;
        waitingForFingerRemoval = true;
        SerialLog::clearStatus();
        SerialLog::section(String("DOOR ACCESS  FINGERPRINT ") + (isExit ? "EXIT" : "ENTRY"));
        if (imageStatus != FINGERPRINT_OK) {
            logFingerprintStatus("image", imageStatus);
            SerialLog::result(false, "Fingerprint could not be read", "Remove your finger and try again.");
            playDeniedFeedback();
            return;
        }
        bool fingerLifted = false;
        const DoorFingerprintSearch::Result match = identifySettledFingerprintForAccess(fingerLifted);
        if (fingerLifted) {
            SerialLog::step("Finger lifted before the scan settled. Nothing was checked.");
            SerialLog::blank();
            waitingForFingerRemoval = false;
            return;
        }
        if (match.outcome != DoorFingerprintSearch::Outcome::Matched) {
            if (match.outcome == DoorFingerprintSearch::Outcome::CommunicationError &&
                match.standardStatus != 0xFE) retryFingerprintConnection();
            SerialLog::result(false, "Fingerprint not recognized by Sensor A",
                "No stored slot matched this finger. Door stays locked.");
            playDeniedFeedback(match.outcome == DoorFingerprintSearch::Outcome::NoMatch ? AUDIO_NOT_REGISTERED : AUDIO_ACCESS_DENIED);
            // Only a completed search with no match is an unregistered finger;
            // sensor or communication errors are not reported as a person.
            if (match.outcome == DoorFingerprintSearch::Outcome::NoMatch) reportUnrecognizedFingerprint(isExit);
            return;
        }
        SerialLog::kv("Matched slot", String(match.matchedSlot) + " (confidence " + String(match.confidence) + ")");
        if (isExit && unlockedByFingerSlot != 0 && match.matchedSlot != unlockedByFingerSlot) {
            // Locking after a fingerprint entry needs the exact finger that unlocked.
            SerialLog::result(false, "Wrong finger: the door stays unlocked",
                "Lock with the same finger that unlocked the door (sensor slot " + String(unlockedByFingerSlot)
                + "). Touch the sensor again, then scan that finger.");
            playDeniedFeedback();
            fingerprintExitArmed = false;
            return;
        }
        String message;
        bool exitOnly = false;
        DoorDecision decision;
        const bool granted = authorizeMatchedFingerprint(match.matchedSlot, message, isExit, &exitOnly, &decision);
        SerialLog::result(granted, granted
            ? (isExit ? "Exit granted, door locked"
                : exitOnly ? "Exit only: door unlocked so you can leave. Touch outside to lock"
                : "Access granted, door unlocked")
            : "Access denied by backend", message);
        if (!granted && message.indexOf("not linked") >= 0)
            SerialLog::debug("Slot " + String(match.matchedSlot) + " has no database fingerprint. Delete it in Sensor Memory or re-enroll.");
        if (granted) {
            if (isExit) lockDoorRelay(AUDIO_ROOM_LOCKED);
            else if (exitOnly) {
                // Schedule over but the user is still inside: open only so
                // they can leave, with touch-to-lock armed behind them.
                openDoorRelay(AUDIO_DOOR_UNLOCK);
                authorizeExit();
                unlockedByFingerSlot = 0;
            }
            else {
                openDoorRelay(entryTrack(decision));
                unlockedByFingerSlot = match.matchedSlot;
                armReminder(decision.secondsRemaining);
                SerialLog::step("To lock: touch the sensor, then scan this same finger (slot " + String(unlockedByFingerSlot) + ").");
            }
            discardBufferedScans();
        } else playDeniedFeedback(deniedTrack(decision.reason));
    }
}

void setup() {
    // Set both relay outputs LOW before serial, sensor, or network initialization.
    initDoorHardware();
    Serial.begin(115200);
    delay(50);
    SerialLog::section("ENTRIVO DOOR CONTROLLER  BOOT");
    SerialLog::step("Combined door controller and fingerprint enrollment starting.");
    initDoorFeedback();
    sensorReady = initFingerprint();
    lastSensorAttemptAt = millis();
    initRfidReaders();
    SerialLog::step("RFID readers ready.");
    connectWiFi();
    initDoorStatus(isDoorUnlocked());
    printStatus();
}

void loop() {
    updateDoorHardware();
    serviceReminder();
    readSerialCommands();
    if (previousDoorState != isDoorUnlocked()) {
        previousDoorState = isDoorUnlocked();
        if (!previousDoorState) {
            unlockedByFingerSlot = 0;
            reminderArmed = false; // The room was locked: the session is over.
        }
        if (previousDoorState) interruptSensorMemoryRead();
        discardBufferedScans();
    }

    // Once EXIT is approved, no network or sensor operation can delay touch-to-lock.
    if (isDoorUnlocked() && isExitAuthorized()) { delay(2); return; }
    ensureWiFiConnected();
    serviceDoorStatus();
    if (isDoorUnlocked()) {
        scanRfid(); // Student exit card arms the outside touch. It does not lock by itself.
        if (consumeFingerprintExitTouch()) {
            fingerprintExitArmed = true;
            fingerprintExitArmedAt = millis();
            waitingForFingerRemoval = true;
        }
        if (fingerprintExitArmed && millis() - fingerprintExitArmedAt >= FINGERPRINT_EXIT_WINDOW_MS) {
            fingerprintExitArmed = false;
            waitingForFingerRemoval = true;
            SerialLog::warn("[TOUCH] Fingerprint exit timed out. The door stays unlocked.");
        }
        if (!sensorReady && millis() - lastSensorAttemptAt >= SENSOR_RETRY_INTERVAL_MS) {
            lastSensorAttemptAt = millis();
            sensorReady = initFingerprint();
            waitingForFingerRemoval = true;
        }
        if (sensorReady && fingerprintExitArmed && millis() - lastAccessScanAt >= ACCESS_SCAN_INTERVAL_MS) {
            lastAccessScanAt = millis();
            scanFingerprint(true);
        }
        delay(2);
        return;
    }

    const unsigned long now = millis();
    if (!sensorReady && now - lastSensorAttemptAt >= SENSOR_RETRY_INTERVAL_MS) {
        lastSensorAttemptAt = now;
        sensorReady = initFingerprint();
        discardBufferedScans();
    }

    // Retry pending results even if the sensor was disconnected after storing the model.
    if ((sensorReady || isFingerprintWorkPending()) && now - lastJobPollAt >= ENROLLMENT_POLL_INTERVAL_MS) {
        const bool handled = checkPendingDirectImport() || checkPendingEnrollment();
        lastJobPollAt = millis();
        if (handled) { interruptSensorMemoryRead(); discardBufferedScans(); return; }
    }
    if (isFingerprintWorkPending()) { delay(2); return; }

    if (serviceSensorMemory(sensorReady)) { discardBufferedScans(); delay(2); return; }

    if (scanRfid()) return;
    if (sensorReady && millis() - lastAccessScanAt >= ACCESS_SCAN_INTERVAL_MS) {
        lastAccessScanAt = millis();
        scanFingerprint(false);
    }
    delay(2);
}

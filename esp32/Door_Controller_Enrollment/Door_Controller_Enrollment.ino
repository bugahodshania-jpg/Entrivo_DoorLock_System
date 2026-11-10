#include <WiFi.h>
#include <esp_system.h>
// Keep hardware dependencies visible to Arduino's incremental library discovery.
#include <Wire.h>
#include <RTClib.h>
#include <Preferences.h>
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
    // Backend user who unlocked the door (0 = unknown). A locking fingerprint
    // from anyone else is refused by the backend, even after a card entry.
    uint32_t unlockedByUserId = 0;
    // 15-minute reminder (track 5) for the schedule the room was opened on.
    bool reminderArmed = false;
    unsigned long reminderAt = 0;

    // Who may lock the door with touch + fingerprint; survives a restart.
    void rememberUnlocker(uint16_t fingerSlot, uint32_t userId) {
        unlockedByFingerSlot = fingerSlot;
        unlockedByUserId = userId;
        saveUnlockSlot(fingerSlot);
        saveUnlockUser(userId);
    }

    // Voice prompt for a refusal, from the backend's reason code.
    uint16_t deniedTrack(const String &reason) {
        if (reason == "not_registered") return AUDIO_NOT_REGISTERED;
        if (reason == "no_schedule" || reason == "schedule_not_started") return AUDIO_OUTSIDE_SCHEDULE;
        if (reason == "expired_schedule") return AUDIO_SCHEDULE_EXPIRED;
        return AUDIO_ACCESS_DENIED;
    }

    // Voice prompt for a granted entry: an approved override and an admin's
    // permanent override use the override track.
    uint16_t entryTrack(const DoorDecision &decision) {
        return decision.scheduleKind == "override" || decision.scheduleKind == "permanent_override"
            ? AUDIO_OVERRIDE_APPROVED : AUDIO_ACCESS_GRANTED;
    }

    // Plan the reminder 15 minutes before the schedule ends. With several
    // entries the latest end wins; under 15 minutes left there is no reminder.
    constexpr long REMINDER_LEAD_S = 15L * 60L;

    void armReminder(long secondsRemaining) {
        if (secondsRemaining <= REMINDER_LEAD_S) return;
        const long untilReminder = secondsRemaining - REMINDER_LEAD_S;
        const unsigned long at = millis() + static_cast<unsigned long>(untilReminder) * 1000UL;
        if (!reminderArmed || static_cast<long>(at - reminderAt) > 0) {
            reminderAt = at;
            reminderArmed = true;
            // Also kept in NVS as an RTC moment, so a restart keeps the reminder.
            const uint32_t now = rtcSeconds();
            saveReminderAt(now ? now + static_cast<uint32_t>(untilReminder) : 0);
            SerialLog::step("15-minute reminder in " + String(untilReminder / 60) + " min.");
        }
    }

    void cancelReminder() {
        reminderArmed = false;
        saveReminderAt(0);
    }

    void playReminder() {
        cancelReminder();
        SerialLog::step("Reminder: 15 minutes left in the scheduled session.");
        playTrack(AUDIO_REMINDER);
    }

    void serviceReminder() {
        if (reminderArmed && static_cast<long>(millis() - reminderAt) >= 0) playReminder();
    }

    // After a restart with the door still unlocked: re-arm the saved reminder
    // from the RTC. If its moment passed while the board was restarting but the
    // schedule has not ended yet (less than 15 min late), play it right away.
    void restoreReminder() {
        const uint32_t savedAt = restoredReminderAt();
        const uint32_t now = rtcSeconds();
        if (savedAt == 0) return;
        if (now == 0) {
            SerialLog::warn("RTC unavailable: the 15-minute reminder could not be restored after the restart.");
            cancelReminder();
            return;
        }
        const long untilReminder = static_cast<long>(savedAt - now);
        if (untilReminder > 24L * 3600L || untilReminder <= -REMINDER_LEAD_S) { cancelReminder(); return; }
        if (untilReminder <= 0) { playReminder(); return; }
        reminderAt = millis() + static_cast<unsigned long>(untilReminder) * 1000UL;
        reminderArmed = true;
        SerialLog::step("15-minute reminder restored: in " + String(untilReminder / 60) + " min.");
    }

    void printStatus() {
        SerialLog::section("DOOR CONTROLLER STATUS");
        SerialLog::kv("Door", isDoorUnlocked() ? "UNLOCKED" : "LOCKED");
        SerialLog::kv("Relay pin", relayPinIsActive() ? "ON (unlock level)" : "OFF (lock level)");
        SerialLog::kv("EXIT touch armed", isExitAuthorized() ? "yes" : "no");
        SerialLog::kv("Fingerprint exit", fingerprintExitArmed ? "waiting for a finger" : "touch after the door is unlocked");
        SerialLog::kv("Locking finger", unlockedByFingerSlot ? "sensor slot " + String(unlockedByFingerSlot)
            : unlockedByUserId ? "any finger of user " + String(unlockedByUserId) : String("any registered finger"));
        SerialLog::kv("Fingerprint sensor", sensorReady ? "ready" : "UNAVAILABLE");
        SerialLog::kv("WiFi", WiFi.status() == WL_CONNECTED ? String("connected (") + WiFi.localIP().toString() + ")"
                              : isWiFiConnecting() ? String("connecting...") : String("OFFLINE"));
        SerialLog::kv("Backend", SERVER_URL);
        SerialLog::kv("Device token", String(DOOR_DEVICE_TOKEN).length() ? "configured" : "MISSING - set Config.h and backend/.env");
        SerialLog::kv("Enrollment device", String(ENROLLMENT_DEVICE_ID));
        SerialLog::blank();
        SerialLog::step("Registered identities and schedules are verified by the backend.");
        SerialLog::step("Serial commands: M = status, T = RTC time, L = lock, U = unlock (relay test).");
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
            else if (command == 'u' || command == 'U') {
                // Hardware test: drive the relay without a credential.
                Serial.println("[TEST] U: unlocking from the Serial Monitor (relay test). Type L to lock.");
                if (isDoorUnlocked()) Serial.println("[TEST] The firmware already thinks the door is UNLOCKED. Type L first, then U.");
                openDoorRelay(AUDIO_DOOR_UNLOCK);
            }
        }
    }

    bool isOfflineAccessCard(const String &uid) {
        const String card(OFFLINE_ACCESS_CARD_UID);
        return card.length() == 10 && uid.equalsIgnoreCase(card);
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
        bool backendUnreachable = false;
        bool granted = authorizeRfid(uid, isExit, message, &decision, &backendUnreachable);
        if (!granted && backendUnreachable && isOfflineAccessCard(uid)) {
            // Connection lost: the emergency card works locally, same in/out process.
            granted = true;
            decision = DoorDecision{};
            message = "Backend unreachable: emergency access card accepted locally (not logged).";
            SerialLog::warn("[OFFLINE] Emergency access card " + uid + " used without the backend.");
        }
        else if (!granted && backendUnreachable && isExit) {
            // Nobody may be trapped by an outage. The exit reader is inside the
            // room and registered cards cannot be checked offline, so any card
            // here opens the door to leave and arms touch-to-lock. Never entry.
            granted = true;
            decision = DoorDecision{};
            message = "Backend unreachable: exit allowed locally (not logged).";
            SerialLog::warn("[OFFLINE] Exit reader used without the backend. Card " + uid + ".");
        }
        const bool lockedIn = isExit && !isDoorUnlocked();
        const bool alreadyOpen = !isExit && isDoorUnlocked();
        SerialLog::result(granted, granted
            ? (lockedIn ? "Exit approved, door unlocked so you can leave. Touch outside to lock"
                : isExit ? "Exit approved, touch to lock"
                : alreadyOpen ? "Entry recorded, the door is already unlocked"
                : "Access granted, door unlocked")
            : "Access denied", message);
        if (!granted) playDeniedFeedback(deniedTrack(decision.reason));
        else if (isExit) {
            // The exit reader is inside: a locked door is opened only to let
            // this user out, then touch outside locks it again.
            if (lockedIn) {
                openDoorRelay(AUDIO_DOOR_UNLOCK);
                rememberUnlocker(0, decision.userId);
            }
            authorizeExit();
        }
        else if (alreadyOpen) {
            // Arrival through an open door (e.g. the instructor is inside): it is
            // logged by the backend; the lock state and locking finger stay as they are.
            playTrack(entryTrack(decision));
            armReminder(decision.secondsRemaining);
        }
        else {
            openDoorRelay(entryTrack(decision));
            // Card entry: touch + any finger of this same user locks.
            rememberUnlocker(0, decision.userId);
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
        bool backendUnreachable = false;
        bool granted = authorizeMatchedFingerprint(match.matchedSlot, message, isExit, &exitOnly, &decision, unlockedByUserId, &backendUnreachable);
        if (!granted && backendUnreachable && isExit && unlockedByFingerSlot != 0) {
            // Connection lost: the slot check above already proved this is the
            // finger that unlocked the door, so it may lock without the backend.
            granted = true;
            message = "Backend unreachable: same finger confirmed locally (not logged).";
            SerialLog::warn("[OFFLINE] Door locked by the finger that unlocked it, without the backend.");
        }
        SerialLog::result(granted, granted
            ? (isExit ? "Exit granted, door locked"
                : exitOnly ? "Exit only: door unlocked so you can leave. Touch outside to lock"
                : "Access granted, door unlocked")
            : isExit ? "Lock refused: the door stays unlocked" : "Access denied by backend", message);
        // A refused lock ends this attempt: touch again, then scan the right finger.
        if (!granted && isExit) fingerprintExitArmed = false;
        if (!granted && message.indexOf("not linked") >= 0)
            SerialLog::debug("Slot " + String(match.matchedSlot) + " has no database fingerprint. Delete it in Sensor Memory or re-enroll.");
        if (granted) {
            if (isExit) lockDoorRelay(AUDIO_ROOM_LOCKED);
            else if (exitOnly) {
                // Schedule over but the user is still inside: open only so
                // they can leave, with touch-to-lock armed behind them.
                openDoorRelay(AUDIO_DOOR_UNLOCK);
                authorizeExit();
                rememberUnlocker(0, decision.userId);
            }
            else {
                openDoorRelay(entryTrack(decision));
                rememberUnlocker(match.matchedSlot, decision.userId);
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
    const esp_reset_reason_t resetReason = esp_reset_reason();
    SerialLog::kv("Last restart", resetReason == ESP_RST_BROWNOUT ? "BROWNOUT (power dip, e.g. WiFi current spike)"
        : resetReason == ESP_RST_POWERON ? "power on"
        : resetReason == ESP_RST_SW ? "software restart"
        : (resetReason == ESP_RST_PANIC || resetReason == ESP_RST_INT_WDT || resetReason == ESP_RST_TASK_WDT || resetReason == ESP_RST_WDT)
            ? "crash / watchdog" : "other (" + String(static_cast<int>(resetReason)) + ")");
    if (doorWasRestoredUnlocked()) {
        // The relay was re-energized in initDoorHardware(); keep the finger that opened it.
        unlockedByFingerSlot = restoredUnlockSlot();
        unlockedByUserId = restoredUnlockUser();
        SerialLog::warn("Door was UNLOCKED before the restart: it stays unlocked (solenoid re-opened)."
            + String(unlockedByFingerSlot ? " Locking finger: slot " + String(unlockedByFingerSlot) + "." : ""));
    }
    previousDoorState = isDoorUnlocked();
    initDoorFeedback();
    // Needs the RTC (started in initDoorFeedback) to measure the restart gap.
    if (doorWasRestoredUnlocked()) restoreReminder();
    else saveReminderAt(0);
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
            rememberUnlocker(0, 0); // Locked: clear the current occupant.
            cancelReminder(); // The room was locked: the session is over.
        }
        if (previousDoorState) interruptSensorMemoryRead();
        discardBufferedScans();
    }

    // Once EXIT is approved, only door status reports (short, so the portal keeps
    // showing the real state) may use the network. A tap during one is latched.
    if (isDoorUnlocked() && isExitAuthorized()) { serviceDoorStatus(true); delay(2); return; }
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

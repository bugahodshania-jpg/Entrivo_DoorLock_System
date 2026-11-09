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

    void printStatus() {
        SerialLog::section("DOOR CONTROLLER STATUS");
        SerialLog::kv("Door", isDoorUnlocked() ? "UNLOCKED" : "LOCKED");
        SerialLog::kv("EXIT touch armed", isExitAuthorized() ? "yes" : "no");
        SerialLog::kv("Fingerprint exit", fingerprintExitArmed ? "waiting for a finger" : "touch after the door is unlocked");
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
        const bool granted = authorizeRfid(uid, isExit, message);
        const bool lockedIn = isExit && !isDoorUnlocked();
        SerialLog::result(granted, granted
            ? (lockedIn ? "Exit approved, door unlocked so you can leave. Touch outside to lock"
                : isExit ? "Exit approved, touch to lock" : "Access granted, door unlocked")
            : "Access denied", message);
        if (!granted) playDeniedFeedback();
        else if (isExit) {
            // The exit reader is inside: a locked door is opened only to let
            // this user out, then touch outside locks it again.
            if (lockedIn) openDoorRelay();
            authorizeExit();
        }
        else openDoorRelay();
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
            playDeniedFeedback();
            // Only a completed search with no match is an unregistered finger;
            // sensor or communication errors are not reported as a person.
            if (match.outcome == DoorFingerprintSearch::Outcome::NoMatch) reportUnrecognizedFingerprint(isExit);
            return;
        }
        SerialLog::kv("Matched slot", String(match.matchedSlot) + " (confidence " + String(match.confidence) + ")");
        String message;
        bool exitOnly = false;
        const bool granted = authorizeMatchedFingerprint(match.matchedSlot, message, isExit, &exitOnly);
        SerialLog::result(granted, granted
            ? (isExit ? "Exit granted, door locked"
                : exitOnly ? "Exit only: door unlocked so you can leave. Touch outside to lock"
                : "Access granted, door unlocked")
            : "Access denied by backend", message);
        if (!granted && message.indexOf("not linked") >= 0)
            SerialLog::debug("Slot " + String(match.matchedSlot) + " has no database fingerprint. Delete it in Sensor Memory or re-enroll.");
        if (granted) {
            if (isExit) lockDoorRelay();
            else if (exitOnly) {
                // Schedule over but the user is still inside: open only so
                // they can leave, with touch-to-lock armed behind them.
                openDoorRelay();
                authorizeExit();
            }
            else openDoorRelay();
            discardBufferedScans();
        } else playDeniedFeedback();
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
    readSerialCommands();
    if (previousDoorState != isDoorUnlocked()) {
        previousDoorState = isDoorUnlocked();
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

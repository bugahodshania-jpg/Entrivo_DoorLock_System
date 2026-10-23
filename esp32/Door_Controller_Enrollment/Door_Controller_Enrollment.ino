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

namespace {
    bool sensorReady = false;
    bool waitingForFingerRemoval = true;
    bool previousDoorState = false;
    unsigned long lastSensorAttemptAt = 0;
    unsigned long lastJobPollAt = 0;
    unsigned long lastAccessScanAt = 0;

    void printStatus() {
        Serial.print("Door: ");
        Serial.println(isDoorUnlocked() ? "UNLOCKED" : "LOCKED");
        Serial.print("EXIT touch armed: "); Serial.println(isExitAuthorized() ? "yes" : "no");
        Serial.print("Fingerprint sensor: "); Serial.println(sensorReady ? "ready" : "unavailable");
        Serial.print("WiFi: "); Serial.println(WiFi.status() == WL_CONNECTED ? "connected" : "offline");
        Serial.print("Device token: "); Serial.println(String(DOOR_DEVICE_TOKEN).length() ? "configured" : "MISSING - set Config.h and backend/.env");
        Serial.print("Enrollment device ID: "); Serial.println(ENROLLMENT_DEVICE_ID);
        Serial.println("Scheduling is deferred. Registered identities are verified by the backend.");
        Serial.println("Serial commands: M = status, T = RTC time, L = lock.");
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
        resetRfidReaders();
    }

    bool scanRfid() {
        String uid;
        bool isExit = false;
        if (!pollRfidReader(uid, isExit)) return false;
        if (isExit && !isDoorUnlocked()) {
            Serial.println("[EXIT] Door is already locked. Use the entrance reader to unlock.");
            resetRfidReaders();
            return true;
        }
        String message;
        const bool granted = authorizeRfid(uid, isExit, message);
        Serial.println(message);
        if (!granted) playDeniedFeedback();
        else if (isExit) authorizeExit();
        else openDoorRelay();
        discardBufferedScans();
        return true;
    }

    void retryFingerprintConnection() {
        sensorReady = false;
        lastSensorAttemptAt = millis();
        waitingForFingerRemoval = true;
        Serial.println("Fingerprint communication lost. RFID remains available; retrying the sensor.");
    }

    void scanFingerprint() {
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
        if (imageStatus != FINGERPRINT_OK) {
            logFingerprintStatus("image", imageStatus);
            Serial.println("Fingerprint could not be read. Remove your finger and try again.");
            playDeniedFeedback();
            return;
        }
        const uint8_t templateStatus = finger.image2Tz(1);
        if (templateStatus != FINGERPRINT_OK) {
            logFingerprintStatus("image conversion", templateStatus);
            if (DoorFingerprintSearch::communicationError(templateStatus)) retryFingerprintConnection();
            else Serial.println("Fingerprint features could not be read. Remove your finger and try again.");
            playDeniedFeedback();
            return;
        }
        const DoorFingerprintSearch::Result match = searchFingerprintForAccess();
        if (match.outcome != DoorFingerprintSearch::Outcome::Matched) {
            if (match.outcome == DoorFingerprintSearch::Outcome::CommunicationError) retryFingerprintConnection();
            playDeniedFeedback();
            return;
        }
        String message;
        const bool granted = authorizeMatchedFingerprint(match.matchedSlot, message);
        Serial.println(message);
        if (granted) { openDoorRelay(); discardBufferedScans(); }
        else playDeniedFeedback();
    }
}

void setup() {
    // Set both relay outputs LOW before serial, sensor, or network initialization.
    initDoorHardware();
    Serial.begin(115200);
    Serial.println("Combined door controller and fingerprint enrollment starting.");
    initDoorFeedback();
    sensorReady = initFingerprint();
    lastSensorAttemptAt = millis();
    initRfidReaders();
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
    if (isDoorUnlocked()) {
        waitingForFingerRemoval = true;
        scanRfid(); // EXIT reader only; no enrollment/import while open.
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
        scanFingerprint();
    }
    delay(2);
}

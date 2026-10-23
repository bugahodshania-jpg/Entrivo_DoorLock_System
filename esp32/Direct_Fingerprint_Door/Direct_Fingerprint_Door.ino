#include "Config.h"
#include "API.h"
#include "DoorHardware.h"
#include "DoorStatus.h"
#include "Fingerprint.h"
#include "SensorMemory.h"
#include "WiFiManager.h"

namespace
{
    bool g_sensorReady = false;
    // A finger already on the sensor at boot/enrollment must first be removed.
    bool g_waitingForFingerRemoval = true;
    unsigned long g_lastSensorAttemptAt = 0;
    unsigned long g_lastEnrollmentPollAt = 0;
    unsigned long g_lastAccessScanAt = 0;

    void retryFingerprintConnection()
    {
        g_sensorReady = false;
        g_lastSensorAttemptAt = millis();
        g_waitingForFingerRemoval = true;
        Serial.println("Fingerprint communication lost. Door stays locked; retrying the sensor.");
    }

    void scanForDoorAccess()
    {
        const uint8_t imageStatus = finger.getImage();
        if (DoorFingerprintSearch::communicationError(imageStatus))
        {
            logFingerprintStatus("image", imageStatus);
            retryFingerprintConnection();
            return;
        }
        if (imageStatus == FINGERPRINT_NOFINGER)
        {
            g_waitingForFingerRemoval = false;
            return;
        }

        if (g_waitingForFingerRemoval)
        {
            return;
        }

        // Require release after every attempt, including an unreadable/unrecognized finger.
        g_waitingForFingerRemoval = true;
        if (imageStatus != FINGERPRINT_OK)
        {
            logFingerprintStatus("image", imageStatus);
            Serial.println("Fingerprint could not be read. Remove your finger and try again.");
            return;
        }

        const uint8_t templateStatus = finger.image2Tz(1);
        if (templateStatus != FINGERPRINT_OK)
        {
            logFingerprintStatus("image conversion", templateStatus);
            if (DoorFingerprintSearch::communicationError(templateStatus)) retryFingerprintConnection();
            else Serial.println("Fingerprint features could not be read. Remove your finger and try again.");
            return;
        }

        const DoorFingerprintSearch::Result match = searchFingerprintForAccess();
        if (match.outcome != DoorFingerprintSearch::Outcome::Matched)
        {
            if (match.outcome == DoorFingerprintSearch::Outcome::CommunicationError) retryFingerprintConnection();
            return;
        }

        String message;
        const bool granted = authorizeMatchedFingerprint(match.matchedSlot, message);
        Serial.println(message);
        if (granted)
        {
            openDoorRelay();
        }
    }
}

void setup()
{
    // Set relay idle before sensor setup or network initialization can block.
    initDoorHardware();
    Serial.begin(115200);
    Serial.println("Direct fingerprint enrollment and door controller starting.");
    g_sensorReady = initFingerprint();
    g_lastSensorAttemptAt = millis();
    connectWiFi();
    initDoorStatus(isDoorUnlocked());
}

void loop()
{
    updateDoorHardware();
    if (isDoorUnlocked())
    {
        interruptSensorMemoryRead();
        // No HTTP, sensor waits, enrollment, or reconnect work can extend the unlock pulse.
        delay(2);
        return;
    }

    ensureWiFiConnected();
    const unsigned long now = millis();
    if (!g_sensorReady)
    {
        serviceSensorMemory(false); // Retry an already captured result without rereading the sensor.
        if (now - g_lastSensorAttemptAt >= SENSOR_RETRY_INTERVAL_MS)
        {
            g_lastSensorAttemptAt = now;
            g_sensorReady = initFingerprint();
        }
    }

    if ((g_sensorReady || isFingerprintWorkPending()) && now - g_lastEnrollmentPollAt >= ENROLLMENT_POLL_INTERVAL_MS)
    {
        const bool importing = checkPendingDirectImport();
        if (importing)
        {
            interruptSensorMemoryRead();
            g_waitingForFingerRemoval = true;
            g_lastEnrollmentPollAt = millis();
            return;
        }
        if (checkPendingEnrollment())
        {
            interruptSensorMemoryRead();
            g_waitingForFingerRemoval = true;
            g_lastEnrollmentPollAt = millis();
            return;
        }
        g_lastEnrollmentPollAt = millis();
    }

    if (isFingerprintWorkPending()) { delay(2); return; }
    if (!g_sensorReady) { delay(5); return; }
    if (serviceSensorMemory(true))
    {
        g_waitingForFingerRemoval = true;
        delay(2);
        return;
    }

    if (millis() - g_lastAccessScanAt >= ACCESS_SCAN_INTERVAL_MS)
    {
        g_lastAccessScanAt = millis();
        scanForDoorAccess();
    }
    delay(2);
}

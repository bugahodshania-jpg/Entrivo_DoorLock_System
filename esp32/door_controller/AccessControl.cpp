// Offline access control implementation for Sensor B.
#include "AccessControl.h"

#include "Config.h"
#include "DoorHardware.h"
#include "Fingerprint.h"
#include "LocalState.h"

namespace
{
    unsigned long g_lastScanAt = 0;
    unsigned long g_lastDecisionAt = 0;
    uint16_t g_lastDecisionSlot = 0;
}

void processAccessControl()
{
    const unsigned long now = millis();
    if ((now - g_lastScanAt) < ACCESS_CONTROL_POLL_INTERVAL_MS)
    {
        return;
    }

    g_lastScanAt = now;

    uint16_t matchedSlot = 0;
    String errorMessage;
    const FingerprintScanStatus scanStatus = pollFingerprintMatch(matchedSlot, errorMessage);

    if (scanStatus == FINGERPRINT_SCAN_IDLE)
    {
        return;
    }

    if (scanStatus == FINGERPRINT_SCAN_ERROR)
    {
        if (errorMessage.length() > 0)
        {
            Serial.print("Fingerprint scan failed: ");
            Serial.println(errorMessage);
        }

        return;
    }

    if (scanStatus == FINGERPRINT_SCAN_NO_MATCH)
    {
        Serial.println("Fingerprint not recognized by local sensor storage.");
        return;
    }

    if (matchedSlot == g_lastDecisionSlot && (now - g_lastDecisionAt) < DOOR_UNLOCK_DURATION_MS)
    {
        return;
    }

    g_lastDecisionSlot = matchedSlot;
    g_lastDecisionAt = now;

    String policyReason;
    if (!isSlotAllowedOffline(matchedSlot, policyReason))
    {
        Serial.print("Access denied for slot ");
        Serial.print(matchedSlot);
        Serial.print(": ");
        Serial.println(policyReason);
        return;
    }

    Serial.print("Access granted for slot ");
    Serial.println(matchedSlot);
    openDoorRelay();
}

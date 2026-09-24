#include "Config.h"
#include "WiFiManager.h"
#include "Fingerprint.h"
#include "API.h"

void setup()
{
    Serial.begin(115200);

    if (!initFingerprint())
    {
        while (true);
    }

    connectWiFi();
}

void loop()
{
    checkPendingEnrollment();
    
    delay(ENROLLMENT_POLL_INTERVAL_MS);
}

#include "Config.h"
#include "WiFiManager.h"
#include "Fingerprint.h"
#include "LocalState.h"
#include "API.h"

void setup()
{
    Serial.begin(115200);

    initLocalState();

    if (!initFingerprint())
    {
        while (true)
        {
            delay(1000);
        }
    }

    connectWiFi();
}

void loop()
{
    ensureWiFiConnected();

    checkPendingTemplateSync();
    checkPendingScheduleSync();

    delay(MAIN_LOOP_DELAY_MS);
}

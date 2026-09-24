#include "Config.h"
#include "WiFiManager.h"
#include "Fingerprint.h"
#include "DoorHardware.h"
#include "LocalState.h"
#include "AccessControl.h"
#include "API.h"

void setup()
{
    Serial.begin(115200);

    initDoorHardware();
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

    processAccessControl();
    updateDoorHardware();
    checkPendingTemplateSync();
    checkPendingScheduleSync();

    delay(MAIN_LOOP_DELAY_MS);
}

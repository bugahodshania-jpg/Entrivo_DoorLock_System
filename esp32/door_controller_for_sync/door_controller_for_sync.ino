#include "Config.h"
#include "ControllerLog.h"
#include "WiFiManager.h"
#include "Fingerprint.h"
#include "DoorHardware.h"
#include "LocalState.h"
#include "AccessControl.h"
#include "API.h"

#include "esp_system.h"

namespace
{
    void printResetReason()
    {
        const esp_reset_reason_t reason = esp_reset_reason();
        logStep("BOOT", "Reset code " + String(static_cast<int>(reason)) + ".");

        switch (reason)
        {
            case ESP_RST_POWERON:
                logNote("Cause: power just came on. This is a normal start, not a fault.");
                break;
            case ESP_RST_EXT:
                logNote("Cause: the reset pin was pulled. Something outside the program restarted the board.");
                break;
            case ESP_RST_SW:
                logNote("Cause: software reset. The boot ROM shows this as rst:0x3 (SW_RESET).");
                logNote("If the lines above say \"Brownout detector was triggered\", the 3.3V supply dipped when WiFi turned on.");
                logNote("Fix: use a short USB data cable and a supply that can provide at least 500mA.");
                break;
            case ESP_RST_PANIC:
                logNote("Cause: the program crashed. Look above this line for an exception or backtrace.");
                break;
            case ESP_RST_INT_WDT:
                logNote("Cause: interrupt watchdog. Code blocked interrupts for too long.");
                break;
            case ESP_RST_TASK_WDT:
                logNote("Cause: task watchdog. A task stopped responding.");
                break;
            case ESP_RST_WDT:
                logNote("Cause: watchdog timer. The controller stopped responding.");
                break;
            case ESP_RST_DEEPSLEEP:
                logNote("Cause: wake from deep sleep. This controller does not use deep sleep.");
                break;
            case ESP_RST_BROWNOUT:
                logNote("Cause: brownout. The supply voltage fell below the safe level.");
                logNote("Fix: use a short USB data cable and a supply that can provide at least 500mA.");
                break;
            case ESP_RST_SDIO:
                logNote("Cause: SDIO. Another device reset this ESP32.");
                break;
            default:
                logNote("Cause: unrecognized reset code. Read the boot lines above this message.");
                break;
        }
    }
}

void setup()
{
    Serial.begin(115200);
    delay(100);

    logBanner("DOOR CONTROLLER");
    logNote("Startup order: storage, fingerprint sensor, WiFi, then template sync.");
    printResetReason();

    logStep("DOOR", "Relay channel 1 is GPIO 4. Channel 2 on GPIO 17 stays off. The lock stays locked until a fingerprint is allowed.");
    initDoorHardware();

    logStep("STORAGE", "Opening saved fingerprints and the offline door schedule.");
    initLocalState();

    logStep("SENSOR", "Checking the fingerprint sensor before WiFi starts.");
    while (!initFingerprint())
    {
        logStep("SENSOR", "Still no reply. Check 5V, ground, and GPIO 32/33, then the controller will try again.");
        delay(2000);
    }

    logStep("WIFI", "Sensor is ready. Joining the network next.");
    connectWiFi();

    logBanner("DOOR CONTROLLER READY");
    logStep("SYNC", "Polling the server for template jobs every 2 seconds.");
    logNote("Schedule sync is checked less often. A missing schedule endpoint does not stop template sync.");
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

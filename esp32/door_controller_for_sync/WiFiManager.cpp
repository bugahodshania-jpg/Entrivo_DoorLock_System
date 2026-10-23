// Wi-Fi connection implementation for Sensor B.
#include <WiFi.h>
#include "WiFiManager.h"
#include "Config.h"
#include "ControllerLog.h"

namespace
{
    unsigned long g_lastReconnectAttemptAt = 0;

    String describeWiFiStatus(wl_status_t status)
    {
        switch (status)
        {
            case WL_IDLE_STATUS:
                return "the radio is still starting";
            case WL_NO_SSID_AVAIL:
                return "network \"" + String(WIFI_SSID) + "\" was not found. The hotspot is off, out of range, or the name is wrong";
            case WL_SCAN_COMPLETED:
                return "the scan finished and the controller is still joining";
            case WL_CONNECTED:
                return "connected";
            case WL_CONNECT_FAILED:
                return "the access point refused the connection. The password for \"" + String(WIFI_SSID) + "\" may be wrong";
            case WL_CONNECTION_LOST:
                return "the connection dropped after it had started";
            case WL_DISCONNECTED:
                return "not connected yet";
            default:
                break;
        }

        if (static_cast<int>(status) == 7)
        {
            return "the password for \"" + String(WIFI_SSID) + "\" was rejected";
        }

        return "unexpected WiFi status code " + String(static_cast<int>(status));
    }

    void beginWiFiConnection()
    {
        logStep("WIFI", "Joining network \"" + String(WIFI_SSID) + "\".");
        WiFi.mode(WIFI_STA);
        WiFi.setSleep(true);
        WiFi.setTxPower(WIFI_POWER_11dBm);
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
        g_lastReconnectAttemptAt = millis();
    }

    bool waitForWiFi(unsigned long timeoutMs)
    {
        unsigned long lastReportAt = 0;
        const unsigned long startedAt = millis();

        while (WiFi.status() != WL_CONNECTED)
        {
            const unsigned long now = millis();
            if ((now - startedAt) >= timeoutMs)
            {
                logStep("WIFI", "Not connected after " + String(timeoutMs / 1000) + " seconds. State: " + describeWiFiStatus(WiFi.status()) + ".");
                return false;
            }

            if (lastReportAt == 0 || (now - lastReportAt) >= 2000)
            {
                lastReportAt = now;
                logNote("Still waiting. State: " + describeWiFiStatus(WiFi.status()) + ".");
            }

            delay(200);
        }

        return true;
    }
}

void connectWiFi()
{
    logNote("If the chip prints \"Brownout detector was triggered\" here, the supply voltage fell when the radio turned on.");
    logNote("That is a power problem, not a wrong WiFi password and not a fingerprint fault.");
    Serial.flush();
    beginWiFiConnection();

    if (!waitForWiFi(30000))
    {
        logStep("WIFI", "Still not joined. The controller will keep trying.");
        while (!waitForWiFi(30000))
        {
            beginWiFiConnection();
        }
    }

    logStep("WIFI", "Connected to \"" + String(WIFI_SSID) + "\". IP address " + WiFi.localIP().toString() + ".");
}

void ensureWiFiConnected()
{
    if (WiFi.status() == WL_CONNECTED)
    {
        return;
    }

    const unsigned long now = millis();
    if ((now - g_lastReconnectAttemptAt) < WIFI_RETRY_INTERVAL_MS)
    {
        return;
    }

    logStep("WIFI", "Connection dropped. Last state: " + describeWiFiStatus(WiFi.status()) + ".");
    logNote("Joining the network again.");
    beginWiFiConnection();
}

bool isWiFiReady()
{
    return WiFi.status() == WL_CONNECTED;
}

void pauseWiFiForSensorWork()
{
    logStep("WIFI", "Pausing the radio while the template is written to the fingerprint sensor.");
    logNote("The radio stays off so it does not corrupt the sensor link or pull the supply voltage down.");
    Serial.flush();
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
    delay(150);
}

bool resumeWiFiAfterSensorWork()
{
    logStep("WIFI", "Sensor write finished. Turning the radio back on to report the result.");
    Serial.flush();
    beginWiFiConnection();
    if (!waitForWiFi(20000))
    {
        logStep("WIFI", "The result could not be reported because WiFi did not return.");
        logNote("The job stays in progress and will be tried again after about one minute.");
        return false;
    }

    logStep("WIFI", "Connected to \"" + String(WIFI_SSID) + "\". IP address " + WiFi.localIP().toString() + ".");
    return true;
}

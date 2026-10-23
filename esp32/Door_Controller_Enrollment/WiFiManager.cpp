#include <WiFi.h>

#include "Config.h"
#include "WiFiManager.h"

namespace
{
    unsigned long g_lastAttemptAt = 0;
    bool g_wasConnected = false;
}

void connectWiFi()
{
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    g_lastAttemptAt = millis();
    Serial.println("WiFi connection started. New credentials require backend verification.");
}

void ensureWiFiConnected()
{
    const bool connected = WiFi.status() == WL_CONNECTED;
    if (connected != g_wasConnected)
    {
        g_wasConnected = connected;
        Serial.println(connected ? "WiFi connected." : "WiFi disconnected. Door access is unavailable.");
    }

    if (!connected && millis() - g_lastAttemptAt >= WIFI_RETRY_INTERVAL_MS)
    {
        g_lastAttemptAt = millis();
        WiFi.disconnect();
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
}

// Wi-Fi connection implementation for Sensor B.
#include <WiFi.h>
#include "WiFiManager.h"
#include "Config.h"

namespace
{
    unsigned long g_lastReconnectAttemptAt = 0;

    void beginWiFiConnection()
    {
        Serial.println();
        Serial.println("Connecting to WiFi...");
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
        g_lastReconnectAttemptAt = millis();
    }
}

void connectWiFi()
{
    beginWiFiConnection();

    while (WiFi.status() != WL_CONNECTED)
    {
        delay(500);
        Serial.print(".");
    }

    Serial.println();
    Serial.println("WiFi Connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
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

    Serial.println("WiFi disconnected. Retrying...");
    beginWiFiConnection();
}

bool isWiFiReady()
{
    return WiFi.status() == WL_CONNECTED;
}

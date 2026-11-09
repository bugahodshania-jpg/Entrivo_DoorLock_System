#include <WiFi.h>
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

#include "Config.h"
#include "WiFiManager.h"

namespace
{
    // Brownout guard for WiFi start-up only. Turning the radio on (RF
    // calibration + first transmissions) draws a short current spike; on a
    // USB-powered board that also feeds the R307S, two RFID readers and the
    // relay board, that dip trips the brownout detector and the ESP32 resets
    // in a loop before WiFi ever connects. The detector is paused only until
    // WiFi connects or WIFI_BROWNOUT_GUARD_MS passes, then restored, so a real
    // sustained low supply still resets the board. A proper 5 V supply is the
    // real fix; this keeps the board usable on weaker USB power.
    constexpr unsigned long WIFI_BROWNOUT_GUARD_MS = 15000UL;
    uint32_t g_savedBrownoutReg = 0;
    bool g_brownoutPaused = false;
    unsigned long g_brownoutPausedAt = 0;

    // Also used while WiFi is down: each reconnect draws a current spike that
    // can brown out the supply and restart the board. Calling it again keeps
    // the guard on for another WIFI_BROWNOUT_GUARD_MS.
    void pauseBrownoutDetector()
    {
        g_brownoutPausedAt = millis();
        if (g_brownoutPaused) return;
        g_savedBrownoutReg = READ_PERI_REG(RTC_CNTL_BROWN_OUT_REG);
        WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
        g_brownoutPaused = true;
    }

    void restoreBrownoutDetector(const char *why)
    {
        if (!g_brownoutPaused) return;
        WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, g_savedBrownoutReg);
        g_brownoutPaused = false;
        // Informational only: the start-up guard is over and normal
        // brownout protection is active again. This is not an error.
        Serial.print("[WiFi] Power guard finished (");
        Serial.print(why);
        Serial.println("); brownout protection is active again.");
    }

    unsigned long g_lastAttemptAt = 0;
    bool g_wasConnected = false;
    uint16_t g_attempts = 0;

    // Written by the WiFi event task, read and printed from loop().
    volatile uint8_t g_lastReason = 0;
    volatile bool g_reasonPending = false;
    uint8_t g_lastPrintedReason = 0;
    unsigned long g_lastReasonPrintAt = 0;

    void onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info)
    {
        if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
            g_lastReason = info.wifi_sta_disconnected.reason;
            g_reasonPending = true;
        }
    }

    // Plain-language cause for the disconnect reasons a Windows Mobile Hotspot produces.
    const char *reasonHint(uint8_t reason)
    {
        switch (reason) {
            case WIFI_REASON_NO_AP_FOUND:
                return "The ESP32 cannot see this hotspot. Check WIFI_SSID (exact spelling and case), "
                       "set the hotspot band to 2.4 GHz, and keep the board close to the PC.";
            case WIFI_REASON_NO_AP_FOUND_W_COMPATIBLE_SECURITY:
            case WIFI_REASON_NO_AP_FOUND_IN_AUTHMODE_THRESHOLD:
                return "The hotspot's security mode is not accepted. In Windows Mobile hotspot settings, "
                       "use WPA2 (not WPA3-only).";
            case WIFI_REASON_AUTH_FAIL:
            case WIFI_REASON_AUTH_EXPIRE:
            case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:
            case WIFI_REASON_HANDSHAKE_TIMEOUT:
                return "Wrong password. WIFI_PASSWORD in Config.h must exactly match the hotspot password "
                       "(Windows Settings > Mobile hotspot > Properties).";
            case WIFI_REASON_ASSOC_FAIL:
            case WIFI_REASON_ASSOC_EXPIRE:
            case WIFI_REASON_ASSOC_TOOMANY:
                return "The hotspot refused the board. Check that the hotspot has not reached its device limit, "
                       "then turn the hotspot off and on.";
            case WIFI_REASON_BEACON_TIMEOUT:
                return "Signal lost. Move the board closer to the PC and check its power supply.";
            default:
                return nullptr;
        }
    }

    void startConnection()
    {
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
        g_lastAttemptAt = millis();
        ++g_attempts;
    }
}

void connectWiFi()
{
    // Printed BEFORE the radio starts: if the board resets right after this
    // line, the WiFi current spike is browning out the supply.
    Serial.println("[WiFi] Starting WiFi for hotspot \"" WIFI_SSID "\"...");
    Serial.flush();
    delay(100);  // Let the 3.3 V rail settle after sensor/RFID start-up.
    pauseBrownoutDetector();
    WiFi.onEvent(onWiFiEvent);
    WiFi.persistent(false);  // Do not write credentials to flash on every attempt.
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    // Low transmit power: the hotspot is a nearby PC, and full power draws
    // the current spikes that brown out a USB-powered board with a sensor,
    // RFID readers and a relay on the same supply.
    WiFi.setTxPower(WIFI_POWER_8_5dBm);
    WiFi.setAutoReconnect(true);
    startConnection();
    Serial.println("[WiFi] Connection started. New credentials require backend verification.");
}

void ensureWiFiConnected()
{
    const wl_status_t status = WiFi.status();
    const bool connected = status == WL_CONNECTED;
    if (g_brownoutPaused) {
        if (connected) restoreBrownoutDetector("WiFi connected");
        else if (millis() - g_brownoutPausedAt >= WIFI_BROWNOUT_GUARD_MS) restoreBrownoutDetector("start-up window ended");
    }
    if (connected != g_wasConnected)
    {
        g_wasConnected = connected;
        if (connected) {
            Serial.print("[WiFi] WiFi connected. IP ");
            Serial.print(WiFi.localIP());
            Serial.print(", signal ");
            Serial.print(WiFi.RSSI());
            Serial.println(" dBm.");
            g_attempts = 0;
        } else {
            Serial.println("[WiFi] WiFi disconnected. Scans cannot be verified until it returns; the door stays as it is.");
            pauseBrownoutDetector();
        }
    }

    if (g_reasonPending)
    {
        g_reasonPending = false;
        const uint8_t reason = g_lastReason;
        // The radio retries on its own, so the same reason can repeat every
        // second. Print it when it changes, otherwise at most every 10 s.
        if (!connected && (reason != g_lastPrintedReason || millis() - g_lastReasonPrintAt >= WIFI_RETRY_INTERVAL_MS)) {
            g_lastPrintedReason = reason;
            g_lastReasonPrintAt = millis();
            Serial.print("[WiFi] Could not connect to \"" WIFI_SSID "\": reason ");
            Serial.print(reason);
            Serial.print(" (");
            Serial.print(WiFi.disconnectReasonName(static_cast<wifi_err_reason_t>(reason)));
            Serial.println(").");
            const char *hint = reasonHint(reason);
            if (hint) {
                Serial.print("[WiFi] ");
                Serial.println(hint);
            }
        }
    }

    if (!connected && millis() - g_lastAttemptAt >= WIFI_RETRY_INTERVAL_MS)
    {
        Serial.print("[WiFi] Still not connected (status ");
        Serial.print(static_cast<int>(status));
        Serial.print("). Retrying, attempt ");
        Serial.print(g_attempts + 1);
        Serial.println(".");
        pauseBrownoutDetector();
        WiFi.disconnect();
        startConnection();
    }
}

bool isWiFiConnecting()
{
    return WiFi.status() != WL_CONNECTED && millis() - g_lastAttemptAt < WIFI_RETRY_INTERVAL_MS;
}

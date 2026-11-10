#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <esp_system.h>
#include "BackendClient.h"
#include "Config.h"
#include "DoorStatus.h"
#include "HttpLock.h"

namespace {
    // The backend shows a report for 45 s. A 4 s heartbeat leaves room for
    // several slow or failed Railway requests without the app showing "Unavailable".
    constexpr unsigned long HEARTBEAT_MS = 4000UL;
    constexpr unsigned long RETRY_MS = 3000UL;
    // While touch-to-lock is armed, reports are rarer (still inside the backend's
    // 45 s window) and give up quickly, so a slow network cannot hold up the lock.
    constexpr unsigned long ARMED_REPORT_MS = 15000UL;
    constexpr uint16_t ARMED_TIMEOUT_MS = 1500;
    char bootId[33] = {};
    uint32_t sequence = 0;
    bool started = false;
    bool pendingUnlocked = false;
    bool sendNow = false;
    bool lastAttemptFailed = false;
    unsigned long lastAttemptAt = 0;

    bool postState(bool unlocked, bool touchArmed) {
        if (WiFi.status() != WL_CONNECTED || String(DOOR_DEVICE_TOKEN).length() == 0) return false;
        DynamicJsonDocument payload(512);
        payload["device_id"] = ENROLLMENT_DEVICE_ID;
        payload["door_state"] = unlocked ? "unlocked" : "locked";
        payload["boot_id"] = bootId;
        payload["sequence"] = ++sequence;
        String body;
        serializeJson(payload, body);
        EntrivoHttpLock httpLock;
        HTTPClient &http = backendHttp();
        http.setConnectTimeout(touchArmed ? ARMED_TIMEOUT_MS : HTTP_CONNECT_TIMEOUT_MS);
        http.setTimeout(touchArmed ? ARMED_TIMEOUT_MS : HTTP_READ_TIMEOUT_MS);
        http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
        if (!beginBackendRequest(http, "/api/door_status_device.php")) {
            Serial.println("[DOOR STATUS] Could not start the status report.");
            return false;
        }
        http.addHeader("Content-Type", "application/json");
        http.addHeader("X-Device-Token", DOOR_DEVICE_TOKEN);
        const int code = http.POST(body);
        if (code > 0) http.getString(); // drain so the connection can be reused
        endBackendRequest(http, code);
        if (code != HTTP_CODE_OK) {
            Serial.print("[DOOR STATUS] Report failed HTTP ");
            Serial.println(code);
            if (code < 0) Serial.println("[DOOR STATUS] Connection failed. Check SERVER_URL in Config.h, that WiFi has internet access, and that the backend is running.");
            return false;
        }
        return true;
    }
}

void initDoorStatus(bool unlocked) {
    if (started) return;
    initHttpLock();
    snprintf(bootId, sizeof(bootId), "%08lx%08lx%08lx%08lx",
        static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()),
        static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()));
    pendingUnlocked = unlocked;
    sendNow = true;
    started = true;
}

void queueDoorStatus(bool unlocked) {
    pendingUnlocked = unlocked;
    sendNow = true;
    lastAttemptFailed = false;
}

void serviceDoorStatus(bool touchArmed) {
    if (!started) return;
    const unsigned long now = millis();
    // A new lock/unlock goes out at once; only a failed send waits to retry.
    unsigned long wait = touchArmed ? ARMED_REPORT_MS : sendNow ? RETRY_MS : HEARTBEAT_MS;
    if (sendNow && !lastAttemptFailed) wait = 0;
    if (lastAttemptAt != 0 && now - lastAttemptAt < wait) return;
    lastAttemptAt = now;
    lastAttemptFailed = !postState(pendingUnlocked, touchArmed);
    if (!lastAttemptFailed) sendNow = false;
}

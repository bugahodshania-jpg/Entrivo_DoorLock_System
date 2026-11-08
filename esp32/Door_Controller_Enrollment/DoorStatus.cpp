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
    char bootId[33] = {};
    uint32_t sequence = 0;
    bool started = false;
    bool pendingUnlocked = false;
    bool sendNow = false;
    unsigned long lastAttemptAt = 0;

    bool postState(bool unlocked) {
        if (WiFi.status() != WL_CONNECTED || String(DOOR_DEVICE_TOKEN).length() == 0) return false;
        DynamicJsonDocument payload(512);
        payload["device_id"] = ENROLLMENT_DEVICE_ID;
        payload["door_state"] = unlocked ? "unlocked" : "locked";
        payload["boot_id"] = bootId;
        payload["sequence"] = ++sequence;
        String body;
        serializeJson(payload, body);
        EntrivoHttpLock httpLock;
        HTTPClient http;
        http.setReuse(false);
        http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
        http.setTimeout(HTTP_READ_TIMEOUT_MS);
        http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
        if (!beginBackendRequest(http, "/api/door_status_device.php")) {
            Serial.println("[DOOR STATUS] Could not start the status report.");
            return false;
        }
        http.addHeader("Content-Type", "application/json");
        http.addHeader("X-Device-Token", DOOR_DEVICE_TOKEN);
        const int code = http.POST(body);
        http.end();
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
}

void serviceDoorStatus() {
    if (!started) return;
    const unsigned long now = millis();
    const unsigned long wait = sendNow ? RETRY_MS : HEARTBEAT_MS;
    if (lastAttemptAt != 0 && now - lastAttemptAt < wait) return;
    lastAttemptAt = now;
    if (postState(pendingUnlocked)) sendNow = false;
}

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <esp_system.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include "Config.h"
#include "DoorStatus.h"

namespace {
    QueueHandle_t statusQueue = nullptr;
    constexpr unsigned long HEARTBEAT_MS = 3000UL;

    void statusTask(void *) {
        char bootId[33] = {};
        snprintf(bootId, sizeof(bootId), "%08lx%08lx%08lx%08lx",
            static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()),
            static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()));
        uint32_t sequence = 0;
        bool unlocked = false;
        for (;;) {
            // One slot keeps the latest transition even during an HTTP timeout.
            // Timeout sends a heartbeat without reading or changing any hardware.
            xQueueReceive(statusQueue, &unlocked, pdMS_TO_TICKS(HEARTBEAT_MS));
            if (WiFi.status() != WL_CONNECTED || String(DOOR_DEVICE_TOKEN).length() == 0) continue;
            DynamicJsonDocument payload(512);
            payload["device_id"] = ENROLLMENT_DEVICE_ID;
            payload["door_state"] = unlocked ? "unlocked" : "locked";
            payload["boot_id"] = bootId;
            payload["sequence"] = ++sequence;
            String body;
            serializeJson(payload, body);
            HTTPClient http;
            http.setConnectTimeout(250);
            http.setTimeout(500);
            http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
            if (!http.begin(String(SERVER_URL) + "/api/door_status_device.php")) continue;
            http.addHeader("Content-Type", "application/json");
            http.addHeader("X-Device-Token", DOOR_DEVICE_TOKEN);
            http.POST(body);
            http.end();
        }
    }
}

void initDoorStatus(bool unlocked) {
    if (statusQueue != nullptr) return;
    statusQueue = xQueueCreate(1, sizeof(bool));
    if (statusQueue == nullptr) {
        Serial.println("[DOOR STATUS] Queue unavailable. Web status will remain unavailable.");
        return;
    }
    xQueueOverwrite(statusQueue, &unlocked);
    if (xTaskCreate(statusTask, "door_status", 6144, nullptr, 1, nullptr) != pdPASS) {
        vQueueDelete(statusQueue);
        statusQueue = nullptr;
        Serial.println("[DOOR STATUS] Task unavailable. Web status will remain unavailable.");
    }
}

void queueDoorStatus(bool unlocked) {
    if (statusQueue != nullptr) xQueueOverwrite(statusQueue, &unlocked);
}

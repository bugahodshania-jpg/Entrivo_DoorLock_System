#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <esp_system.h>
#include "BackendClient.h"
#include "Config.h"
#include "DoorStatus.h"
#include "AccessCache.h"
#include "HttpLock.h"
#include <Preferences.h>

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
    unsigned long lastReportOkAt = 0; // 0 = no report has succeeded since boot
    // Latest schedule end reported back while the door is unlocked.
    bool sessionEndFresh = false;
    uint32_t sessionEndEpoch = 0;
    long sessionSecondsLeft = -1;

    // Portal controls: scheduling mode (kept in NVS for offline use after a
    // restart) and a remote lock/unlock waiting to run, then be confirmed.
    Preferences controlStore;
    bool controlStoreReady = false;
    char scheduleMode[5] = "auto";
    int32_t pendingCommandId = 0;
    bool pendingUnlock = false;
    bool commandFresh = false;
    int32_t lastDoneCommandId = 0;   // reported back until the backend clears it
    int32_t lastRunCommandId = 0;    // never run the same command twice
    // Portal emergency card, kept in NVS ("" = none). Sent back in each report
    // so the portal can show that the door saved it.
    char portalCardUid[11] = "";
    char portalCardName[61] = "Emergency card";

    bool validCardUid(const char *uid) {
        if (strlen(uid) != 10) return false;
        for (int i = 0; i < 10; ++i) if (!isxdigit(static_cast<unsigned char>(uid[i]))) return false;
        return true;
    }

    void readEmergencyCard(JsonDocument &reply) {
        // Only a reply that carries it changes it: an older backend leaves the saved card.
        if (!reply["emergency_card"].is<JsonObject>()) return;
        const char *uid = reply["emergency_card"]["uid"] | "";
        const char *name = reply["emergency_card"]["name"] | "";
        if (*uid && !validCardUid(uid)) return;
        String upper(uid);
        upper.toUpperCase();
        const char *label = *name ? name : "Emergency card";
        if (upper == portalCardUid && !strcmp(label, portalCardName)) return;
        strncpy(portalCardUid, upper.c_str(), sizeof(portalCardUid) - 1);
        portalCardUid[sizeof(portalCardUid) - 1] = 0;
        strncpy(portalCardName, label, sizeof(portalCardName) - 1);
        portalCardName[sizeof(portalCardName) - 1] = 0;
        if (controlStoreReady) {
            controlStore.putString("ecard", portalCardUid);
            controlStore.putString("ecname", portalCardName);
        }
        Serial.print("[DOOR CONTROL] Portal emergency card ");
        if (*portalCardUid) {
            Serial.print("saved: ");
            Serial.print(portalCardName);
            Serial.print(" (");
            Serial.print(portalCardUid);
            Serial.println(").");
        } else {
            Serial.println("removed.");
        }
    }

    void readControls(JsonDocument &reply) {
        readEmergencyCard(reply);
        const char *mode = reply["schedule_mode"] | "";
        if ((!strcmp(mode, "auto") || !strcmp(mode, "on") || !strcmp(mode, "off")) && strcmp(mode, scheduleMode) != 0) {
            strncpy(scheduleMode, mode, sizeof(scheduleMode) - 1);
            if (controlStoreReady) controlStore.putString("mode", scheduleMode);
            Serial.print("[DOOR CONTROL] Scheduling mode from the portal: ");
            Serial.println(scheduleMode);
        }
        if (!reply["command"].is<JsonObject>()) {
            if (lastDoneCommandId) lastDoneCommandId = 0; // the backend cleared it
            return;
        }
        const int32_t id = reply["command"]["id"] | 0;
        const char *action = reply["command"]["action"] | "";
        if (id <= 0 || id == lastRunCommandId || (strcmp(action, "lock") && strcmp(action, "unlock"))) return;
        pendingCommandId = id;
        pendingUnlock = !strcmp(action, "unlock");
        commandFresh = true;
    }

    void readSessionEnd(JsonDocument &reply) {
        if (!reply["session_end_epoch"].is<uint32_t>() || !reply["session_seconds_remaining"].is<long>()) return;
        sessionEndEpoch = reply["session_end_epoch"].as<uint32_t>();
        sessionSecondsLeft = reply["session_seconds_remaining"].as<long>();
        sessionEndFresh = true;
    }

    void readReply(const String &body, bool unlocked) {
        DynamicJsonDocument reply(1024);
        if (deserializeJson(reply, body) != DeserializationError::Ok) return;
        readControls(reply);
        // A newer offline schedule copy is downloaded by serviceAccessCache().
        if (reply["access_cache_version"].is<uint32_t>()) noteAccessCacheVersion(reply["access_cache_version"].as<uint32_t>());
        if (unlocked) readSessionEnd(reply);
    }

    bool postState(bool unlocked, bool touchArmed) {
        if (WiFi.status() != WL_CONNECTED || String(DOOR_DEVICE_TOKEN).length() == 0) return false;
        DynamicJsonDocument payload(512);
        payload["device_id"] = ENROLLMENT_DEVICE_ID;
        payload["door_state"] = unlocked ? "unlocked" : "locked";
        payload["boot_id"] = bootId;
        payload["sequence"] = ++sequence;
        // Signal strength for the portal's WiFi icon (connected / weak).
        payload["wifi_rssi"] = WiFi.RSSI();
        // The portal emergency card this door has saved ("" = none).
        payload["emergency_card_uid"] = portalCardUid;
        // Which offline schedule copy is saved, for the portal's Door control.
        payload["cache_version"] = accessCacheSavedVersion();
        payload["cache_valid_until"] = accessCacheValidUntil();
        // Confirms a finished remote lock/unlock so the backend clears it.
        if (lastDoneCommandId) payload["command_done"] = lastDoneCommandId;
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
        String reply;
        if (code > 0) reply = http.getString(); // also drains so the connection can be reused
        endBackendRequest(http, code);
        if (code != HTTP_CODE_OK) {
            Serial.print("[DOOR STATUS] Report failed HTTP ");
            Serial.println(code);
            if (code < 0) Serial.println("[DOOR STATUS] Connection failed. Check SERVER_URL in Config.h, that WiFi has internet access, and that the backend is running.");
            return false;
        }
        readReply(reply, unlocked);
        return true;
    }
}

bool takeSessionEnd(uint32_t &endEpoch, long &secondsLeft) {
    if (!sessionEndFresh) return false;
    sessionEndFresh = false;
    endEpoch = sessionEndEpoch;
    secondsLeft = sessionSecondsLeft;
    return true;
}

void initDoorStatus(bool unlocked) {
    if (started) return;
    controlStoreReady = controlStore.begin("doorctl", false);
    if (controlStoreReady) {
        const String saved = controlStore.getString("mode", "auto");
        if (saved == "auto" || saved == "on" || saved == "off") strncpy(scheduleMode, saved.c_str(), sizeof(scheduleMode) - 1);
        const String card = controlStore.getString("ecard", "");
        if (validCardUid(card.c_str())) {
            strncpy(portalCardUid, card.c_str(), sizeof(portalCardUid) - 1);
            const String name = controlStore.getString("ecname", "Emergency card");
            strncpy(portalCardName, name.length() ? name.c_str() : "Emergency card", sizeof(portalCardName) - 1);
        }
    }
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
    if (!lastAttemptFailed) lastReportOkAt = now;
    if (!lastAttemptFailed) sendNow = false;
}

bool takeDoorCommand(int32_t &commandId, bool &unlock) {
    if (!commandFresh) return false;
    commandFresh = false;
    commandId = pendingCommandId;
    unlock = pendingUnlock;
    return true;
}

void confirmDoorCommand(int32_t commandId) {
    lastRunCommandId = commandId;
    lastDoneCommandId = commandId;
    sendNow = true;            // confirm on the next report, right away
    lastAttemptFailed = false;
}

bool offlineFingerEntryAllowed() {
    // Auto: scheduling is off only while offline. Off: always. On: never.
    return strcmp(scheduleMode, "on") != 0;
}

const char *doorScheduleMode() { return scheduleMode; }

bool isPortalEmergencyCard(const String &uid) {
    return portalCardUid[0] != 0 && uid.equalsIgnoreCase(portalCardUid);
}

const char *portalEmergencyCardName() { return portalCardName; }

unsigned long backendSilentMs() {
    return lastReportOkAt == 0 ? millis() : millis() - lastReportOkAt;
}

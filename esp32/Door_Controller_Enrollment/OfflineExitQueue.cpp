#include "OfflineExitQueue.h"

#include <WiFi.h>
#include <Preferences.h>
#include <esp_system.h>
#include "API.h"
#include "DoorHardware.h"

namespace {
    // Oldest first. When full, the oldest exit is dropped (with a warning) so
    // the newest exits are always kept.
    constexpr size_t MAX_EXITS = 32;
    constexpr unsigned long UPLOAD_INTERVAL_MS = 3000UL;
    // RTC seconds below this mean the clock was never set (it reads 2000-01-01).
    constexpr uint32_t RTC_SANE_AFTER = 1700000000UL;

    Preferences store;
    bool ready = false;
    OfflineExit exits[MAX_EXITS];
    size_t count = 0;
    uint32_t bootTag = 0;
    unsigned long lastUploadAt = 0;

    void save() {
        if (!ready) return;
        store.putUInt("n", static_cast<uint32_t>(count));
        if (count) store.putBytes("items", exits, count * sizeof(OfflineExit));
        else store.remove("items");
    }

    uint32_t saneRtc() {
        const uint32_t now = rtcSeconds();
        return now >= RTC_SANE_AFTER ? now : 0;
    }

    // Seconds since the exit happened, or -1 when it cannot be known (recorded
    // in an earlier boot and the RTC is not running): the backend then uses
    // the upload time.
    long ageSeconds(const OfflineExit &exit) {
        if (exit.bootTag == bootTag) return static_cast<long>((millis() - exit.millisAt) / 1000UL);
        const uint32_t now = saneRtc();
        if (exit.rtcAt && now >= exit.rtcAt) return static_cast<long>(now - exit.rtcAt);
        return -1;
    }

    void dropOldest() {
        if (!count) return;
        for (size_t i = 1; i < count; ++i) exits[i - 1] = exits[i];
        --count;
        save();
    }
}

void initOfflineExits() {
    bootTag = esp_random();
    if (bootTag == 0) bootTag = 1;
    ready = store.begin("exitq", false);
    if (!ready) {
        Serial.println("[OFFLINE EXITS] NVS unavailable: offline exits can only be kept until the next restart.");
        return;
    }
    count = store.getUInt("n", 0);
    if (count > MAX_EXITS) count = 0;
    if (count && store.getBytes("items", exits, count * sizeof(OfflineExit)) != count * sizeof(OfflineExit)) count = 0;
    if (count) {
        Serial.print("[OFFLINE EXITS] ");
        Serial.print(count);
        Serial.println(" exit(s) from before the restart are waiting to be uploaded to the access log.");
    }
}

void newDoorEventId(char out[33]) {
    snprintf(out, 33, "%08lx%08lx%08lx%08lx",
        static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()),
        static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()));
}

void queueOfflineExit(const char *eventId, const String &rfidUid, uint16_t slot) {
    if (count == MAX_EXITS) {
        Serial.println("[OFFLINE EXITS] Queue full: the oldest waiting exit was dropped.");
        for (size_t i = 1; i < count; ++i) exits[i - 1] = exits[i];
        --count;
    }
    OfflineExit &exit = exits[count++];
    memset(&exit, 0, sizeof(exit));
    strncpy(exit.eventId, eventId, sizeof(exit.eventId) - 1);
    strncpy(exit.rfidUid, rfidUid.c_str(), sizeof(exit.rfidUid) - 1);
    exit.slot = slot;
    exit.bootTag = bootTag;
    exit.millisAt = millis();
    exit.rtcAt = saneRtc();
    save();
    Serial.print("[OFFLINE EXITS] Exit saved; it will be added to the access log when the connection returns (");
    Serial.print(count);
    Serial.println(" waiting).");
}

size_t offlineExitCount() { return count; }

void serviceOfflineExits() {
    if (!count || WiFi.status() != WL_CONNECTED) return;
    if (lastUploadAt != 0 && millis() - lastUploadAt < UPLOAD_INTERVAL_MS) return;
    lastUploadAt = millis();
    const OfflineExit &exit = exits[0];
    bool rejected = false;
    if (uploadOfflineExit(exit.eventId, exit.rfidUid, exit.slot, ageSeconds(exit), rejected)) {
        dropOldest();
        Serial.print("[OFFLINE EXITS] Exit added to the access log (");
        Serial.print(count);
        Serial.println(" still waiting).");
    } else if (rejected) {
        // The backend answered that this record is malformed: retrying cannot help.
        dropOldest();
        Serial.println("[OFFLINE EXITS] The backend refused a malformed exit record; it was dropped.");
    }
}

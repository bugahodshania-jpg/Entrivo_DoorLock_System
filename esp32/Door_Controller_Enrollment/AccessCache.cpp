#include "AccessCache.h"

#include <WiFi.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <esp_partition.h>
#include <time.h>

#include "BackendClient.h"
#include "Config.h"
#include "DoorHardware.h"
#include "DoorStatus.h"
#include "HttpLock.h"
#include "SerialLog.h"

using namespace DoorAccessCache;

namespace {
    // Two slots in the data partition ("spiffs" in the default ESP32 Dev
    // Module scheme, 1.5 MB, unused by this sketch). The active slot is in NVS.
    constexpr uint32_t SLOT_BYTES = 65536UL;
    constexpr uint32_t SECTOR_BYTES = 4096UL;
    constexpr uint32_t CLOCK_VALID_AFTER = 1700000000UL;
    // After a failed download wait longer before trying again.
    constexpr unsigned long RETRY_OK_MS = 15000UL;
    constexpr unsigned long RETRY_FAILED_MS = 60000UL;

    const esp_partition_t *partition = nullptr;
    Preferences store;
    bool storeReady = false;
    uint8_t activeSlot = 0xFF; // 0 or 1; 0xFF = no copy
    Header header{};
    uint32_t wantedVersion = 0;
    unsigned long lastAttemptAt = 0;
    bool lastAttemptFailed = false;

    // Read buffers (static: kept off the loop task's stack).
    uint8_t chunk[RECORD_BYTES * 32];
    uint8_t windowBuffer[RECORD_BYTES * MAX_WINDOWS_PER_PERSON];

    uint32_t slotBase(uint8_t slot) { return static_cast<uint32_t>(slot) * SLOT_BYTES; }

    bool readAt(uint8_t slot, uint32_t offset, void *out, size_t length) {
        return partition && esp_partition_read(partition, slotBase(slot) + offset, out, length) == ESP_OK;
    }

    // The header of a slot, when it parses and its payload CRC matches.
    Header verifiedHeader(uint8_t slot) {
        uint8_t raw[HEADER_BYTES];
        if (!readAt(slot, 0, raw, sizeof(raw))) return Header{};
        Header h = parseHeader(raw, sizeof(raw), SLOT_BYTES);
        if (!h.valid) return Header{};
        uint32_t crc = 0;
        for (uint32_t done = 0; done < h.payloadSize;) {
            const size_t part = min<uint32_t>(sizeof(chunk), h.payloadSize - done);
            if (!readAt(slot, HEADER_BYTES + done, chunk, part)) return Header{};
            crc = crc32(crc, chunk, part);
            done += part;
        }
        if (crc != h.payloadCrc) h.valid = false;
        return h;
    }

    // Writes the HTTP body into a slot, erasing each 4 KB sector just before it
    // is used, and refuses anything larger than the slot.
    class SlotWriter : public Stream {
    public:
        explicit SlotWriter(uint8_t slot) : base(slotBase(slot)) {}
        size_t write(uint8_t byte) override { return write(&byte, 1); }
        size_t write(const uint8_t *data, size_t length) override {
            if (!ok || length == 0) return 0;
            if (written + length > SLOT_BYTES) { ok = false; return 0; }
            while (erased < written + length) {
                if (esp_partition_erase_range(partition, base + erased, SECTOR_BYTES) != ESP_OK) { ok = false; return 0; }
                erased += SECTOR_BYTES;
            }
            if (esp_partition_write(partition, base + written, data, length) != ESP_OK) { ok = false; return 0; }
            written += length;
            return length;
        }
        int available() override { return 0; }
        int read() override { return -1; }
        int peek() override { return -1; }
        void flush() override {}
        bool ok = true;
        uint32_t written = 0;
    private:
        uint32_t base;
        uint32_t erased = 0;
    };

    bool download() {
        if (WiFi.status() != WL_CONNECTED || String(DOOR_DEVICE_TOKEN).length() == 0) return false;
        const uint8_t target = activeSlot == 0 ? 1 : 0;
        SlotWriter writer(target);
        int code = -1;
        int streamed = -1;
        {
            EntrivoHttpLock httpLock;
            HTTPClient &http = backendHttp();
            http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
            http.setTimeout(HTTP_READ_TIMEOUT_MS);
            http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
            if (!beginBackendRequest(http, "/api/door_access_cache.php?device_id=" + String(ENROLLMENT_DEVICE_ID))) return false;
            http.addHeader("X-Device-Token", DOOR_DEVICE_TOKEN);
            code = http.GET();
            if (code == HTTP_CODE_OK) {
                const int size = http.getSize();
                if (size > 0 && static_cast<uint32_t>(size) > SLOT_BYTES) {
                    SerialLog::warn("[OFFLINE SCHEDULES] The copy is larger than 64 KB; keeping the saved one.");
                } else {
                    streamed = http.writeToStream(&writer);
                }
            }
            endBackendRequest(http, streamed >= 0 ? code : -1);
        }
        if (code != HTTP_CODE_OK || streamed < 0 || !writer.ok) {
            Serial.print("[OFFLINE SCHEDULES] Download failed (HTTP ");
            Serial.print(code);
            Serial.println("). The saved copy is kept.");
            return false;
        }
        const Header fresh = verifiedHeader(target);
        if (!fresh.valid || fresh.totalBytes() != writer.written) {
            SerialLog::warn("[OFFLINE SCHEDULES] The downloaded copy failed its check; the saved copy is kept.");
            return false;
        }
        activeSlot = target;
        header = fresh;
        if (storeReady) store.putUChar("slot", activeSlot);
        Serial.print("[OFFLINE SCHEDULES] Saved: ");
        Serial.println(accessCacheSummary());
        return true;
    }

    // Unix time for an offline decision: internet / backend time, else the
    // DS3231 when this firmware has set it and it kept power. 0 = unknown.
    uint32_t offlineNow() {
        const time_t system = time(nullptr);
        if (system >= static_cast<time_t>(CLOCK_VALID_AFTER)) return static_cast<uint32_t>(system);
        return trustedRtcSeconds();
    }

    Mode currentMode() {
        const char *mode = doorScheduleMode();
        return !strcmp(mode, "off") ? Mode::Off : !strcmp(mode, "on") ? Mode::On : Mode::Auto;
    }

    OfflineAnswer check(uint8_t type, uint16_t slot, const uint8_t *uid) {
        OfflineAnswer answer{};
        if (!header.valid || activeSlot > 1) return answer;
        const uint32_t now = offlineNow();
        if (now < header.validFrom || now >= header.validUntil) return answer;

        for (uint32_t index = 0; index < header.credentials;) {
            const uint32_t batch = min<uint32_t>(sizeof(chunk) / RECORD_BYTES, header.credentials - index);
            if (!readAt(activeSlot, header.credentialsOffset() + index * RECORD_BYTES, chunk, batch * RECORD_BYTES)) return answer;
            for (uint32_t i = 0; i < batch; ++i) {
                const uint8_t *record = chunk + i * RECORD_BYTES;
                if (!credentialMatches(record, type, slot, uid)) continue;
                const uint8_t flags = credentialFlags(record);
                const uint16_t personIndex = credentialPerson(record);
                uint8_t raw[RECORD_BYTES];
                if (personIndex >= header.people
                    || !readAt(activeSlot, header.peopleOffset() + personIndex * RECORD_BYTES, raw, sizeof(raw))) return answer;
                const Person person = parsePerson(raw);
                const uint16_t count = min<uint16_t>(person.windowCount, MAX_WINDOWS_PER_PERSON);
                if (static_cast<uint32_t>(person.firstWindow) + count > header.windows
                    || (count && !readAt(activeSlot, header.windowsOffset() + person.firstWindow * RECORD_BYTES, windowBuffer, count * RECORD_BYTES))) {
                    return answer;
                }
                answer.userId = person.userId;
                answer.decision = decide(header, person, flags, windowBuffer, count, now, currentMode());
                answer.result = answer.decision.granted ? OfflineCheck::Granted : OfflineCheck::Denied;
                return answer;
            }
            index += batch;
        }
        answer.result = OfflineCheck::NotListed;
        return answer;
    }

    String dateText(uint32_t epoch) {
        // Asia/Manila (UTC+8, no daylight saving) for the Serial Monitor.
        const time_t local = static_cast<time_t>(epoch) + 8 * 3600;
        struct tm parts;
        gmtime_r(&local, &parts);
        char text[20];
        strftime(text, sizeof(text), "%Y-%m-%d %H:%M", &parts);
        return String(text);
    }
}

void initAccessCache() {
    partition = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_DATA_SPIFFS, nullptr);
    if (partition == nullptr || partition->size < 2 * SLOT_BYTES) {
        partition = nullptr;
        SerialLog::warn("[OFFLINE SCHEDULES] No data partition: choose a partition scheme with SPIFFS (e.g. Default 4MB). Offline schedules are off.");
        return;
    }
    storeReady = store.begin("acache", false);
    const uint8_t saved = storeReady ? store.getUChar("slot", 0xFF) : 0xFF;
    if (saved <= 1) {
        header = verifiedHeader(saved);
        activeSlot = header.valid ? saved : 0xFF;
    }
    SerialLog::step(String("Offline schedules: ") + accessCacheSummary());
}

void noteAccessCacheVersion(uint32_t version) {
    if (version != 0) wantedVersion = version;
}

void serviceAccessCache() {
    if (partition == nullptr || wantedVersion == 0 || (header.valid && header.version == wantedVersion)) return;
    const unsigned long wait = lastAttemptFailed ? RETRY_FAILED_MS : RETRY_OK_MS;
    if (lastAttemptAt != 0 && millis() - lastAttemptAt < wait) return;
    lastAttemptAt = millis();
    lastAttemptFailed = !download();
}

OfflineAnswer checkOfflineFinger(uint16_t slot) {
    return slot == 0 ? OfflineAnswer{} : check(TYPE_FINGER, slot, nullptr);
}

OfflineAnswer checkOfflineCard(const String &uid) {
    uint8_t bytes[5] = {};
    if (!parseUid(uid.c_str(), uid.length(), bytes)) return OfflineAnswer{};
    return check(TYPE_CARD, 0, bytes);
}

bool accessCacheUsableNow() {
    const uint32_t now = offlineNow();
    return header.valid && activeSlot <= 1 && now >= header.validFrom && now < header.validUntil;
}

String accessCacheSummary() {
    if (partition == nullptr) return "unavailable (no data partition)";
    if (!header.valid) return "none saved yet (downloaded once the backend is reached)";
    String text = String(header.people) + " people, " + String(header.credentials) + " credentials, "
        + String(header.windows) + " windows; covers until " + dateText(header.validUntil);
    if (!accessCacheUsableNow()) text += offlineNow() == 0 ? " (clock not set: not used)" : " (out of date: not used)";
    return text;
}

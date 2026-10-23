#include "SensorMemory.h"
#include "API.h"
#include "Config.h"
#include "DoorHardware.h"
#include "Fingerprint.h"
#include "SensorTransfer.h"

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <mbedtls/base64.h>
#include <mbedtls/sha256.h>
#include <mbedtls/version.h>

namespace {
    constexpr uint16_t MAX_SENSOR_CAPACITY = 4096;
    constexpr unsigned long POLL_INTERVAL_MS = 2000UL;
    // Read-only dashboard polling should yield quickly when the local API is down.
    constexpr int HTTP_CONNECT_LIMIT_MS = 250;
    constexpr int HTTP_READ_LIMIT_MS = 500;
    // Leave room before the backend's three-minute processing lease expires.
    constexpr unsigned long RESULT_LIFETIME_MS = 150000UL;
    constexpr const char *ENDPOINT = "/api/fingerprint/sensor_memory_device.php";

    enum class Phase { Idle, Parameters, Count, Index, VerifyCount, Template, Empty, Result };
    Phase g_phase = Phase::Idle;
    int g_jobId = 0;
    int g_targetSlot = -1;
    String g_kind;
    String g_claimToken;
    String g_resultBody;
    bool g_resultFailure = false;
    unsigned long g_claimedAt = 0;
    unsigned long g_lastPollAt = 0;
    unsigned long g_lastResultAt = 0;
    uint16_t g_capacity = 0;
    uint16_t g_templateCount = 0;
    uint16_t g_occupiedCount = 0;
    uint16_t g_page = 0;
    uint8_t g_occupied[MAX_SENSOR_CAPACITY / 8] = {};

    bool explicitTrue(JsonVariantConst value) {
        return value.is<bool>() && value.as<bool>();
    }

    void clearJob() {
        g_phase = Phase::Idle;
        g_jobId = 0;
        g_targetSlot = -1;
        g_kind = "";
        g_claimToken = "";
        g_resultBody = "";
        g_resultFailure = false;
        g_capacity = g_templateCount = g_occupiedCount = g_page = 0;
    }

    bool postBody(const String &body, JsonDocument &response, int &statusCode) {
        statusCode = 0;
        if (isDoorUnlocked() || WiFi.status() != WL_CONNECTED ||
            String(DOOR_DEVICE_TOKEN).length() == 0) return false;

        HTTPClient http;
        http.setConnectTimeout(HTTP_CONNECT_LIMIT_MS);
        http.setTimeout(HTTP_READ_LIMIT_MS);
        http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
        if (!http.begin(String(SERVER_URL) + ENDPOINT)) return false;
        http.addHeader("Content-Type", "application/json");
        http.addHeader("X-Device-Token", DOOR_DEVICE_TOKEN);
        statusCode = http.POST(body);
        if (statusCode <= 0) { http.end(); return false; }
        const String responseBody = http.getString();
        http.end();
        return statusCode == HTTP_CODE_OK && responseBody.length() <= 4096 &&
            !deserializeJson(response, responseBody) && response.is<JsonObject>() &&
            explicitTrue(response["success"]);
    }

    void addJobFields(JsonDocument &payload, const char *action) {
        payload["action"] = action;
        payload["device_id"] = ENROLLMENT_DEVICE_ID;
        payload["job_id"] = g_jobId;
        payload["claim_token"] = g_claimToken;
    }

    void queueFailure(const String &error) {
        DynamicJsonDocument payload(1024);
        addJobFields(payload, "fail");
        payload["error_message"] = error;
        g_resultBody = "";
        serializeJson(payload, g_resultBody);
        g_resultFailure = true;
        g_phase = Phase::Result;
        g_lastResultAt = millis() - POLL_INTERVAL_MS;
        Serial.print("[SENSOR MEMORY] "); Serial.println(error);
    }

    bool saveResult(JsonDocument &payload) {
        if (payload.overflowed()) {
            queueFailure("Not enough memory to report the complete sensor contents. Retry the read.");
            return false;
        }
        g_resultBody = "";
        const size_t expected = measureJson(payload);
        serializeJson(payload, g_resultBody);
        if (g_resultBody.length() != expected) {
            queueFailure("Not enough memory to encode the sensor result. Retry the read.");
            return false;
        }
        g_phase = Phase::Result;
        g_resultFailure = false;
        g_lastResultAt = millis() - POLL_INTERVAL_MS;
        return true;
    }

    bool claimJob() {
        DynamicJsonDocument payload(256);
        payload["action"] = "claim";
        payload["device_id"] = ENROLLMENT_DEVICE_ID;
        String body;
        serializeJson(payload, body);
        DynamicJsonDocument response(2048);
        int statusCode = 0;
        if (!postBody(body, response, statusCode) || !response.containsKey("job")) return false;
        if (response["job"].isNull()) return false;
        if (!response["job"].is<JsonObject>()) return false;
        const JsonObjectConst job = response["job"].as<JsonObjectConst>();
        if (!job["job_id"].is<int>() || job["job_id"].as<int>() <= 0 ||
            !job["device_id"].is<int>() || job["device_id"].as<int>() != ENROLLMENT_DEVICE_ID ||
            !job["kind"].is<const char *>() || !job["claim_token"].is<const char *>()) return false;
        const String kind = job["kind"].as<const char *>();
        const String token = job["claim_token"].as<const char *>();
        if ((kind != "inventory" && kind != "template" && kind != "empty") || token.length() == 0 || token.length() > 128) return false;
        if (kind == "template" && (!job["target_slot"].is<int>() ||
            job["target_slot"].as<int>() < 0 || job["target_slot"].as<int>() >= MAX_SENSOR_CAPACITY)) return false;
        if (String(job["status"] | "") != "processing") return false;

        g_jobId = job["job_id"].as<int>();
        g_kind = kind;
        g_claimToken = token;
        g_targetSlot = kind == "template" ? job["target_slot"].as<int>() : -1;
        g_claimedAt = millis();
        g_capacity = g_templateCount = g_occupiedCount = g_page = 0;
        memset(g_occupied, 0, sizeof(g_occupied));
        g_phase = Phase::Parameters;
        Serial.println(kind == "inventory" ? "[SENSOR MEMORY] Reading actual sensor slot index." :
            kind == "empty" ? "[SENSOR MEMORY] Erasing every R307S fingerprint template and slot ID." :
            "[SENSOR MEMORY] Reading one requested stored template.");
        return true;
    }

    String templateHash(const uint8_t *data, size_t length) {
        uint8_t digest[32] = {};
#if MBEDTLS_VERSION_MAJOR >= 3
        const int status = mbedtls_sha256(data, length, digest, 0);
#else
        const int status = mbedtls_sha256_ret(data, length, digest, 0);
#endif
        if (status != 0) return "";
        const char *alphabet = "0123456789abcdef";
        String hash;
        hash.reserve(64);
        for (uint8_t value : digest) { hash += alphabet[value >> 4]; hash += alphabet[value & 15]; }
        return hash;
    }

    bool encodeRawTemplate(const uint8_t *data, size_t length, String &base64, String &error) {
        // Inspection must preserve even uniform/corrupt bytes. Enrollment and import
        // continue to use their separate template usability checks.
        if (!R307TemplateStream::supportedSize(length)) {
            error = "The physical template has an unsupported byte length.";
            return false;
        }
        unsigned char encoded[((DIRECT_TEMPLATE_MAX_BYTES + 2) / 3) * 4 + 1] = {};
        size_t encodedLength = 0;
        if (mbedtls_base64_encode(encoded, sizeof(encoded), &encodedLength, data, length) != 0) {
            error = "The raw sensor template could not be encoded.";
            return false;
        }
        base64 = reinterpret_cast<const char *>(encoded);
        if (base64.length() != encodedLength) {
            error = "Not enough memory to preserve the raw sensor template.";
            return false;
        }
        return true;
    }

    void readInventoryPage() {
        uint8_t index[32] = {};
        String error;
        if (!readSensorSlotIndexPage(static_cast<uint8_t>(g_page), index, sizeof(index), error)) {
            queueFailure("The actual sensor index could not be read completely. " + error);
            return;
        }
        for (uint16_t offset = 0; offset < 256; ++offset) {
            const uint32_t slot = static_cast<uint32_t>(g_page) * 256 + offset;
            if (slot >= g_capacity) break;
            if ((index[offset / 8] & (1U << (offset % 8))) != 0) {
                g_occupied[slot / 8] |= 1U << (slot % 8);
                ++g_occupiedCount;
            }
        }
        ++g_page;
        if (static_cast<uint32_t>(g_page) * 256 >= g_capacity) g_phase = Phase::VerifyCount;
    }

    void finishInventory() {
        const uint8_t status = finger.getTemplateCount();
        if (status != FINGERPRINT_OK) {
            queueFailure("The sensor template count could not be verified (code 0x" + String(status, HEX) + ").");
            return;
        }
        if (finger.templateCount != g_templateCount || g_occupiedCount != g_templateCount) {
            queueFailure("The sensor count and occupied slot index changed or disagree. Retry the inventory read.");
            return;
        }
        DynamicJsonDocument payload(JSON_ARRAY_SIZE(g_occupiedCount) + JSON_OBJECT_SIZE(8) + 256);
        addJobFields(payload, "complete");
        payload["capacity"] = g_capacity;
        payload["template_count"] = g_templateCount;
        JsonArray slots = payload.createNestedArray("occupied_slots");
        for (uint16_t slot = 0; slot < g_capacity; ++slot)
            if ((g_occupied[slot / 8] & (1U << (slot % 8))) != 0) slots.add(slot);
        saveResult(payload);
    }

    void readTemplate() {
        uint8_t index[32] = {};
        String error;
        if (!readSensorSlotIndexPage(static_cast<uint8_t>(g_targetSlot / 256), index, sizeof(index), error)) {
            queueFailure("The requested sensor slot could not be checked. " + error);
            return;
        }
        const uint16_t offset = g_targetSlot % 256;
        if ((index[offset / 8] & (1U << (offset % 8))) == 0) {
            queueFailure("The requested slot is currently empty in the physical sensor. Refresh the inventory.");
            return;
        }
        uint8_t binary[DIRECT_TEMPLATE_MAX_BYTES] = {};
        size_t length = 0;
        String base64;
        if (!readSensorMemoryTemplate(g_targetSlot, binary, sizeof(binary), length, error) ||
            !encodeRawTemplate(binary, length, base64, error)) {
            queueFailure("The physical sensor template could not be read. " + error);
            return;
        }
        const String hash = templateHash(binary, length);
        if (hash.length() != 64) { queueFailure("The sensor template SHA-256 hash could not be calculated."); return; }
        DynamicJsonDocument payload(4096);
        addJobFields(payload, "complete");
        payload["target_slot"] = g_targetSlot;
        payload["template_data_base64"] = base64;
        payload["template_bytes"] = length;
        payload["template_hash"] = hash;
        saveResult(payload);
    }

    void eraseLibrary() {
        String error;
        if (!emptyFingerprintLibrary(error)) {
            queueFailure("The R307S could not delete its fingerprint templates. " + error);
            return;
        }
        const uint8_t countStatus = finger.getTemplateCount();
        if (countStatus != FINGERPRINT_OK || finger.templateCount != 0) {
            queueFailure("The R307S still reports stored fingerprint templates after the erase.");
            return;
        }
        for (uint16_t page = 0; static_cast<uint32_t>(page) * 256 < g_capacity; ++page) {
            uint8_t index[32] = {};
            if (!readSensorSlotIndexPage(static_cast<uint8_t>(page), index, sizeof(index), error)) {
                queueFailure("The sensor index could not be checked after the erase. " + error);
                return;
            }
            for (uint16_t offset = 0; offset < 256; ++offset) {
                const uint32_t slot = static_cast<uint32_t>(page) * 256 + offset;
                if (slot >= g_capacity) break;
                if ((index[offset / 8] & (1U << (offset % 8))) != 0) {
                    queueFailure("Sensor slot " + String(slot) + " still contains a fingerprint after the erase.");
                    return;
                }
            }
        }
        DynamicJsonDocument payload(JSON_OBJECT_SIZE(8) + 128);
        addJobFields(payload, "complete");
        payload["capacity"] = g_capacity;
        payload["template_count"] = 0;
        payload.createNestedArray("occupied_slots");
        saveResult(payload);
    }
}

void interruptSensorMemoryRead() {
    if (g_phase != Phase::Idle && g_phase != Phase::Result)
        queueFailure("Enrollment or import interrupted the sensor snapshot. Read the inventory again after that work finishes.");
}

bool serviceSensorMemory(bool sensorReady) {
    // HTTP and template transfers are synchronous while locked. Both main loops
    // skip this service while unlocked, preserving their existing lock/EXIT handling.
    if (isDoorUnlocked() || isFingerprintWorkPending()) return false;
    if (g_phase != Phase::Idle && millis() - g_claimedAt >= RESULT_LIFETIME_MS) {
        Serial.println("[SENSOR MEMORY] Result confirmation expired; request a fresh read from the web module.");
        clearJob();
    }
    if (g_phase == Phase::Result) {
        if (millis() - g_lastResultAt < POLL_INTERVAL_MS) return false;
        g_lastResultAt = millis();
        DynamicJsonDocument response(2048);
        int statusCode = 0;
        const bool received = postBody(g_resultBody, response, statusCode);
        const JsonObjectConst confirmed = response["job"].as<JsonObjectConst>();
        const bool sameJob = !confirmed.isNull() && confirmed["job_id"].is<int>() &&
            confirmed["job_id"].as<int>() == g_jobId && confirmed["device_id"].is<int>() &&
            confirmed["device_id"].as<int>() == ENROLLMENT_DEVICE_ID &&
            String(confirmed["kind"] | "") == g_kind &&
            String(confirmed["status"] | "") == (g_resultFailure ? "failed" : "completed");
        if (received && sameJob) {
            Serial.println("[SENSOR MEMORY] Read result confirmed by the backend.");
            clearJob();
        } else if (statusCode == 400 || statusCode == 401 || statusCode == 403 ||
                   statusCode == 404 || statusCode == 409 || statusCode == 422) {
            Serial.println("[SENSOR MEMORY] Read result rejected. Check the web module before retrying.");
            clearJob();
        }
        // A lost HTTP reply retries exactly the cached bytes, never another sensor read.
        return true;
    }
    if (!sensorReady) {
        if (g_phase != Phase::Idle) {
            queueFailure("The fingerprint sensor became unavailable during the read. Reconnect it and retry.");
            return true;
        }
        return false;
    }
    if (g_phase == Phase::Idle) {
        if (millis() - g_lastPollAt < POLL_INTERVAL_MS || String(DOOR_DEVICE_TOKEN).length() == 0) return false;
        g_lastPollAt = millis();
        return claimJob();
    }
    if (g_phase == Phase::Parameters) {
        const uint8_t status = finger.getParameters();
        if (status != FINGERPRINT_OK || finger.capacity == 0 || finger.capacity > MAX_SENSOR_CAPACITY) {
            queueFailure("The actual sensor capacity could not be read or exceeds the supported 4096-slot inventory (code 0x" + String(status, HEX) + ").");
        } else {
            g_capacity = finger.capacity;
            if (g_kind == "template") {
                if (g_targetSlot >= g_capacity) queueFailure("The requested slot is outside the actual sensor capacity.");
                else g_phase = Phase::Template;
            } else if (g_kind == "empty") g_phase = Phase::Empty;
            else g_phase = Phase::Count;
        }
    } else if (g_phase == Phase::Count) {
        const uint8_t status = finger.getTemplateCount();
        if (status != FINGERPRINT_OK || finger.templateCount > g_capacity)
            queueFailure("The actual sensor template count could not be read (code 0x" + String(status, HEX) + ").");
        else { g_templateCount = finger.templateCount; g_phase = Phase::Index; }
    } else if (g_phase == Phase::Index) readInventoryPage();
    else if (g_phase == Phase::VerifyCount) finishInventory();
    else if (g_phase == Phase::Template) readTemplate();
    else if (g_phase == Phase::Empty) eraseLibrary();
    return true;
}

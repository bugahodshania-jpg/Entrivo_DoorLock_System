#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

#include "API.h"
#include "Config.h"
#include "DoorHardware.h"
#include "DirectImport.h"
#include "Fingerprint.h"
#include "SensorTransfer.h"

namespace
{
    constexpr size_t JSON_BUFFER_SIZE = 4096;
    constexpr unsigned long IMPORT_CONFIRMATION_TIMEOUT_MS = 180000UL;
    int g_importResultJobId = 0;
    int g_importResultSlot = 0;
    String g_importResultHash;
    String g_importResultError;
    unsigned long g_importResultStartedAt = 0;
    EnrollmentJob g_enrollmentResultJob;
    String g_enrollmentResultTemplate;
    unsigned long g_enrollmentResultStartedAt = 0;

    bool isExplicitTrue(JsonVariantConst value)
    {
        return value.is<bool>() && value.as<bool>();
    }

    bool readVerification(JsonVariantConst node, DoorEnrollmentProof::Verification &proof)
    {
        proof = {};
        if (!node.is<JsonObjectConst>()) return false;
        const JsonObjectConst object = node.as<JsonObjectConst>();
        if (!isExplicitTrue(object["fresh_scan_verified"]) || !object["stored_slot"].is<int>() ||
            !object["matched_slot"].is<int>() || !object["confidence"].is<int>() ||
            !object["template_bytes"].is<int>() || !object["template_sha256"].is<const char *>()) return false;
        const char *hash = object["template_sha256"].as<const char *>();
        if (strlen(hash) != 64) return false;
        proof.freshScanVerified = true;
        proof.storedSlot = object["stored_slot"].as<int>();
        proof.matchedSlot = object["matched_slot"].as<int>();
        proof.confidence = object["confidence"].as<int>();
        proof.templateBytes = object["template_bytes"].as<int>();
        memcpy(proof.templateSha256, hash, 64);
        return DoorEnrollmentProof::validVerification(proof, proof.storedSlot);
    }

    bool beginRequest(HTTPClient &http, const String &endpoint)
    {
        if (isDoorUnlocked() || WiFi.status() != WL_CONNECTED)
        {
            return false;
        }

        http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
        http.setTimeout(HTTP_READ_TIMEOUT_MS);
        // A redirect or unexpected status must never grant door access.
        http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
        return http.begin(String(SERVER_URL) + endpoint);
    }

    bool postJson(const String &endpoint, JsonDocument &payload, JsonDocument &response, int *statusCode = nullptr)
    {
        if (statusCode != nullptr)
        {
            *statusCode = 0;
        }
        HTTPClient http;
        if (!beginRequest(http, endpoint))
        {
            return false;
        }

        http.addHeader("Content-Type", "application/json");
        http.addHeader("X-Device-Token", DOOR_DEVICE_TOKEN);
        String requestBody;
        serializeJson(payload, requestBody);
        const int responseCode = http.POST(requestBody);
        if (statusCode != nullptr)
        {
            *statusCode = responseCode;
        }
        if (responseCode != HTTP_CODE_OK)
        {
            http.end();
            return false;
        }

        const String responseBody = http.getString();
        http.end();
        return !deserializeJson(response, responseBody) && response.is<JsonObject>() &&
            isExplicitTrue(response["success"]);
    }

    bool fetchPendingJob(EnrollmentJob &job)
    {
        HTTPClient http;
        if (!beginRequest(http, "/api/fingerprint/get_pending_job.php?enrollment_device_id=" +
                          String(ENROLLMENT_DEVICE_ID)))
        {
            return false;
        }

        if (http.GET() != HTTP_CODE_OK)
        {
            http.end();
            return false;
        }

        const String responseBody = http.getString();
        http.end();
        DynamicJsonDocument response(JSON_BUFFER_SIZE);
        if (deserializeJson(response, responseBody) || !isExplicitTrue(response["success"]) ||
            !response["job"].is<JsonObject>())
        {
            return false;
        }

        const JsonObjectConst jobNode = response["job"].as<JsonObjectConst>();
        job.jobId = jobNode["job_id"] | 0;
        job.userId = jobNode["user_id"] | 0;
        job.deviceId = jobNode["enrollment_device_id"] | 0;
        job.assignedSlot = jobNode["assigned_slot"] | 0;
        job.fingerName = String(jobNode["finger_name"] | "Fingerprint");
        return job.jobId > 0 && job.deviceId == ENROLLMENT_DEVICE_ID;
    }

    bool fetchPendingImport(DirectImportJob &job)
    {
        HTTPClient http;
        if (!beginRequest(http, "/api/fingerprint/direct_import_device.php?enrollment_device_id=" +
                          String(ENROLLMENT_DEVICE_ID)))
        {
            return false;
        }
        if (http.GET() != HTTP_CODE_OK)
        {
            http.end();
            return false;
        }
        const String body = http.getString();
        http.end();
        DynamicJsonDocument response(JSON_BUFFER_SIZE);
        if (deserializeJson(response, body) || !isExplicitTrue(response["success"]) ||
            !response["job"].is<JsonObject>())
        {
            return false;
        }
        const JsonObjectConst node = response["job"].as<JsonObjectConst>();
        job.jobId = node["job_id"] | 0;
        job.fingerprintId = node["fingerprint_id"] | 0;
        job.deviceId = node["enrollment_device_id"] | 0;
        job.targetSlot = node["target_slot"] | 0;
        job.templateBytes = node["template_bytes"] | 0;
        job.templateDataBase64 = String(node["template_data_base64"] | "");
        job.templateHash = String(node["template_hash"] | "");
        return job.jobId > 0 && job.deviceId == ENROLLMENT_DEVICE_ID;
    }

    bool confirmImportResult(int &statusCode)
    {
        DynamicJsonDocument payload(1024);
        payload["action"] = g_importResultHash.length() == 64 ? "complete" : "fail";
        payload["job_id"] = g_importResultJobId;
        payload["enrollment_device_id"] = ENROLLMENT_DEVICE_ID;
        payload["stored_slot"] = g_importResultSlot;
        payload["template_hash"] = g_importResultHash;
        payload["error_message"] = g_importResultError;
        DynamicJsonDocument response(JSON_BUFFER_SIZE);
        return postJson("/api/fingerprint/direct_import_device.php", payload, response, &statusCode);
    }

    bool importResultRejected(int statusCode)
    {
        return statusCode == 401 || statusCode == 404 || statusCode == 409 || statusCode == 403 || statusCode == 422;
    }
}

bool checkPendingEnrollment()
{
    if (isDoorUnlocked() || g_importResultJobId > 0)
    {
        return false;
    }

    if (g_enrollmentResultJob.jobId > 0)
    {
        int statusCode = 0;
        if (completeEnrollmentJob(g_enrollmentResultJob, g_enrollmentResultTemplate, &statusCode))
        {
            Serial.println("Enrollment and database backup confirmed. Remove your finger before scanning.");
            g_enrollmentResultJob.jobId = 0;
            g_enrollmentResultTemplate = "";
        }
        else if (importResultRejected(statusCode) || millis() - g_enrollmentResultStartedAt >= IMPORT_CONFIRMATION_TIMEOUT_MS)
        {
            const String reason = importResultRejected(statusCode)
                ? "Backend rejected verified enrollment confirmation (HTTP " + String(statusCode) + ")."
                : "Verified enrollment confirmation timed out before a matching completed response.";
            Serial.println(reason);
            failEnrollmentJob(g_enrollmentResultJob.jobId, reason);
            Serial.println("Check the web module before retrying; the local slot is preserved.");
            g_enrollmentResultJob.jobId = 0;
            g_enrollmentResultTemplate = "";
        }
        return true;
    }

    EnrollmentJob job;
    if (!fetchPendingJob(job))
    {
        return false;
    }

    // Enrollment and door scanning share one sensor. Enrollment always runs while locked.
    lockDoorRelay();
    if (job.assignedSlot <= 0 || job.assignedSlot > UINT16_MAX)
    {
        failEnrollmentJob(job.jobId, "The backend did not reserve a valid sensor slot.");
        return true;
    }

    Serial.print("Enrollment claimed. Door scanning paused for job #");
    Serial.println(job.jobId);
    String templateDataBase64;
    String errorMessage;
    if (!runEnrollmentJob(job, templateDataBase64, errorMessage))
    {
        Serial.print("Enrollment failure: ");
        Serial.println(errorMessage);
        failEnrollmentJob(job.jobId, errorMessage);
        Serial.println("Enrollment failed. Remove your finger before scanning for access.");
        return true;
    }

    int statusCode = 0;
    if (!completeEnrollmentJob(job, templateDataBase64, &statusCode))
    {
        // Retry this exact proof after connection loss; never capture/store a second model.
        if (!importResultRejected(statusCode))
        {
            g_enrollmentResultJob = job;
            g_enrollmentResultTemplate = templateDataBase64;
            g_enrollmentResultStartedAt = millis();
            Serial.println("Enrollment proof awaiting confirmation. Retrying while access scanning is paused.");
        }
        else {
            const String reason = "Backend rejected verified enrollment confirmation (HTTP " + String(statusCode) + ").";
            Serial.println(reason);
            failEnrollmentJob(job.jobId, reason);
            Serial.println("Check the web module; the local slot is preserved.");
        }
        return true;
    }

    Serial.println("Enrollment completed and backed up. Remove your finger before scanning for access.");
    return true;
}

bool reportEnrollmentProgress(int jobId, int progress, const String &currentStep)
{
    DynamicJsonDocument payload(512);
    payload["job_id"] = jobId;
    payload["enrollment_device_id"] = ENROLLMENT_DEVICE_ID;
    payload["progress"] = progress;
    payload["current_step"] = currentStep;
    DynamicJsonDocument response(JSON_BUFFER_SIZE);
    const bool updated = postJson("/api/fingerprint/update_progress.php", payload, response);
    Serial.println(currentStep);
    return updated;
}

bool reserveEmptyEnrollmentSlot(EnrollmentJob &job, String &errorMessage)
{
    if (isDoorUnlocked() || job.deviceId != ENROLLMENT_DEVICE_ID ||
        finger.getParameters() != FINGERPRINT_OK || finger.capacity < 2)
    {
        errorMessage = "Could not read the sensor capacity to reserve an empty fingerprint slot.";
        return false;
    }
    const uint16_t sensorCapacity = finger.capacity;
    const int previousSlot = job.assignedSlot;
    DynamicJsonDocument payload(JSON_ARRAY_SIZE(sensorCapacity) + JSON_OBJECT_SIZE(6) + 128);
    if (payload.capacity() == 0)
    {
        errorMessage = "Not enough memory to check all occupied fingerprint slots. Existing fingerprints were preserved.";
        return false;
    }
    payload["job_id"] = job.jobId;
    payload["enrollment_device_id"] = ENROLLMENT_DEVICE_ID;
    payload["expected_assigned_slot"] = previousSlot;
    payload["sensor_capacity"] = sensorCapacity;
    JsonArray occupiedSlots = payload.createNestedArray("occupied_slots");
    // Read the index only: loading a template here would destroy the fresh model.
    for (uint16_t page = 0; page < (static_cast<uint32_t>(sensorCapacity) + 255) / 256; ++page)
    {
        uint8_t index[32] = {};
        if (!readSensorSlotIndexPage(static_cast<uint8_t>(page), index, sizeof(index), errorMessage)) return false;
        for (uint16_t offset = 0; offset < 256; ++offset)
        {
            const uint32_t slot = static_cast<uint32_t>(page) * 256 + offset;
            if (slot >= sensorCapacity) break;
            if ((index[offset / 8] & (1U << (offset % 8))) != 0) occupiedSlots.add(slot);
        }
    }
    if (payload.overflowed())
    {
        errorMessage = "The occupied fingerprint slot list was incomplete. Existing fingerprints were preserved.";
        return false;
    }

    DynamicJsonDocument response(JSON_BUFFER_SIZE);
    if (!postJson("/api/fingerprint/reserve_empty_slot.php", payload, response))
    {
        errorMessage = String(response["message"] | "The backend could not confirm an empty fingerprint slot. Check the connection and retry.");
        return false;
    }
    const int reservedSlot = response["assigned_slot"] | 0;
    if ((response["job_id"] | 0) != job.jobId || reservedSlot <= 0 ||
        reservedSlot >= sensorCapacity || reservedSlot == previousSlot)
    {
        errorMessage = "The backend returned an invalid replacement fingerprint slot. Existing fingerprints were preserved.";
        return false;
    }
    // Completion and any pending completion proof must use the backend's new reservation.
    job.assignedSlot = reservedSlot;
    Serial.print("Preserved occupied sensor slot ");
    Serial.print(previousSlot);
    Serial.print(". Backend reserved replacement slot ");
    Serial.println(job.assignedSlot);
    return true;
}

bool completeEnrollmentJob(const EnrollmentJob &job, const String &templateDataBase64, int *statusCode)
{
    if (statusCode) *statusCode = 0;
    if (job.jobId <= 0 || job.deviceId != ENROLLMENT_DEVICE_ID ||
        !DoorEnrollmentProof::validVerification(job.verification, job.assignedSlot) ||
        templateDataBase64.length() != ((job.verification.templateBytes + 2) / 3) * 4) return false;
    // A 1536-byte sensor template needs 2048 Base64 characters plus JSON fields.
    DynamicJsonDocument payload(4096);
    payload["job_id"] = job.jobId;
    payload["enrollment_device_id"] = ENROLLMENT_DEVICE_ID;
    payload["assigned_slot"] = job.assignedSlot;
    payload["template_data_base64"] = templateDataBase64;
    JsonObject verification = payload.createNestedObject("verification");
    verification["fresh_scan_verified"] = job.verification.freshScanVerified;
    verification["stored_slot"] = job.verification.storedSlot;
    verification["matched_slot"] = job.verification.matchedSlot;
    verification["confidence"] = job.verification.confidence;
    verification["template_bytes"] = job.verification.templateBytes;
    verification["template_sha256"] = job.verification.templateSha256;
    DynamicJsonDocument response(JSON_BUFFER_SIZE);
    if (!postJson("/api/fingerprint/complete_enrollment.php", payload, response, statusCode) ||
        !response["job"].is<JsonObjectConst>()) return false;
    const JsonObjectConst confirmedJob = response["job"].as<JsonObjectConst>();
    DoorEnrollmentProof::Verification confirmedProof;
    if (!readVerification(response["verification"], confirmedProof) ||
        !confirmedJob["job_id"].is<int>() || !confirmedJob["enrollment_device_id"].is<int>() ||
        !confirmedJob["assigned_slot"].is<int>()) return false;
    const char *status = confirmedJob["status"] | "";
    const char *verifiedAt = response["verification"]["verified_at"] | "";
    return DoorEnrollmentProof::completionConfirmed(job.verification, confirmedProof,
        job.jobId, job.deviceId, confirmedJob["job_id"].as<int>(),
        confirmedJob["enrollment_device_id"].as<int>(), confirmedJob["assigned_slot"].as<int>(),
        strcmp(status, "completed") == 0, verifiedAt[0] != '\0');
}

bool failEnrollmentJob(int jobId, const String &errorMessage)
{
    DynamicJsonDocument payload(1024);
    payload["job_id"] = jobId;
    payload["enrollment_device_id"] = ENROLLMENT_DEVICE_ID;
    payload["error_message"] = errorMessage;
    DynamicJsonDocument response(JSON_BUFFER_SIZE);
    return postJson("/api/fingerprint/fail_enrollment.php", payload, response);
}

bool authorizeMatchedFingerprint(uint16_t matchedSlot, String &message)
{
    message = "Door access unavailable. Check WiFi and the backend.";
    if (matchedSlot == 0 || isDoorUnlocked() || isFingerprintWorkPending())
    {
        return false;
    }

    DynamicJsonDocument payload(256);
    payload["enrollment_device_id"] = ENROLLMENT_DEVICE_ID;
    payload["matched_slot"] = matchedSlot;
    DynamicJsonDocument response(JSON_BUFFER_SIZE);
    if (!postJson("/api/fingerprint/verify_direct_access.php", payload, response))
    {
        return false;
    }

    message = String(response["message"] | "Door access denied.");
    return isExplicitTrue(response["access_granted"]);
}

bool isFingerprintWorkPending()
{
    return g_importResultJobId > 0 || g_enrollmentResultJob.jobId > 0;
}

bool reportDirectImportProgress(int jobId, int progress, const String &currentStep)
{
    DynamicJsonDocument payload(1024);
    payload["action"] = "progress";
    payload["job_id"] = jobId;
    payload["enrollment_device_id"] = ENROLLMENT_DEVICE_ID;
    payload["progress"] = progress;
    payload["current_step"] = currentStep;
    DynamicJsonDocument response(JSON_BUFFER_SIZE);
    return postJson("/api/fingerprint/direct_import_device.php", payload, response);
}

bool checkPendingDirectImport()
{
    if (isDoorUnlocked() || g_enrollmentResultJob.jobId > 0)
    {
        return false;
    }
    if (g_importResultJobId > 0)
    {
        int statusCode = 0;
        if (confirmImportResult(statusCode))
        {
            Serial.println(g_importResultHash.length() == 64 ?
                "Direct import verified and confirmed by the backend. Remove your finger before scanning." :
                "Direct import failure reported. Check the web module for its reason.");
            g_importResultJobId = 0;
        }
        else if (importResultRejected(statusCode) || millis() - g_importResultStartedAt >= IMPORT_CONFIRMATION_TIMEOUT_MS)
        {
            Serial.println("Direct import confirmation expired. Check the web module and retry the same import.");
            g_importResultJobId = 0;
        }
        return true;
    }

    DirectImportJob job;
    if (!fetchPendingImport(job))
    {
        return false;
    }
    lockDoorRelay();
    Serial.println("Direct import claimed. Enrollment and door scanning are paused.");
    g_importResultStartedAt = millis();
    String verifiedHash;
    String errorMessage;
    const bool imported = runDirectImportJob(job, verifiedHash, errorMessage);
    g_importResultJobId = job.jobId;
    g_importResultSlot = job.targetSlot;
    g_importResultHash = imported ? verifiedHash : String("");
    g_importResultError = errorMessage;
    int statusCode = 0;
    if (confirmImportResult(statusCode))
    {
        Serial.println(imported ? "Direct import completed. Remove your finger before scanning for access." : errorMessage);
        g_importResultJobId = 0;
    }
    else if (importResultRejected(statusCode))
    {
        Serial.println("The backend rejected this import result. Check the web module before retrying.");
        g_importResultJobId = 0;
    }
    else
    {
        // A lost completion response must retry the same proof, never allocate/write another slot.
        Serial.println("Import result could not be confirmed. Retrying the same job while the door stays locked.");
    }
    return true;
}

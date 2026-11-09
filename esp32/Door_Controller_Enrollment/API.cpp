#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <memory>
#include <new>

#include "API.h"
#include "BackendClient.h"
#include "Config.h"
#include "DoorHardware.h"
#include "DirectImport.h"
#include "Fingerprint.h"
#include "HttpLock.h"
#include "SensorTransfer.h"
#include "SerialLog.h"

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
    int g_verifyJobId = 0;
    String g_verifyClaimToken;

    bool isExplicitTrue(JsonVariantConst value)
    {
        return value.is<bool>() && value.as<bool>();
    }

    bool readVerification(JsonVariantConst node, DoorEnrollmentProof::Verification &proof)
    {
        proof = {};
        if (!node.is<JsonObjectConst>()) return false;
        const JsonObjectConst object = node.as<JsonObjectConst>();
        if (!object["stored_slot"].is<int>()) return false;
        proof.freshScanVerified = isExplicitTrue(object["fresh_scan_verified"]);
        proof.storageConfirmed = isExplicitTrue(object["storage_confirmed"]) || proof.freshScanVerified;
        proof.storedSlot = object["stored_slot"].as<int>();
        proof.matchedSlot = object["matched_slot"].is<int>() ? object["matched_slot"].as<int>() : proof.storedSlot;
        proof.confidence = object["confidence"].is<int>() ? object["confidence"].as<int>() : 1;
        proof.templateBytes = object["template_bytes"].is<int>() ? object["template_bytes"].as<int>() : 0;
        if (object["template_sha256"].is<const char *>()) {
            const char *hash = object["template_sha256"].as<const char *>();
            if (strlen(hash) == 64) memcpy(proof.templateSha256, hash, 64);
        }
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
        return beginBackendRequest(http, endpoint);
    }

    bool postJson(const String &endpoint, JsonDocument &payload, JsonDocument &response, int *statusCode = nullptr)
    {
        if (statusCode != nullptr)
        {
            *statusCode = 0;
        }
        EntrivoHttpLock httpLock;
        HTTPClient &http = backendHttp();
        if (!beginRequest(http, endpoint))
        {
            SerialLog::httpFailure(endpoint, WiFi.status() == WL_CONNECTED ? 0 : -4,
                isDoorUnlocked() ? "Request skipped: door is unlocked." : "Request skipped: WiFi is not connected.");
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
        const String responseBody = http.getString();
        endBackendRequest(http, responseCode);
        if (deserializeJson(response, responseBody) || !response.is<JsonObject>()) {
            SerialLog::httpFailure(endpoint, responseCode, responseCode > 0
                ? "Response was not valid JSON (PHP warning or HTML error page?). First bytes: " + responseBody.substring(0, 80)
                : String(""));
            return false;
        }
        const bool accepted = responseCode == HTTP_CODE_OK && isExplicitTrue(response["success"]);
        if (!accepted) {
            String detail = String(response["message"] | "");
            const String reason = String(response["reason"] | "");
            if (reason.length()) detail += " [reason: " + reason + "]";
            const String error = String(response["error"] | "");
            if (error.length()) detail += " [error: " + error + "]";
            SerialLog::httpFailure(endpoint, responseCode, detail);
        }
        return accepted;
    }

    bool fetchPendingJob(EnrollmentJob &job)
    {
        EntrivoHttpLock httpLock;
        HTTPClient &http = backendHttp();
        if (!beginRequest(http, "/api/fingerprint/get_pending_job.php?enrollment_device_id=" +
                          String(ENROLLMENT_DEVICE_ID)))
        {
            return false;
        }
        http.addHeader("X-Device-Token", DOOR_DEVICE_TOKEN);

        const int responseCode = http.GET();
        if (responseCode != HTTP_CODE_OK)
        {
            if (responseCode > 0) http.getString(); // drain so the connection can be reused
            endBackendRequest(http, responseCode);
            return false;
        }

        const String responseBody = http.getString();
        endBackendRequest(http, responseCode);
        DynamicJsonDocument response(JSON_BUFFER_SIZE);
        if (deserializeJson(response, responseBody) || !isExplicitTrue(response["success"]) ||
            !response["job"].is<JsonObject>())
        {
            return false;
        }

        const JsonObjectConst jobNode = response["job"].as<JsonObjectConst>();
        job.jobId = jobNode["job_id"] | 0;
        job.userId = jobNode["user_id"] | 0;
        job.fingerprintId = jobNode["fingerprint_id"] | 0;
        job.deviceId = jobNode["enrollment_device_id"] | 0;
        job.assignedSlot = jobNode["assigned_slot"] | 0;
        job.previousSlot = jobNode["previous_slot"] | 0;
        job.isUpdate = String(jobNode["job_mode"] | "") == "update";
        job.recovery = jobNode["recovery"] | false;
        job.fingerName = String(jobNode["finger_name"] | "Fingerprint");
        return job.jobId > 0 && job.deviceId == ENROLLMENT_DEVICE_ID;
    }

    bool fetchPendingImport(DirectImportJob &job)
    {
        EntrivoHttpLock httpLock;
        HTTPClient &http = backendHttp();
        if (!beginRequest(http, "/api/fingerprint/direct_import_device.php?enrollment_device_id=" +
                          String(ENROLLMENT_DEVICE_ID)))
        {
            return false;
        }
        const int responseCode = http.GET();
        if (responseCode != HTTP_CODE_OK)
        {
            if (responseCode > 0) http.getString(); // drain so the connection can be reused
            endBackendRequest(http, responseCode);
            return false;
        }
        const String body = http.getString();
        endBackendRequest(http, responseCode);
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
        String reportError;
        if (reportIdentifyMatch(g_enrollmentResultJob, g_enrollmentResultTemplate, reportError))
        {
            SerialLog::ok("Stored template reported. Waiting for Super Admin download.");
            g_enrollmentResultJob.jobId = 0;
            g_enrollmentResultTemplate = "";
        }
        else if (millis() - g_enrollmentResultStartedAt >= IMPORT_CONFIRMATION_TIMEOUT_MS)
        {
            SerialLog::step(reportError.length() ? reportError :
                "Stored-template report timed out. The stored slot is preserved for recovery.");
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

    SerialLog::section(String(job.recovery ? "ENROLLMENT RECOVERY" : "ENROLLMENT") + " JOB #" + String(job.jobId));
    SerialLog::kv("Finger", job.fingerName);
    SerialLog::kv("User ID", String(job.userId));
    SerialLog::kv("Mode", job.isUpdate ? "Update existing fingerprint" : "New enrollment");
    SerialLog::kv("Reserved slot", String(job.assignedSlot));
    if (job.previousSlot > 0) SerialLog::kv("Previous slot", String(job.previousSlot));
    SerialLog::kv("Sensor capacity", String(finger.capacity));
    SerialLog::kv("Door scanning", "paused until this job ends");
    String templateDataBase64;
    String errorMessage;
    if (!runEnrollmentJob(job, templateDataBase64, errorMessage))
    {

        // Unsuccessful enrollment / recovery must close the job so the admin restarts
        // a fresh two-scan Adafruit enrollment. Sensor rollback is handled in Enrollment.cpp.
        if (errorMessage.length() == 0) {
            errorMessage = job.recovery
                ? "Could not read the stored slot for download. Start enrollment again."
                : "Enrollment failed before download. Start enrollment again.";
        }
        const bool reported = failEnrollmentJob(job.jobId, errorMessage);
        SerialLog::result(false, "Enrollment job #" + String(job.jobId) + " rolled back", errorMessage);
        if (!reported) SerialLog::warn("The backend did not confirm the failure. The dashboard may need a refresh.");
        return true;
    }
    if (!job.verification.storageConfirmed || job.verification.templateBytes <= 0
        || templateDataBase64.length() == 0)
    {
        // Safety net: never open Download without the exact stored-slot template.
        String eraseError;
        deleteStoredFingerprint(static_cast<uint16_t>(job.assignedSlot), eraseError);
        String rollbackError = "Enrollment stored on Sensor A but the download template was incomplete. "
            "The sensor template was rolled back. Start enrollment again.";
        if (eraseError.length()) {
            rollbackError += " " + eraseError;
        }
        failEnrollmentJob(job.jobId, rollbackError);
        SerialLog::result(false, "Enrollment job #" + String(job.jobId) + " rolled back", rollbackError);
        return true;
    }

    String reportError;
    if (!reportIdentifyMatch(job, templateDataBase64, reportError))
    {
        g_enrollmentResultJob = job;
        g_enrollmentResultTemplate = templateDataBase64;
        g_enrollmentResultStartedAt = millis();
        SerialLog::step(reportError.length() ? reportError :
            "Stored slot confirmed. Retrying the template report while access scanning is paused.");
        return true;
    }

    SerialLog::result(true, "Enrollment job #" + String(job.jobId) + " verified at slot " + String(job.assignedSlot),
        "Waiting for the Super Admin to download the template.");
    return true;
}

bool reportEnrollmentProgress(int jobId, int progress, const String &currentStep, String *errorMessage)
{
    DynamicJsonDocument payload(512);
    payload["job_id"] = jobId;
    payload["enrollment_device_id"] = ENROLLMENT_DEVICE_ID;
    payload["progress"] = progress;
    payload["current_step"] = currentStep;
    DynamicJsonDocument response(JSON_BUFFER_SIZE);
    int statusCode = 0;
    SerialLog::step(currentStep + "  (" + String(progress) + "%)");
    // A dropped request (-1 connect failed, -11 read timeout) must not abort a
    // finger scan the sensor already captured. The backend UPDATE is
    // idempotent, so the same progress is resent. A real backend answer
    // (e.g. HTTP 409 when the admin cancelled the job) is never retried.
    constexpr uint8_t PROGRESS_ATTEMPTS = 3;
    bool updated = false;
    for (uint8_t attempt = 1; attempt <= PROGRESS_ATTEMPTS; ++attempt) {
        response.clear();
        updated = postJson("/api/fingerprint/update_progress.php", payload, response, &statusCode);
        if (updated || statusCode > 0 || attempt == PROGRESS_ATTEMPTS) break;
        Serial.print("  [HTTP] Progress not delivered (transport ");
        Serial.print(statusCode);
        Serial.print(", WiFi signal ");
        Serial.print(WiFi.status() == WL_CONNECTED ? String(WiFi.RSSI()) + " dBm" : String("offline"));
        Serial.print("). Retrying ");
        Serial.print(attempt + 1);
        Serial.print("/");
        Serial.println(PROGRESS_ATTEMPTS);
        delay(400);
    }
    if (!updated) {
        String detail = String(response["message"] | "");
        if (detail.length() == 0) detail = statusCode <= 0
            ? String("Could not reach the backend (transport code ") + String(statusCode) + "). Check WiFi and SERVER_URL."
            : String("The backend returned HTTP ") + String(statusCode) + " without a valid progress confirmation.";
        if (errorMessage) *errorMessage = String("Enrollment progress was not confirmed: ") + detail;

    }
    return updated;
}

bool reportEnrollmentStored(const EnrollmentJob &job, const String &currentStep)
{
    DynamicJsonDocument payload(768);
    payload["job_id"] = job.jobId;
    payload["enrollment_device_id"] = ENROLLMENT_DEVICE_ID;
    payload["assigned_slot"] = job.assignedSlot;
    payload["current_step"] = currentStep;
    DynamicJsonDocument response(JSON_BUFFER_SIZE);
    const bool updated = postJson("/api/fingerprint/mark_stored.php", payload, response);
    if (updated) SerialLog::ok("Backend recorded: " + currentStep);
    return updated;
}

bool reportIdentifyMatch(const EnrollmentJob &job, const String &templateDataBase64, String &errorMessage)
{
    if (job.jobId <= 0 ||
        !job.verification.storageConfirmed ||
        !DoorEnrollmentProof::validVerification(job.verification, job.assignedSlot) ||
        job.verification.templateBytes <= 0) {
        errorMessage = "The stored-slot template is incomplete.";
        return false;
    }
    if (job.verification.templateBytes > 0 &&
        templateDataBase64.length() != ((job.verification.templateBytes + 2) / 3) * 4) {
        errorMessage = "The stored-slot template encoding is incomplete.";
        return false;
    }
    DynamicJsonDocument payload(4096);
    payload["job_id"] = job.jobId;
    payload["enrollment_device_id"] = ENROLLMENT_DEVICE_ID;
    payload["assigned_slot"] = job.assignedSlot;
    payload["template_data_base64"] = templateDataBase64;
    JsonObject verification = payload.createNestedObject("verification");
    verification["fresh_scan_verified"] = job.verification.freshScanVerified;
    verification["storage_confirmed"] = true;
    verification["stored_slot"] = job.verification.storedSlot;
    verification["matched_slot"] = job.verification.matchedSlot;
    verification["confidence"] = job.verification.confidence;
    verification["template_bytes"] = job.verification.templateBytes;
    verification["template_sha256"] = job.verification.templateSha256;
    DynamicJsonDocument response(JSON_BUFFER_SIZE);
    if (!postJson("/api/fingerprint/report_identify_match.php", payload, response)) {
        errorMessage = String(response["message"] | "The backend did not accept the stored-slot template.");
        return false;
    }
    if ((response["job_id"] | 0) != job.jobId ||
        (response["matched_slot"] | 0) != job.verification.matchedSlot ||
        (response["template_bytes"] | 0) != (int) job.verification.templateBytes) {
        errorMessage = "The backend returned a different stored-slot template.";
        return false;
    }
    errorMessage = "";
    return true;
}

bool stageEnrollmentBackup(const EnrollmentJob &job, const String &templateDataBase64, size_t templateBytes, const String &templateHash, String &errorMessage)
{
    DynamicJsonDocument payload(4096);
    payload["job_id"] = job.jobId;
    payload["enrollment_device_id"] = job.deviceId;
    payload["assigned_slot"] = job.assignedSlot;
    payload["template_data_base64"] = templateDataBase64;
    payload["template_bytes"] = templateBytes;
    payload["template_sha256"] = templateHash;
    DynamicJsonDocument response(JSON_BUFFER_SIZE);
    if (!postJson("/api/fingerprint/stage_enrollment_backup.php", payload, response)) {
        errorMessage = String(response["message"] | "MySQL did not confirm the fingerprint backup. The sensor slot is preserved for recovery.");
        return false;
    }
    if ((response["job_id"] | 0) != job.jobId ||
        (response["assigned_slot"] | 0) != job.assignedSlot ||
        (response["template_bytes"] | 0) != templateBytes ||
        String(response["template_sha256"] | "") != templateHash) {
        errorMessage = "MySQL returned a backup confirmation for a different job, slot, or template.";
        return false;
    }
    return true;
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
    SerialLog::warn("Slot " + String(previousSlot) + " was occupied and preserved. Backend reserved replacement slot "
        + String(job.assignedSlot) + ".");
    return true;
}

bool completeEnrollmentJob(const EnrollmentJob &job, const String &templateDataBase64, int *statusCode)
{
    if (statusCode) *statusCode = 0;
    if (job.jobId <= 0 || job.deviceId != ENROLLMENT_DEVICE_ID ||
        !job.verification.freshScanVerified ||
        !DoorEnrollmentProof::validVerification(job.verification, job.assignedSlot)) return false;
    if (job.verification.templateBytes > 0 &&
        templateDataBase64.length() != ((job.verification.templateBytes + 2) / 3) * 4) return false;
    // A 1536-byte sensor template needs 2048 Base64 characters plus JSON fields.
    DynamicJsonDocument payload(4096);
    payload["job_id"] = job.jobId;
    payload["enrollment_device_id"] = ENROLLMENT_DEVICE_ID;
    payload["assigned_slot"] = job.assignedSlot;
    payload["template_data_base64"] = templateDataBase64;
    JsonObject verification = payload.createNestedObject("verification");
    verification["fresh_scan_verified"] = job.verification.freshScanVerified;
    verification["storage_confirmed"] = job.verification.storageConfirmed;
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

bool authorizeMatchedFingerprint(uint16_t matchedSlot, String &message, bool isExit, bool *exitOnly)
{
    if (exitOnly) *exitOnly = false;
    message = "Door access unavailable. Check WiFi and the backend.";
    if (matchedSlot == 0 || isFingerprintWorkPending())
    {
        return false;
    }
    if (isDoorUnlocked() && !isExit)
    {
        return false;
    }

    String liveTemplateHash;
    if (!readStoredTemplateHash(matchedSlot, liveTemplateHash, message, isExit)) return false;
    DynamicJsonDocument payload(512);
    payload["method"] = "fingerprint";
    payload["enrollment_device_id"] = ENROLLMENT_DEVICE_ID;
    payload["matched_slot"] = matchedSlot;
    payload["template_hash"] = liveTemplateHash;
    payload["direction"] = isExit ? "exit" : "entry";
    DynamicJsonDocument response(JSON_BUFFER_SIZE);
    if (!postJson("/api/door/verify_access.php", payload, response))
    {
        return false;
    }

    message = String(response["message"] | "Door access denied.");
    const bool granted = isExplicitTrue(response["access_granted"]);
    if (exitOnly) *exitOnly = granted && !isExit && isExplicitTrue(response["exit_only"]);
    return granted;
}

bool authorizeRfid(const String &uid, bool isExit, String &message)
{
    message = "RFID verification unavailable. Check WiFi, the device token, and the backend.";
    if (isFingerprintWorkPending() || (isDoorUnlocked() && isExitAuthorized())) return false;
    DynamicJsonDocument payload(512);
    payload["method"] = "rfid";
    payload["enrollment_device_id"] = ENROLLMENT_DEVICE_ID;
    payload["rfid_uid"] = uid;
    payload["direction"] = isExit ? "exit" : "entry";
    DynamicJsonDocument response(JSON_BUFFER_SIZE);
    if (!postJson("/api/door/verify_access.php", payload, response)) return false;
    message = String(response["message"] | "RFID access denied.");
    return isExplicitTrue(response["access_granted"]);
}

bool isFingerprintWorkPending()
{
    return g_importResultJobId > 0 || g_enrollmentResultJob.jobId > 0 || g_verifyJobId > 0;
}

bool checkPendingEnrollmentVerify()
{
    return false;
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
            SerialLog::step(g_importResultHash.length() == 64 ?
                "Direct import verified and confirmed by the backend. Remove your finger before scanning." :
                "Direct import failure reported. Check the web module for its reason.");
            g_importResultJobId = 0;
        }
        else if (importResultRejected(statusCode) || millis() - g_importResultStartedAt >= IMPORT_CONFIRMATION_TIMEOUT_MS)
        {
            SerialLog::step("Direct import confirmation expired. Check the web module and retry the same import.");
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
    SerialLog::section("DIRECT FINGERPRINT IMPORT");
    SerialLog::step("Direct import claimed. Enrollment and door scanning are paused.");
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
        SerialLog::step(imported ? "Direct import completed. Remove your finger before scanning for access." : errorMessage);
        g_importResultJobId = 0;
    }
    else if (importResultRejected(statusCode))
    {
        SerialLog::step("The backend rejected this import result. Check the web module before retrying.");
        g_importResultJobId = 0;
    }
    else
    {
        // A lost completion response must retry the same proof, never allocate/write another slot.
        SerialLog::step("Import result could not be confirmed. Retrying the same job while the door stays locked.");
    }
    return true;
}

void reportUnrecognizedFingerprint(bool isExit)
{
    if (isFingerprintWorkPending()) return;
    DynamicJsonDocument payload(256);
    payload["method"] = "fingerprint";
    payload["enrollment_device_id"] = ENROLLMENT_DEVICE_ID;
    payload["unrecognized"] = true;
    payload["direction"] = isExit ? "exit" : "entry";
    DynamicJsonDocument response(JSON_BUFFER_SIZE);
    // The backend answers access_granted=false; only the log entry matters.
    postJson("/api/door/verify_access.php", payload, response);
}

#include "API.h"
#include "Config.h"
#include "ScheduleSync.h"
#include "TemplateSync.h"
#include "WiFiManager.h"

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

namespace
{
    constexpr size_t JSON_BUFFER_SIZE = 8192;

    String g_lastControllerStatus;
    int g_activeTemplateQueueId = 0;
    int g_activeScheduleSnapshotId = 0;
    unsigned long g_lastTemplatePollAt = 0;
    unsigned long g_lastSchedulePollAt = 0;
    bool g_scheduleEndpointMissing = false;

    void printControllerStatus(const String &status, bool force = false)
    {
        if (force || status != g_lastControllerStatus)
        {
            g_lastControllerStatus = status;
            Serial.println(status);
        }
    }

    bool postJson(const String &endpoint, DynamicJsonDocument &payload, String &responseBody, int &responseCode)
    {
        HTTPClient http;
        const String url = String(SERVER_URL) + endpoint;

        if (!http.begin(url))
        {
            Serial.println("http.begin() FAILED");
            return false;
        }

        http.addHeader("Content-Type", "application/json");

        String requestBody;
        serializeJson(payload, requestBody);

        responseCode = http.POST(requestBody);
        if (responseCode > 0)
        {
            responseBody = http.getString();
        }
        else
        {
            responseBody = http.errorToString(responseCode);
        }

        http.end();
        return responseCode > 0;
    }

    bool fetchPendingTemplateSync(TemplateSyncJob &job)
    {
        String url = String(SERVER_URL) +
            "/api/sensorB/get_pending_template_sync.php?device_id=" +
            String(DOOR_DEVICE_ID);

        if (String(DOOR_DEVICE_CODE).length() > 0)
        {
            url += "&device_code=";
            url += DOOR_DEVICE_CODE;
        }

        HTTPClient http;

        if (!http.begin(url))
        {
            Serial.println("http.begin() FAILED");
            return false;
        }

        const int code = http.GET();
        if (code <= 0)
        {
            Serial.print("HTTP Error: ");
            Serial.println(http.errorToString(code));
            http.end();
            return false;
        }

        const String responseBody = http.getString();
        http.end();

        DynamicJsonDocument response(JSON_BUFFER_SIZE);
        const DeserializationError error = deserializeJson(response, responseBody);
        if (error)
        {
            Serial.print("JSON parse failed: ");
            Serial.println(error.c_str());
            return false;
        }

        const bool success = response["success"] | false;
        if (!success)
        {
            const String message = String((const char *)(response["message"] | ""));

            if (message == "No pending template sync.")
            {
                if (g_activeTemplateQueueId > 0)
                {
                    printControllerStatus(
                        "Template sync job #" + String(g_activeTemplateQueueId) + " is finished. Sensor B is now idle.",
                        true
                    );
                    g_activeTemplateQueueId = 0;
                }
                else
                {
                    printControllerStatus("Sensor B idle. No pending template sync job.");
                }
            }
            else if (message.length() > 0)
            {
                printControllerStatus(message);
            }

            return false;
        }

        JsonObject jobNode = response["job"].as<JsonObject>();
        job.queueId = jobNode["queue_id"] | 0;
        if (job.queueId <= 0)
        {
            job.queueId = jobNode["id"] | 0;
        }

        job.fingerprintId = jobNode["fingerprint_id"] | 0;
        job.deviceId = jobNode["device_id"] | DOOR_DEVICE_ID;
        job.targetSlot = jobNode["target_slot"] | 0;
        job.templateBytes = jobNode["template_bytes"] | 0;
        job.templateHash = String((const char *)(jobNode["template_hash"] | ""));
        job.templateDataBase64 = String((const char *)(jobNode["template_data_base64"] | ""));
        job.fingerName = String((const char *)(jobNode["finger_name"] | "Fingerprint"));
        job.userName = String((const char *)(jobNode["user_name"] | "Unknown user"));

        g_activeTemplateQueueId = job.queueId;
        return job.queueId > 0;
    }

    bool fetchPendingScheduleSync(ScheduleSyncJob &job)
    {
        String url = String(SERVER_URL) +
            "/api/sensorB/get_pending_schedule_sync.php?device_id=" +
            String(DOOR_DEVICE_ID);

        if (String(DOOR_DEVICE_CODE).length() > 0)
        {
            url += "&device_code=";
            url += DOOR_DEVICE_CODE;
        }

        HTTPClient http;

        if (!http.begin(url))
        {
            Serial.println("http.begin() FAILED");
            return false;
        }

        const int code = http.GET();
        if (code == 404)
        {
            http.end();

            if (!g_scheduleEndpointMissing)
            {
                printControllerStatus(
                    "Schedule sync endpoint is not implemented yet. Sensor B will continue using the last local offline policy.",
                    true
                );
                g_scheduleEndpointMissing = true;
            }

            return false;
        }

        if (code <= 0)
        {
            Serial.print("HTTP Error: ");
            Serial.println(http.errorToString(code));
            http.end();
            return false;
        }

        const String responseBody = http.getString();
        http.end();

        DynamicJsonDocument response(JSON_BUFFER_SIZE);
        const DeserializationError error = deserializeJson(response, responseBody);
        if (error)
        {
            Serial.print("JSON parse failed: ");
            Serial.println(error.c_str());
            return false;
        }

        const bool success = response["success"] | false;
        if (!success)
        {
            const String message = String((const char *)(response["message"] | ""));
            if (message.length() > 0)
            {
                printControllerStatus(message);
            }

            return false;
        }

        JsonObject jobNode = response["job"].as<JsonObject>();
        job.snapshotId = jobNode["snapshot_id"] | 0;
        if (job.snapshotId <= 0)
        {
            job.snapshotId = jobNode["id"] | 0;
        }

        job.deviceId = jobNode["device_id"] | DOOR_DEVICE_ID;
        job.revision = String((const char *)(jobNode["revision"] | ""));
        job.generatedAt = String((const char *)(jobNode["generated_at"] | ""));

        if (jobNode["allowed_slots"].is<JsonArray>())
        {
            serializeJson(jobNode["allowed_slots"], job.allowedSlotsJson);
        }
        else
        {
            job.allowedSlotsJson = String((const char *)(jobNode["allowed_slots_json"] | ""));
        }

        g_activeScheduleSnapshotId = job.snapshotId;
        return job.snapshotId > 0;
    }
}

void checkPendingTemplateSync()
{
    if (!isWiFiReady())
    {
        return;
    }

    const unsigned long now = millis();
    if ((now - g_lastTemplatePollAt) < TEMPLATE_SYNC_POLL_INTERVAL_MS)
    {
        return;
    }

    g_lastTemplatePollAt = now;

    TemplateSyncJob job;
    if (!fetchPendingTemplateSync(job))
    {
        return;
    }

    if (job.targetSlot <= 0)
    {
        reportTemplateSyncFailed(job, "The backend did not provide a valid target slot.");
        printControllerStatus(
            "Template sync job #" + String(job.queueId) + " failed because the target slot is invalid.",
            true
        );
        g_activeTemplateQueueId = 0;
        return;
    }

    printControllerStatus(
        "Template sync job #" + String(job.queueId) +
        " claimed for " + job.userName +
        " / " + job.fingerName +
        ". Writing slot " + String(job.targetSlot) + ".",
        true
    );

    String errorMessage;
    const bool synced = runTemplateSyncJob(job, errorMessage);

    if (synced)
    {
        if (!reportTemplateSyncCompleted(job))
        {
            printControllerStatus(
                "Template sync job #" + String(job.queueId) + " finished on ESP32, but backend completion failed.",
                true
            );
        }
        else
        {
            printControllerStatus(
                "Template sync job #" + String(job.queueId) + " completed successfully.",
                true
            );
        }

        g_activeTemplateQueueId = 0;
        return;
    }

    reportTemplateSyncFailed(job, errorMessage);
    printControllerStatus(
        "Template sync job #" + String(job.queueId) + " failed: " + errorMessage,
        true
    );
    g_activeTemplateQueueId = 0;
}

void checkPendingScheduleSync()
{
    if (!isWiFiReady() || g_scheduleEndpointMissing)
    {
        return;
    }

    const unsigned long now = millis();
    if ((now - g_lastSchedulePollAt) < SCHEDULE_SYNC_POLL_INTERVAL_MS)
    {
        return;
    }

    g_lastSchedulePollAt = now;

    ScheduleSyncJob job;
    if (!fetchPendingScheduleSync(job))
    {
        return;
    }

    printControllerStatus(
        "Schedule sync snapshot #" + String(job.snapshotId) + " claimed for Sensor B.",
        true
    );

    String errorMessage;
    const bool synced = applyScheduleSyncJob(job, errorMessage);

    if (synced)
    {
        if (!reportScheduleSyncCompleted(job))
        {
            printControllerStatus(
                "Schedule sync snapshot #" + String(job.snapshotId) + " applied locally, but backend completion failed.",
                true
            );
        }
        else
        {
            printControllerStatus(
                "Schedule sync snapshot #" + String(job.snapshotId) + " completed successfully.",
                true
            );
        }

        g_activeScheduleSnapshotId = 0;
        return;
    }

    reportScheduleSyncFailed(job, errorMessage);
    printControllerStatus(
        "Schedule sync snapshot #" + String(job.snapshotId) + " failed: " + errorMessage,
        true
    );
    g_activeScheduleSnapshotId = 0;
}

bool reportTemplateSyncCompleted(const TemplateSyncJob &job)
{
    DynamicJsonDocument payload(256);
    payload["queue_id"] = job.queueId;

    String responseBody;
    int responseCode = 0;
    const bool posted = postJson("/api/sensorB/complete_template_sync.php", payload, responseBody, responseCode);

    if (!posted || responseCode >= 400)
    {
        Serial.print("Template sync completion failed: ");
        Serial.println(responseBody);
        return false;
    }

    return true;
}

bool reportTemplateSyncFailed(const TemplateSyncJob &job, const String &errorMessage)
{
    DynamicJsonDocument payload(1024);
    payload["queue_id"] = job.queueId;
    payload["error_message"] = errorMessage;

    String responseBody;
    int responseCode = 0;
    const bool posted = postJson("/api/sensorB/fail_template_sync.php", payload, responseBody, responseCode);

    if (!posted || responseCode >= 400)
    {
        Serial.print("Template sync failure update failed: ");
        Serial.println(responseBody);
        return false;
    }

    return true;
}

bool reportScheduleSyncCompleted(const ScheduleSyncJob &job)
{
    DynamicJsonDocument payload(256);
    payload["snapshot_id"] = job.snapshotId;
    payload["device_id"] = DOOR_DEVICE_ID;

    String responseBody;
    int responseCode = 0;
    const bool posted = postJson("/api/sensorB/complete_schedule_sync.php", payload, responseBody, responseCode);

    if (!posted || responseCode >= 400)
    {
        Serial.print("Schedule sync completion failed: ");
        Serial.println(responseBody);
        return false;
    }

    return true;
}

bool reportScheduleSyncFailed(const ScheduleSyncJob &job, const String &errorMessage)
{
    DynamicJsonDocument payload(1024);
    payload["snapshot_id"] = job.snapshotId;
    payload["device_id"] = DOOR_DEVICE_ID;
    payload["error_message"] = errorMessage;

    String responseBody;
    int responseCode = 0;
    const bool posted = postJson("/api/sensorB/fail_schedule_sync.php", payload, responseBody, responseCode);

    if (!posted || responseCode >= 400)
    {
        Serial.print("Schedule sync failure update failed: ");
        Serial.println(responseBody);
        return false;
    }

    return true;
}

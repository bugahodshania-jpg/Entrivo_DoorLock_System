#include "API.h"
#include "Config.h"
#include "ControllerLog.h"
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
            logStep("SYNC", status);
        }
    }

    bool postJson(const String &endpoint, DynamicJsonDocument &payload, String &responseBody, int &responseCode)
    {
        HTTPClient http;
        const String url = String(SERVER_URL) + endpoint;

        if (!http.begin(url))
        {
            Serial.print("ERROR: could not open HTTP POST to ");
            Serial.println(url);
            Serial.println("What is wrong: the controller could not start the HTTP client. Check SERVER_URL and that WiFi still has an IP address.");
            responseBody = "Could not open HTTP POST to " + url;
            responseCode = 0;
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
            Serial.print("ERROR: could not open the template-sync request to ");
            Serial.println(url);
            Serial.println("What is wrong: the controller could not start the HTTP client. Check SERVER_URL and that WiFi still has an IP address.");
            return false;
        }

        http.setConnectTimeout(4000);
        http.setTimeout(8000);

        const int code = http.GET();
        if (code <= 0)
        {
            Serial.print("ERROR: template sync request failed for ");
            Serial.println(url);
            Serial.print("What is wrong: ");
            Serial.print(http.errorToString(code));
            Serial.println(". The backend is unreachable, SERVER_URL is wrong, or WiFi dropped.");
            http.end();
            return false;
        }

        const String responseBody = http.getString();
        http.end();

        DynamicJsonDocument response(JSON_BUFFER_SIZE);
        const DeserializationError error = deserializeJson(response, responseBody);
        if (error)
        {
            Serial.print("ERROR: template sync reply was not valid JSON. Parser said: ");
            Serial.println(error.c_str());
            Serial.println("What is wrong: the backend returned a page or an empty body instead of the expected sync payload.");
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
        job.userId = jobNode["user_id"] | 0;
        job.deviceId = jobNode["device_id"] | DOOR_DEVICE_ID;
        job.targetSlot = jobNode["target_slot"] | 0;
        job.templateBytes = jobNode["template_bytes"] | 0;
        job.templateHash = String((const char *)(jobNode["template_hash"] | ""));
        job.templateDataBase64 = String((const char *)(jobNode["template_data_base64"] | ""));
        job.fingerName = String((const char *)(jobNode["finger_name"] | "Fingerprint"));
        job.userName = String((const char *)(jobNode["user_name"] | "Unknown user"));
        job.reservedSlots = "";

        if (jobNode["reserved_slots"].is<JsonArray>())
        {
            for (JsonVariant reservedSlot : jobNode["reserved_slots"].as<JsonArray>())
            {
                const int slotNumber = reservedSlot.as<int>();
                if (slotNumber <= 0)
                {
                    continue;
                }

                if (job.reservedSlots.length() > 0)
                {
                    job.reservedSlots += ",";
                }

                job.reservedSlots += String(slotNumber);
            }
        }

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
            Serial.print("ERROR: could not open the schedule-sync request to ");
            Serial.println(url);
            Serial.println("What is wrong: the controller could not start the HTTP client. Check SERVER_URL and that WiFi still has an IP address.");
            return false;
        }

        http.setConnectTimeout(4000);
        http.setTimeout(8000);

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
            Serial.print("ERROR: schedule sync request failed for ");
            Serial.println(url);
            Serial.print("What is wrong: ");
            Serial.print(http.errorToString(code));
            Serial.println(". The backend is unreachable, SERVER_URL is wrong, or WiFi dropped.");
            http.end();
            return false;
        }

        const String responseBody = http.getString();
        http.end();

        DynamicJsonDocument response(JSON_BUFFER_SIZE);
        const DeserializationError error = deserializeJson(response, responseBody);
        if (error)
        {
            Serial.print("ERROR: schedule sync reply was not valid JSON. Parser said: ");
            Serial.println(error.c_str());
            Serial.println("What is wrong: the backend returned a page or an empty body instead of the expected schedule payload.");
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

    printControllerStatus(
        "Template sync job #" + String(job.queueId) +
        " claimed for " + job.userName +
        " / " + job.fingerName +
        ". Writing the template to the door sensor next.",
        true
    );
    Serial.flush();
    reportTemplateSyncProgress(job, "writing");

    String errorMessage;
    uint16_t storedSlot = 0;
    pauseWiFiForSensorWork();
    const bool synced = runTemplateSyncJob(job, storedSlot, errorMessage);
    const bool wifiBack = resumeWiFiAfterSensorWork();

    if (wifiBack)
    {
        reportTemplateSyncProgress(job, "reporting");
    }

    if (!wifiBack)
    {
        if (!synced)
        {
            Serial.print("The sensor write also failed: ");
            Serial.println(errorMessage);
        }

        g_activeTemplateQueueId = 0;
        return;
    }

    if (synced)
    {
        if (!reportTemplateSyncCompleted(job, storedSlot))
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

bool reportTemplateSyncProgress(const TemplateSyncJob &job, const char *progressStep)
{
    DynamicJsonDocument payload(256);
    payload["queue_id"] = job.queueId;
    payload["progress_step"] = progressStep;

    String responseBody;
    int responseCode = 0;
    const bool posted = postJson("/api/sensorB/update_template_sync_progress.php", payload, responseBody, responseCode);

    if (!posted || responseCode >= 400)
    {
        Serial.print("Could not update sync progress to \"");
        Serial.print(progressStep);
        Serial.print("\" for job #");
        Serial.print(job.queueId);
        Serial.print(". HTTP ");
        Serial.print(responseCode);
        Serial.print(". Backend said: ");
        Serial.println(responseBody.length() > 0 ? responseBody : String("no response body"));
        return false;
    }

    Serial.print("Sync progress for job #");
    Serial.print(job.queueId);
    Serial.print(" is now ");
    Serial.println(progressStep);
    return true;
}

bool reportTemplateSyncCompleted(const TemplateSyncJob &job, uint16_t storedSlot)
{
    DynamicJsonDocument payload(256);
    payload["queue_id"] = job.queueId;
    payload["stored_slot"] = storedSlot;

    String responseBody;
    int responseCode = 0;
    const bool posted = postJson("/api/sensorB/complete_template_sync.php", payload, responseBody, responseCode);

    if (!posted || responseCode >= 400)
    {
        Serial.print("ERROR: the backend rejected completion for template sync job #");
        Serial.print(job.queueId);
        Serial.print(". POST ");
        Serial.print(SERVER_URL);
        Serial.print("/api/sensorB/complete_template_sync.php returned HTTP ");
        Serial.print(responseCode);
        Serial.print(". Backend said: ");
        Serial.println(responseBody.length() > 0 ? responseBody : String("no response body"));
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
        Serial.print("ERROR: the backend did not record the failure for template sync job #");
        Serial.print(job.queueId);
        Serial.print(". POST ");
        Serial.print(SERVER_URL);
        Serial.print("/api/sensorB/fail_template_sync.php returned HTTP ");
        Serial.print(responseCode);
        Serial.print(". Backend said: ");
        Serial.println(responseBody.length() > 0 ? responseBody : String("no response body"));
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
        Serial.print("ERROR: the backend rejected completion for schedule snapshot #");
        Serial.print(job.snapshotId);
        Serial.print(". POST ");
        Serial.print(SERVER_URL);
        Serial.print("/api/sensorB/complete_schedule_sync.php returned HTTP ");
        Serial.print(responseCode);
        Serial.print(". Backend said: ");
        Serial.println(responseBody.length() > 0 ? responseBody : String("no response body"));
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
        Serial.print("ERROR: the backend did not record the failure for schedule snapshot #");
        Serial.print(job.snapshotId);
        Serial.print(". POST ");
        Serial.print(SERVER_URL);
        Serial.print("/api/sensorB/fail_schedule_sync.php returned HTTP ");
        Serial.print(responseCode);
        Serial.print(". Backend said: ");
        Serial.println(responseBody.length() > 0 ? responseBody : String("no response body"));
        return false;
    }

    return true;
}

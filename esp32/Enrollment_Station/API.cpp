#include "API.h"
#include "Config.h"
#include "Enrollment.h"

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

namespace
{
    constexpr size_t JSON_BUFFER_SIZE = 4096;
    String g_lastStationStatus;
    int g_activeJobId = 0;

    void printStationStatus(const String &status, bool force = false)
    {
        if (force || status != g_lastStationStatus)
        {
            g_lastStationStatus = status;
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

    bool fetchPendingJob(EnrollmentJob &job)
    {
        const String url = String(SERVER_URL) +
            "/api/fingerprint/get_pending_job.php?enrollment_device_id=" +
            String(ENROLLMENT_DEVICE_ID);

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
            if (message == "No pending enrollment.")
            {
                if (g_activeJobId > 0)
                {
                    printStationStatus(
                        "Job #" + String(g_activeJobId) + " is finished. Station is now idle and waiting for the next job.",
                        true
                    );
                    g_activeJobId = 0;
                }
                else
                {
                    printStationStatus("Station idle. No pending enrollment job. Polling again soon.");
                }
            }
            else if (message.length() > 0)
            {
                printStationStatus(message);
            }

            return false;
        }

        JsonObject jobNode = response["job"].as<JsonObject>();
        job.jobId = jobNode["job_id"] | 0;
        job.userId = jobNode["user_id"] | 0;
        job.deviceId = jobNode["enrollment_device_id"] | ENROLLMENT_DEVICE_ID;
        job.assignedSlot = jobNode["assigned_slot"] | 0;
        job.fingerName = String((const char *)(jobNode["finger_name"] | "Fingerprint"));
        g_activeJobId = job.jobId;

        return job.jobId > 0;
    }
}

void checkPendingEnrollment()
{
    if (WiFi.status() != WL_CONNECTED)
    {
        Serial.println("WiFi NOT connected");
        return;
    }

    EnrollmentJob job;

    if (!fetchPendingJob(job))
    {
        return;
    }

    if (job.assignedSlot <= 0)
    {
        failEnrollmentJob(job.jobId, "The backend did not reserve a valid sensor slot.");
        printStationStatus("Job #" + String(job.jobId) + " failed because no sensor slot was reserved.", true);
        g_activeJobId = 0;
        return;
    }

    printStationStatus(
        "Job #" + String(job.jobId) +
        " claimed for " + job.fingerName +
        ". Using slot " + String(job.assignedSlot) + ".",
        true
    );

    String templateDataBase64;
    String errorMessage;
    const bool enrolled = runEnrollmentJob(job, templateDataBase64, errorMessage);

    if (enrolled)
    {
        if (!completeEnrollmentJob(job, templateDataBase64))
        {
            printStationStatus(
                "Job #" + String(job.jobId) + " finished on ESP32, but backend completion failed.",
                true
            );
        }
        else
        {
            printStationStatus(
                "Job #" + String(job.jobId) + " completed successfully. Template stored and synced to the backend.",
                true
            );
        }

        g_activeJobId = 0;
        return;
    }

    failEnrollmentJob(job.jobId, errorMessage);
    printStationStatus("Job #" + String(job.jobId) + " failed: " + errorMessage, true);
    g_activeJobId = 0;
}

bool reportEnrollmentProgress(int jobId, int progress, const String &currentStep)
{
    DynamicJsonDocument payload(512);
    payload["job_id"] = jobId;
    payload["enrollment_device_id"] = ENROLLMENT_DEVICE_ID;
    payload["progress"] = progress;
    payload["current_step"] = currentStep;

    String responseBody;
    int responseCode = 0;
    const bool posted = postJson("/api/fingerprint/update_progress.php", payload, responseBody, responseCode);

    if (!posted || responseCode >= 400)
    {
        Serial.print("Progress update failed: ");
        Serial.println(responseBody);
        return false;
    }

    printStationStatus(
        "Job #" + String(jobId) + ": " + currentStep + " (" + String(progress) + "%)",
        true
    );
    return true;
}

bool completeEnrollmentJob(const EnrollmentJob &job, const String &templateDataBase64)
{
    DynamicJsonDocument payload(1024);
    payload["job_id"] = job.jobId;
    payload["enrollment_device_id"] = ENROLLMENT_DEVICE_ID;
    payload["assigned_slot"] = job.assignedSlot;
    payload["template_data_base64"] = templateDataBase64;

    String responseBody;
    int responseCode = 0;
    const bool posted = postJson("/api/fingerprint/complete_enrollment.php", payload, responseBody, responseCode);

    if (!posted || responseCode >= 400)
    {
        Serial.print("Completion update failed: ");
        Serial.println(responseBody);
        return false;
    }

    Serial.print("Enrollment completed for job #");
    Serial.print(job.jobId);
    Serial.print(" in slot ");
    Serial.println(job.assignedSlot);
    return true;
}

bool failEnrollmentJob(int jobId, const String &errorMessage)
{
    DynamicJsonDocument payload(1024);
    payload["job_id"] = jobId;
    payload["enrollment_device_id"] = ENROLLMENT_DEVICE_ID;
    payload["error_message"] = errorMessage;

    String responseBody;
    int responseCode = 0;
    const bool posted = postJson("/api/fingerprint/fail_enrollment.php", payload, responseBody, responseCode);

    if (!posted || responseCode >= 400)
    {
        Serial.print("Failure update failed: ");
        Serial.println(responseBody);
        return false;
    }

    Serial.print("Enrollment failed: ");
    Serial.println(errorMessage);
    return true;
}

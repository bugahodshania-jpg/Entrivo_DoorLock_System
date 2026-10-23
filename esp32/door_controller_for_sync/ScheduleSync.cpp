// Schedule sync workflow implementation for Sensor B.
#include "ScheduleSync.h"

#include <ArduinoJson.h>

#include "LocalState.h"

bool applyScheduleSyncJob(const ScheduleSyncJob &job, String &errorMessage)
{
    if (job.snapshotId <= 0)
    {
        errorMessage = "Schedule snapshot ID is invalid.";
        return false;
    }

    if (job.allowedSlotsJson.length() == 0)
    {
        errorMessage = "The backend did not provide any offline access policy data.";
        return false;
    }

    DynamicJsonDocument document(4096);
    const DeserializationError parseError = deserializeJson(document, job.allowedSlotsJson);
    if (parseError)
    {
        errorMessage = "Could not parse the offline access policy payload.";
        return false;
    }

    JsonArray allowedSlots;

    if (document.is<JsonArray>())
    {
        allowedSlots = document.as<JsonArray>();
    }
    else
    {
        allowedSlots = document["allowed_slots"].as<JsonArray>();
    }

    if (allowedSlots.isNull())
    {
        errorMessage = "The offline access policy payload is missing the allowed slot list.";
        return false;
    }

    if (!saveAccessPolicySnapshot(job.revision, allowedSlots, errorMessage))
    {
        return false;
    }

    Serial.print("Offline access policy synced. Revision: ");
    Serial.println(job.revision.length() > 0 ? job.revision : String("unversioned"));
    return true;
}

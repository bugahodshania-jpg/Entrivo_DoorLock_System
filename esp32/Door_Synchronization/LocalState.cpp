// Offline storage implementation for Sensor B.
#include <Preferences.h>
#include <ArduinoJson.h>
#include "LocalState.h"
#include "Config.h"

namespace
{
    Preferences g_preferences;
    bool g_localStateReady = false;

    String getTemplateKey(uint16_t slot)
    {
        return String("fp_") + String(slot);
    }
}

void initLocalState()
{
    g_localStateReady = g_preferences.begin(LOCAL_STATE_NAMESPACE, false);

    if (g_localStateReady)
    {
        Serial.println("Local offline state initialized.");
    }
    else
    {
        Serial.println("Warning: local offline state could not be initialized.");
    }
}

bool saveTemplateHash(uint16_t slot, const String &templateHash)
{
    if (!g_localStateReady || slot == 0)
    {
        return false;
    }

    return g_preferences.putString(getTemplateKey(slot).c_str(), templateHash) > 0;
}

String getTemplateHash(uint16_t slot)
{
    if (!g_localStateReady || slot == 0)
    {
        return "";
    }

    return g_preferences.getString(getTemplateKey(slot).c_str(), "");
}

bool saveAccessPolicySnapshot(const String &revision, JsonArrayConst allowedSlots, String &errorMessage)
{
    if (!g_localStateReady)
    {
        errorMessage = "Local offline storage is not ready.";
        return false;
    }

    DynamicJsonDocument document(4096);
    document["revision"] = revision;

    JsonArray storedAllowedSlots = document.createNestedArray("allowed_slots");
    for (JsonVariantConst slot : allowedSlots)
    {
        storedAllowedSlots.add(slot.as<uint16_t>());
    }

    String serializedPolicy;
    serializeJson(document, serializedPolicy);

    if (g_preferences.putString("access_policy", serializedPolicy) == 0)
    {
        errorMessage = "Could not save the offline access policy snapshot.";
        return false;
    }

    return true;
}

bool loadAccessPolicySnapshot(LocalAccessPolicy &policy, String &errorMessage)
{
    policy = LocalAccessPolicy();

    if (!g_localStateReady)
    {
        errorMessage = "Local offline storage is not ready.";
        return false;
    }

    const String serializedPolicy = g_preferences.getString("access_policy", "");
    if (serializedPolicy.length() == 0)
    {
        return true;
    }

    DynamicJsonDocument document(4096);
    const DeserializationError parseError = deserializeJson(document, serializedPolicy);
    if (parseError)
    {
        errorMessage = "Could not parse the stored offline access policy.";
        return false;
    }

    policy.revision = String((const char *)(document["revision"] | ""));

    JsonArray allowedSlots = document["allowed_slots"].as<JsonArray>();
    if (allowedSlots.isNull())
    {
        return true;
    }

    for (JsonVariant slot : allowedSlots)
    {
        if (policy.allowedSlotCount >= MAX_ALLOWED_SLOTS)
        {
            break;
        }

        policy.allowedSlots[policy.allowedSlotCount++] = slot.as<uint16_t>();
    }

    return true;
}

bool isSlotAllowedOffline(uint16_t slot, String &reason)
{
    if (slot == 0)
    {
        reason = "Fingerprint slot 0 is not valid for access control.";
        return false;
    }

    LocalAccessPolicy policy;
    String loadError;
    if (!loadAccessPolicySnapshot(policy, loadError))
    {
        reason = loadError;
        return false;
    }

    if (policy.allowedSlotCount == 0)
    {
        reason = "No offline access policy has been synced yet.";
        return false;
    }

    for (size_t index = 0; index < policy.allowedSlotCount; ++index)
    {
        if (policy.allowedSlots[index] == slot)
        {
            reason = "Fingerprint slot is allowed by the local offline policy.";
            return true;
        }
    }

    reason = "Fingerprint slot is not present in the local offline policy.";
    return false;
}

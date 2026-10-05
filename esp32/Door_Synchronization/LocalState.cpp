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

    String getDoorUserKey(uint16_t slot)
    {
        return String("w") + String(slot);
    }

    String getFingerprintSlotKey(int fingerprintId)
    {
        return String("u") + String(fingerprintId);
    }

    bool storePreferenceString(const char *key, const String &value)
    {
        if (g_preferences.isKey(key) && g_preferences.getString(key, "") == value)
        {
            return true;
        }

        if (g_preferences.putString(key, value) > 0)
        {
            return true;
        }

        return g_preferences.isKey(key) && g_preferences.getString(key, "") == value;
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

void clearTemplateHash(uint16_t slot)
{
    if (!g_localStateReady || slot == 0)
    {
        return;
    }

    g_preferences.remove(getTemplateKey(slot).c_str());
}

bool saveDoorSlotUser(const DoorSlotUser &user)
{
    if (!g_localStateReady || user.slot == 0 || user.fingerprintId <= 0)
    {
        return false;
    }

    DynamicJsonDocument document(512);
    document["fingerprint_id"] = user.fingerprintId;
    document["user_id"] = user.userId;
    document["user_name"] = user.userName;
    document["finger_name"] = user.fingerName;

    String serializedUser;
    serializeJson(document, serializedUser);

    if (!storePreferenceString(getDoorUserKey(user.slot).c_str(), serializedUser))
    {
        return false;
    }

    const String slotKey = getFingerprintSlotKey(user.fingerprintId);
    if (g_preferences.isKey(slotKey.c_str()) && g_preferences.getUShort(slotKey.c_str(), 0) == user.slot)
    {
        return true;
    }

    if (g_preferences.putUShort(slotKey.c_str(), user.slot) == sizeof(uint16_t))
    {
        return true;
    }

    return g_preferences.isKey(slotKey.c_str()) && g_preferences.getUShort(slotKey.c_str(), 0) == user.slot;
}

bool loadDoorSlotUser(uint16_t slot, DoorSlotUser &user)
{
    user = DoorSlotUser();

    if (!g_localStateReady || slot == 0)
    {
        return false;
    }

    const String serializedUser = g_preferences.getString(getDoorUserKey(slot).c_str(), "");
    if (serializedUser.length() == 0)
    {
        return false;
    }

    DynamicJsonDocument document(512);
    if (deserializeJson(document, serializedUser))
    {
        return false;
    }

    user.slot = slot;
    user.fingerprintId = document["fingerprint_id"] | 0;
    user.userId = document["user_id"] | 0;
    user.userName = String((const char *)(document["user_name"] | ""));
    user.fingerName = String((const char *)(document["finger_name"] | ""));

    if (user.userName.length() == 0)
    {
        user.userName = "Unknown user";
    }

    if (user.fingerName.length() == 0)
    {
        user.fingerName = "Fingerprint";
    }

    return user.fingerprintId > 0;
}

void clearDoorSlotUser(uint16_t slot)
{
    if (!g_localStateReady || slot == 0)
    {
        return;
    }

    DoorSlotUser existingUser;
    if (loadDoorSlotUser(slot, existingUser) && existingUser.fingerprintId > 0)
    {
        const String slotKey = getFingerprintSlotKey(existingUser.fingerprintId);
        if (g_preferences.getUShort(slotKey.c_str(), 0) == slot)
        {
            g_preferences.remove(slotKey.c_str());
        }
    }

    g_preferences.remove(getDoorUserKey(slot).c_str());
}

uint16_t getFingerprintDoorSlot(int fingerprintId)
{
    if (!g_localStateReady || fingerprintId <= 0)
    {
        return 0;
    }

    return g_preferences.getUShort(getFingerprintSlotKey(fingerprintId).c_str(), 0);
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

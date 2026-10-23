// Offline storage interface for Sensor B.
#ifndef LOCAL_STATE_H
#define LOCAL_STATE_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include "Config.h"

struct LocalAccessPolicy
{
    String revision;
    size_t allowedSlotCount = 0;
    uint16_t allowedSlots[MAX_ALLOWED_SLOTS] = {0};
};

struct DoorSlotUser
{
    uint16_t slot = 0;
    int fingerprintId = 0;
    int userId = 0;
    String userName;
    String fingerName;
};

void initLocalState();
bool saveTemplateHash(uint16_t slot, const String &templateHash);
String getTemplateHash(uint16_t slot);
void clearTemplateHash(uint16_t slot);
bool saveDoorSlotUser(const DoorSlotUser &user);
bool loadDoorSlotUser(uint16_t slot, DoorSlotUser &user);
void clearDoorSlotUser(uint16_t slot);
uint16_t getFingerprintDoorSlot(int fingerprintId);
bool saveAccessPolicySnapshot(const String &revision, JsonArrayConst allowedSlots, String &errorMessage);
bool loadAccessPolicySnapshot(LocalAccessPolicy &policy, String &errorMessage);
bool hasAccessPolicySnapshot();
bool isSlotAllowedOffline(uint16_t slot, String &reason);

#endif

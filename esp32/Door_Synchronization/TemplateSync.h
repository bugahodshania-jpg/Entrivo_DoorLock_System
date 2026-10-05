#ifndef TEMPLATE_SYNC_H
#define TEMPLATE_SYNC_H

#include <Arduino.h>

struct TemplateSyncJob
{
    int queueId = 0;
    int fingerprintId = 0;
    int userId = 0;
    int deviceId = 0;
    int targetSlot = 0;
    int templateBytes = 0;
    String templateHash;
    String templateDataBase64;
    String reservedSlots;
    String fingerName;
    String userName;
};

bool runTemplateSyncJob(const TemplateSyncJob &job, uint16_t &storedSlot, String &errorMessage);

#endif

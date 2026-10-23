// Schedule sync workflow interface for Sensor B.
#ifndef SCHEDULE_SYNC_H
#define SCHEDULE_SYNC_H

#include <Arduino.h>

struct ScheduleSyncJob
{
    int snapshotId = 0;
    int deviceId = 0;
    String revision;
    String generatedAt;
    String allowedSlotsJson;
};

bool applyScheduleSyncJob(const ScheduleSyncJob &job, String &errorMessage);

#endif

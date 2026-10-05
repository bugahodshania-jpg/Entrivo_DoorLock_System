// Backend API interface for Sensor B.
#ifndef API_H
#define API_H

#include "TemplateSync.h"
#include "ScheduleSync.h"

void checkPendingTemplateSync();
void checkPendingScheduleSync();

bool reportTemplateSyncCompleted(const TemplateSyncJob &job, uint16_t storedSlot);
bool reportTemplateSyncFailed(const TemplateSyncJob &job, const String &errorMessage);

bool reportScheduleSyncCompleted(const ScheduleSyncJob &job);
bool reportScheduleSyncFailed(const ScheduleSyncJob &job, const String &errorMessage);

#endif

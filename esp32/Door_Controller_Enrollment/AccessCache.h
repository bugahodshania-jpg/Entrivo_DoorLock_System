#ifndef ENTRIVO_ACCESS_CACHE_H
#define ENTRIVO_ACCESS_CACHE_H

#include <Arduino.h>
#include "AccessCacheFormat.h"

// Offline schedule copy. While online the controller keeps the backend's list
// of who may enter during today and the next 7 days (see AccessCacheFormat.h),
// stored raw in the flash data partition (two 64 KB slots, so a failed
// download never replaces the good copy). When the backend is unreachable, an
// entry is checked against this copy with the controller's own clock.

void initAccessCache();
// From each door status reply: the version the backend has now.
void noteAccessCacheVersion(uint32_t version);
// Downloads a newer copy when needed. Call from the main loop only while the
// door is locked and idle (a download holds the loop for about a second).
void serviceAccessCache();

enum class OfflineCheck : uint8_t {
    Unavailable, // no usable copy (none yet, outside its days, or no trusted clock)
    NotListed,   // the copy is usable but this credential is not in it
    Granted,
    Denied,      // listed, but no current window (see decision.reason)
};

struct OfflineAnswer {
    OfflineCheck result = OfflineCheck::Unavailable;
    uint32_t userId = 0;
    DoorAccessCache::Decision decision{};
};

OfflineAnswer checkOfflineFinger(uint16_t slot);
OfflineAnswer checkOfflineCard(const String &uid);
// One line for the status print: what copy is saved and until when.
String accessCacheSummary();
// True when an offline entry would be checked against the saved schedules now.
bool accessCacheUsableNow();
// The saved copy's version and the end of the days it covers (Unix time),
// sent in each door status report so the portal can show it. 0 = none saved.
uint32_t accessCacheSavedVersion();
uint32_t accessCacheValidUntil();

#endif

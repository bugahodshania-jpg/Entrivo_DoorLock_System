#ifndef ENTRIVO_OFFLINE_EXIT_QUEUE_H
#define ENTRIVO_OFFLINE_EXIT_QUEUE_H

#include <Arduino.h>

// Exits the door allowed while the backend was unreachable. Each one is kept
// in NVS (it survives a restart or power cut) until the backend confirms it is
// in the access log. The event ID makes a retried upload count only once.
struct OfflineExit {
    char eventId[33];   // 32 hex characters
    char rfidUid[11];   // card exit; empty for a fingerprint exit
    uint16_t slot;      // fingerprint exit; 0 for a card exit
    uint32_t bootTag;   // which boot recorded it (millis() is only valid in that boot)
    uint32_t millisAt;
    uint32_t rtcAt;     // RTC seconds when the RTC is running; 0 = unknown
};

void initOfflineExits();
// A fresh 32-hex event ID, sent with every exit request.
void newDoorEventId(char out[33]);
void queueOfflineExit(const char *eventId, const String &rfidUid, uint16_t slot);
size_t offlineExitCount();
// Uploads the oldest waiting exit when WiFi is up (one per call, rate limited).
void serviceOfflineExits();

#endif

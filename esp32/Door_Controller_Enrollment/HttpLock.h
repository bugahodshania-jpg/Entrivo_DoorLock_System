#ifndef ENTRIVO_HTTP_LOCK_H
#define ENTRIVO_HTTP_LOCK_H

// ESP32 HTTPClient is not safe to share between the door-status task and the
// main loop. Hold this lock around every request on this board.
void initHttpLock();

struct EntrivoHttpLock {
    EntrivoHttpLock();
    ~EntrivoHttpLock();
    EntrivoHttpLock(const EntrivoHttpLock &) = delete;
    EntrivoHttpLock &operator=(const EntrivoHttpLock &) = delete;
};

#endif

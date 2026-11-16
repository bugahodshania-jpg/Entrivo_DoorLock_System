#ifndef ENTRIVO_DOOR_STATUS_H
#define ENTRIVO_DOOR_STATUS_H

#include <stdint.h>

// Reports run on the main loop with the same HTTP path as enrollment.
// Pass touchArmed while touch-to-lock is armed: reports are rarer and quicker.
void initDoorStatus(bool unlocked);
void queueDoorStatus(bool unlocked);
void serviceDoorStatus(bool touchArmed = false);
// While unlocked, each report's reply carries the current end of the schedule
// the room was opened on (edits included). True once per new reply.
bool takeSessionEnd(uint32_t &endEpoch, long &secondsLeft);

#endif

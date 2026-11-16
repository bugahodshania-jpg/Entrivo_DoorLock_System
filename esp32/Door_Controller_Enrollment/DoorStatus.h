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
// A remote lock/unlock from a Super Admin (portal). True once per command;
// call confirmDoorCommand() after running it.
bool takeDoorCommand(int32_t &commandId, bool &unlock);
void confirmDoorCommand(int32_t commandId);
// Portal scheduling mode: "auto" (default), "on" or "off". With auto or off,
// an enrolled finger may enter while the backend is unreachable.
bool offlineFingerEntryAllowed();
const char *doorScheduleMode();

#endif

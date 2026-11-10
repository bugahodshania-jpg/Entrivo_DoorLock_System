#ifndef ENTRIVO_DOOR_STATUS_H
#define ENTRIVO_DOOR_STATUS_H

// Reports run on the main loop with the same HTTP path as enrollment.
// Pass touchArmed while touch-to-lock is armed: reports are rarer and quicker.
void initDoorStatus(bool unlocked);
void queueDoorStatus(bool unlocked);
void serviceDoorStatus(bool touchArmed = false);

#endif

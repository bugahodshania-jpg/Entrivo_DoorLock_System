#ifndef ENTRIVO_DOOR_STATUS_H
#define ENTRIVO_DOOR_STATUS_H

// Reports run on the main loop with the same HTTP path as enrollment.
// Skip serviceDoorStatus() only on the touch-to-lock path.
void initDoorStatus(bool unlocked);
void queueDoorStatus(bool unlocked);
void serviceDoorStatus();

#endif

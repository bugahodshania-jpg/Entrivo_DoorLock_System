#ifndef ENTRIVO_DOOR_STATUS_H
#define ENTRIVO_DOOR_STATUS_H

// HTTP runs in a separate task; relay and touch handling never wait for it.
void initDoorStatus(bool unlocked);
void queueDoorStatus(bool unlocked);

#endif

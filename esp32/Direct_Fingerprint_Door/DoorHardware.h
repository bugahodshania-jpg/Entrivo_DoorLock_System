#ifndef DIRECT_DOOR_HARDWARE_H
#define DIRECT_DOOR_HARDWARE_H

void initDoorHardware();
void lockDoorRelay();
void openDoorRelay();
void updateDoorHardware();
bool isDoorUnlocked();

#endif

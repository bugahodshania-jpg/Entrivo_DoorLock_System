#ifndef COMBINED_DOOR_HARDWARE_H
#define COMBINED_DOOR_HARDWARE_H

void initDoorHardware();
void initDoorFeedback();
void openDoorRelay();
void lockDoorRelay();
void updateDoorHardware();
void authorizeExit();
void playDeniedFeedback();
void printDeviceTime();
bool isDoorUnlocked();
bool isExitAuthorized();

#endif

#ifndef COMBINED_DOOR_HARDWARE_H
#define COMBINED_DOOR_HARDWARE_H

#include <Arduino.h>

// DFPlayer tracks: SD card folder /mp3, files 0001.mp3 ... 0011.mp3.
enum AudioTrack : uint16_t {
    AUDIO_ACCESS_GRANTED = 1,   // "Access granted. Door unlocked. You may now enter."
    AUDIO_ACCESS_DENIED = 2,    // "...not authorized to access this room at the current time."
    AUDIO_NOT_REGISTERED = 3,   // "...credentials are not registered in the system..."
    AUDIO_OUTSIDE_SCHEDULE = 4, // "...outside your authorized schedule."
    AUDIO_REMINDER = 5,         // "...15 minutes remaining in your scheduled session..."
    AUDIO_SCHEDULE_EXPIRED = 6, // "The scheduled access period has ended..."
    AUDIO_OVERRIDE_APPROVED = 7,// "Override access approved. Door unlocked..."
    AUDIO_ROOM_LOCKED = 8,      // "The room has been successfully locked. Thank you."
    AUDIO_DOOR_LOCKED = 9,      // "Door is now locked"
    AUDIO_DOOR_UNLOCK = 10,     // "Door unlock"
    AUDIO_EXIT_VERIFIED = 11,   // Exit RFID verified; touch sensor to lock
};

void initDoorHardware();
void initDoorFeedback();
void openDoorRelay(uint16_t track = AUDIO_ACCESS_GRANTED);
void lockDoorRelay(uint16_t track = AUDIO_DOOR_LOCKED);
void updateDoorHardware();
void authorizeExit();
void playTrack(uint16_t track);
void playDeniedFeedback(uint16_t track = AUDIO_ACCESS_DENIED);
void printDeviceTime();
bool isDoorUnlocked();
bool isExitAuthorized();
bool consumeFingerprintExitTouch();
// The door state survives a restart (WiFi brownout, crash, power cut): an
// unlocked door is re-opened at boot instead of locking on its own.
bool doorWasRestoredUnlocked();
// Diagnostics: true when the relay GPIO currently reads the unlock level.
bool relayPinIsActive();
void saveUnlockSlot(uint16_t slot);
uint16_t restoredUnlockSlot();
// The user who unlocked the door (0 = unknown); only they can lock it by fingerprint.
void saveUnlockUser(uint32_t userId);
uint32_t restoredUnlockUser();
// DS3231 seconds counter (0 = RTC unavailable). Only needs to keep ticking,
// not to be set to the right time: it measures time across a restart.
uint32_t rtcSeconds();
// 15-minute reminder moment in rtcSeconds() (0 = none); survives a restart.
void saveReminderAt(uint32_t rtcAt);
uint32_t restoredReminderAt();

#endif

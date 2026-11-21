#ifndef COMBINED_DOOR_HARDWARE_H
#define COMBINED_DOOR_HARDWARE_H

#include <Arduino.h>

// DFPlayer tracks: SD card folder /mp3, files 0001.mp3 ... 0024.mp3.
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
    AUDIO_EMERGENCY_CARD = 12,  // "Emergency card accepted. The door is unlocked. Please activate the touch sensor to lock the door."
    AUDIO_OFFLINE = 13,         // "The system is offline. Please use the emergency access card to open the door."
    AUDIO_SESSION_ENDED = 14,   // "Your scheduled access period has successfully ended. Please don't forget to lock the door before you leave."
    AUDIO_ENROLL_START = 15,        // "Fingerprint enrollment has started. Please place your finger on the sensor."
    AUDIO_ENROLL_FIRST_DONE = 16,   // "First scan complete. Please remove your finger."
    AUDIO_ENROLL_SAME_AGAIN = 17,   // "Please place the same finger again."
    AUDIO_ENROLL_SECOND_DONE = 18,  // "Second scan complete. Please remove your finger."
    AUDIO_ENROLL_VERIFY = 19,       // "Please re-scan the same finger to complete the final verification."
    AUDIO_ENROLL_SUCCESS = 20,      // "Fingerprint enrolled successfully."
    AUDIO_ENROLL_FAILED = 21,       // "Enrollment failed. The fingerprints did not match. Please try again."
    AUDIO_ENROLL_CANCELLED = 22,    // "Enrollment cancelled."
    AUDIO_OFFLINE_ENTRY_SAVED = 23, // "The system is offline. Access granted. Your entry is saved and will be recorded when the connection returns."
    AUDIO_CONNECTION_LOST = 24,     // "Attention: the door system has lost its connection. Door access is limited until it returns. Entries and exits are still saved."
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
// Keeps the DS3231 on UTC from the internet / backend clock (checked once a
// minute), so offline schedule checks have the right time after a restart.
void syncRtcFromClock();
// DS3231 Unix time when this firmware has set it and it has kept power since
// (its backup battery); 0 = not trusted.
uint32_t trustedRtcSeconds();

#endif

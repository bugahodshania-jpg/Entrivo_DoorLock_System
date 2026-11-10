#ifndef DIRECT_FINGERPRINT_API_H
#define DIRECT_FINGERPRINT_API_H

#include "Enrollment.h"

// Returns true when a job was claimed/handled, so access scanning can require finger release.
bool checkPendingEnrollment();
bool reportEnrollmentProgress(int jobId, int progress, const String &currentStep, String *errorMessage = nullptr);
bool reportEnrollmentStored(const EnrollmentJob &job, const String &currentStep);
bool reportIdentifyMatch(const EnrollmentJob &job, const String &templateDataBase64, String &errorMessage);
bool stageEnrollmentBackup(const EnrollmentJob &job, const String &templateDataBase64, size_t templateBytes, const String &templateHash, String &errorMessage);
bool reserveEmptyEnrollmentSlot(EnrollmentJob &job, String &errorMessage);
bool completeEnrollmentJob(const EnrollmentJob &job, const String &templateDataBase64 = "", int *statusCode = nullptr);
bool failEnrollmentJob(int jobId, const String &errorMessage);
// exitOnly is set when the backend lets a user who is still inside leave a
// locked door after the schedule ended (exit only, never entry).
// What the backend said about a door credential, for picking the voice prompt.
struct DoorDecision {
    String reason;               // e.g. access_granted, not_registered, no_schedule, expired_schedule
    String scheduleKind;         // regular, override, permanent_override (granted entries)
    long secondsRemaining = -1;  // seconds until the schedule ends (granted entries), -1 if unknown
    uint32_t userId = 0;         // the identified user, 0 if unknown
};

// unlockedByUserId (exit only): the user who unlocked the door. The backend
// refuses a locking fingerprint from anyone else. 0 = unknown, not checked.
bool authorizeMatchedFingerprint(uint16_t matchedSlot, String &message, bool isExit = false, bool *exitOnly = nullptr,
    DoorDecision *decision = nullptr, uint32_t unlockedByUserId = 0);
// backendUnreachable is set when no decision came back (WiFi/backend down),
// as opposed to the backend refusing the card.
bool authorizeRfid(const String &uid, bool isExit, String &message, DoorDecision *decision = nullptr,
    bool *backendUnreachable = nullptr);
// Logs a finger the sensor did not recognize, so the admin's live Access Status
// shows the unregistered attempt. Never grants access.
void reportUnrecognizedFingerprint(bool isExit);
bool isFingerprintWorkPending();
bool checkPendingDirectImport();
bool checkPendingEnrollmentVerify();
bool reportDirectImportProgress(int jobId, int progress, const String &currentStep);

#endif

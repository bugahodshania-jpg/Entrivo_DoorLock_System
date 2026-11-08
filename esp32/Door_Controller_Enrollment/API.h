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
bool authorizeMatchedFingerprint(uint16_t matchedSlot, String &message, bool isExit = false, bool *exitOnly = nullptr);
bool authorizeRfid(const String &uid, bool isExit, String &message);
bool isFingerprintWorkPending();
bool checkPendingDirectImport();
bool checkPendingEnrollmentVerify();
bool reportDirectImportProgress(int jobId, int progress, const String &currentStep);

#endif

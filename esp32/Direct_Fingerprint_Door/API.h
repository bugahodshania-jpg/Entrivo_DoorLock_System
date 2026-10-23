#ifndef DIRECT_FINGERPRINT_API_H
#define DIRECT_FINGERPRINT_API_H

#include "Enrollment.h"

// Returns true when a job was claimed/handled, so access scanning can require finger release.
bool checkPendingEnrollment();
bool reportEnrollmentProgress(int jobId, int progress, const String &currentStep);
bool reserveEmptyEnrollmentSlot(EnrollmentJob &job, String &errorMessage);
bool completeEnrollmentJob(const EnrollmentJob &job, const String &templateDataBase64 = "", int *statusCode = nullptr);
bool failEnrollmentJob(int jobId, const String &errorMessage);
bool authorizeMatchedFingerprint(uint16_t matchedSlot, String &message);
bool isFingerprintWorkPending();
bool checkPendingDirectImport();
bool reportDirectImportProgress(int jobId, int progress, const String &currentStep);

#endif

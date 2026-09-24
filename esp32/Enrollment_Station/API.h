// Backend API interface for enrollment jobs.

#ifndef API_H
#define API_H

#include "Enrollment.h"

void checkPendingEnrollment();
bool reportEnrollmentProgress(int jobId, int progress, const String &currentStep);
bool completeEnrollmentJob(const EnrollmentJob &job, const String &templateDataBase64 = "");
bool failEnrollmentJob(int jobId, const String &errorMessage);

#endif

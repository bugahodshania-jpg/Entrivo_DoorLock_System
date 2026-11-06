#ifndef ENROLLMENT_H
#define ENROLLMENT_H

#include <Arduino.h>
#include "EnrollmentProof.h"
#include "FingerprintSearch.h"

struct EnrollmentJob
{
    int jobId = 0;
    int userId = 0;
    int fingerprintId = 0;
    int deviceId = 0;
    int assignedSlot = 0;
    int previousSlot = 0;
    bool isUpdate = false;
    bool recovery = false;
    String fingerName;
    DoorEnrollmentProof::Verification verification;
};

bool runEnrollmentJob(EnrollmentJob &job, String &templateDataBase64, String &errorMessage);

struct EnrollmentVerifyJob
{
    int jobId = 0;
    int deviceId = 0;
    int fingerprintId = 0;
    int targetSlot = 0;
    String templateHash;
};

bool runEnrollmentVerifyJob(const EnrollmentVerifyJob &job, DoorFingerprintSearch::Result &match, String &templateHash, String &errorMessage);

#endif

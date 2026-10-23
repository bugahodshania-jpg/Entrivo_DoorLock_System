#ifndef ENROLLMENT_H
#define ENROLLMENT_H

#include <Arduino.h>
#include "EnrollmentProof.h"

struct EnrollmentJob
{
    int jobId = 0;
    int userId = 0;
    int deviceId = 0;
    int assignedSlot = 0;
    String fingerName;
    DoorEnrollmentProof::Verification verification;
    bool wroteNewTemplate = false;
};

bool runEnrollmentJob(EnrollmentJob &job, String &templateDataBase64, String &errorMessage);
bool discardUnconfirmedEnrollment(EnrollmentJob &job, String &errorMessage);

#endif

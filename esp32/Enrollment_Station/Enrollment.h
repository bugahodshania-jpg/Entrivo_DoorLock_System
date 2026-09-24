#ifndef ENROLLMENT_H
#define ENROLLMENT_H

#include <Arduino.h>

struct EnrollmentJob
{
    int jobId = 0;
    int userId = 0;
    int deviceId = 0;
    int assignedSlot = 0;
    String fingerName;
};

bool runEnrollmentJob(const EnrollmentJob &job, String &templateDataBase64, String &errorMessage);

#endif

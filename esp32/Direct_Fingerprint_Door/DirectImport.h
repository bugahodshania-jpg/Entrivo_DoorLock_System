#ifndef DIRECT_FINGERPRINT_IMPORT_H
#define DIRECT_FINGERPRINT_IMPORT_H

#include <Arduino.h>

struct DirectImportJob
{
    int jobId = 0;
    int fingerprintId = 0;
    int deviceId = 0;
    int targetSlot = 0;
    int templateBytes = 0;
    String templateDataBase64;
    String templateHash;
};

bool runDirectImportJob(const DirectImportJob &job, String &verifiedHash, String &errorMessage);

#endif

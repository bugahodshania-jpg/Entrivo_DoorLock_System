#ifndef COMBINED_RFID_H
#define COMBINED_RFID_H
#include <Arduino.h>

void initRfidReaders();
bool pollRfidReader(String &uid, bool &isExit);
void resetRfidReaders();

#endif

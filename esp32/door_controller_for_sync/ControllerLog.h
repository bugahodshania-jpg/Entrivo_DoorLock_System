#ifndef CONTROLLER_LOG_H
#define CONTROLLER_LOG_H

#include <Arduino.h>

void logBanner(const char *title);
void logStep(const char *tag, const String &message);
void logNote(const String &message);

#endif

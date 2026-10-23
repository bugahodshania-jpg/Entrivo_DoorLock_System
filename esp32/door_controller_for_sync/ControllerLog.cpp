#include "ControllerLog.h"

void logBanner(const char *title)
{
    Serial.println();
    Serial.println("----------------------------------------");
    Serial.print(" ");
    Serial.println(title);
    Serial.println("----------------------------------------");
}

void logStep(const char *tag, const String &message)
{
    Serial.print("[");
    Serial.print(tag);
    Serial.print("] ");
    Serial.println(message);
}

void logNote(const String &message)
{
    Serial.print("       ");
    Serial.println(message);
}

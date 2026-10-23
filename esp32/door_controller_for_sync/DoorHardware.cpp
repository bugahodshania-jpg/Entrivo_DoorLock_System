// Door relay implementation for Sensor B.
#include <Arduino.h>
#include "DoorHardware.h"
#include "Config.h"

namespace
{
    bool g_doorUnlocked = false;
    unsigned long g_unlockStartedAt = 0;
}

void initDoorHardware()
{
    pinMode(DOOR_RELAY_PIN, OUTPUT);
    pinMode(DOOR_RELAY2_PIN, OUTPUT);
    digitalWrite(DOOR_RELAY_PIN, DOOR_RELAY_IDLE_LEVEL);
    digitalWrite(DOOR_RELAY2_PIN, DOOR_RELAY_IDLE_LEVEL);
}

void openDoorRelay()
{
    g_doorUnlocked = true;
    g_unlockStartedAt = millis();

    digitalWrite(DOOR_RELAY_PIN, DOOR_RELAY_ACTIVE_LEVEL);
    Serial.println("Door relay activated.");
}

void updateDoorHardware()
{
    if (!g_doorUnlocked)
    {
        return;
    }

    if ((millis() - g_unlockStartedAt) < DOOR_UNLOCK_DURATION_MS)
    {
        return;
    }

    digitalWrite(DOOR_RELAY_PIN, DOOR_RELAY_IDLE_LEVEL);
    g_doorUnlocked = false;
    Serial.println("Door relay reset.");
}

bool isDoorUnlocked()
{
    return g_doorUnlocked;
}

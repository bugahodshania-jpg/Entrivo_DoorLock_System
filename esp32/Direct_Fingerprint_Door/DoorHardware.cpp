#include <Arduino.h>
#include <driver/gpio.h>

#include "Config.h"
#include "DoorHardware.h"
#include "DoorStatus.h"

static_assert(DOOR_RELAY_PIN != FP_RX_PIN && DOOR_RELAY_PIN != FP_TX_PIN,
              "The relay and fingerprint sensor must use separate pins.");
static_assert(DOOR_RELAY_ACTIVE_LEVEL != DOOR_RELAY_IDLE_LEVEL,
              "The relay active and idle levels must differ.");

namespace
{
    bool g_doorUnlocked = false;
    unsigned long g_unlockStartedAt = 0;
}

void initDoorHardware()
{
    // Latch the inactive level before enabling the output to avoid an active-low pulse.
    // Arduino ESP32 3.x digitalWrite ignores pins before pinMode, so use the GPIO latch directly.
    gpio_set_level(static_cast<gpio_num_t>(DOOR_RELAY_PIN), DOOR_RELAY_IDLE_LEVEL);
    pinMode(DOOR_RELAY_PIN, OUTPUT);
    digitalWrite(DOOR_RELAY_PIN, DOOR_RELAY_IDLE_LEVEL);
    g_doorUnlocked = false;
}

void lockDoorRelay()
{
    digitalWrite(DOOR_RELAY_PIN, DOOR_RELAY_IDLE_LEVEL);
    g_doorUnlocked = false;
    queueDoorStatus(false);
}

void openDoorRelay()
{
    // Never let another scan extend an existing pulse.
    if (g_doorUnlocked)
    {
        return;
    }

    Serial.println("Access granted. Door relay activated.");
    g_unlockStartedAt = millis();
    g_doorUnlocked = true;
    digitalWrite(DOOR_RELAY_PIN, DOOR_RELAY_ACTIVE_LEVEL);
    queueDoorStatus(true);
}

void updateDoorHardware()
{
    if (g_doorUnlocked && millis() - g_unlockStartedAt >= DOOR_UNLOCK_DURATION_MS)
    {
        lockDoorRelay();
        Serial.println("Door relay returned to locked state.");
    }
}

bool isDoorUnlocked()
{
    return g_doorUnlocked;
}

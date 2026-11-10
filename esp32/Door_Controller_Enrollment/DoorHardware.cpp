#include <Arduino.h>
#include <Wire.h>
#include <RTClib.h>
#include <driver/gpio.h>
#include <Preferences.h>
#include "Config.h"
#include "DoorHardware.h"
#include "DoorStatus.h"

static_assert(DOOR_RELAY_PIN != FP_RX_PIN && DOOR_RELAY_PIN != FP_TX_PIN,
              "The lock and fingerprint UART must use different GPIOs.");
static_assert(FP_UART_INDEX != DFPLAYER_UART_INDEX, "Fingerprint and DFPlayer need separate UARTs.");
static_assert(DOOR_RELAY_ACTIVE_LEVEL != DOOR_RELAY_IDLE_LEVEL, "Relay levels must differ.");

namespace {
    HardwareSerial mp3(DFPLAYER_UART_INDEX);
    RTC_DS3231 rtc;
    bool rtcReady = false;
    bool audioReady = false;
    bool unlocked = false;
    bool exitAuthorized = false;
    bool previousTouch = false;
    bool fingerprintExitTouchPending = false;
    unsigned long lastTouchAt = 0;
    unsigned long lastLockedTouchMsgAt = 0;
    bool restoredUnlocked = false;

    // Non-volatile door state ("door" namespace): written only on a change.
    Preferences doorStore;
    bool doorStoreReady = false;

    // Relay diagnostics: the level actually read back from the GPIO after a write.
    void logRelay(const char *action) {
        Serial.print("[RELAY] ");
        Serial.print(action);
        Serial.print(": GPIO");
        Serial.print(DOOR_RELAY_PIN);
        Serial.print(" is now ");
        Serial.print(digitalRead(DOOR_RELAY_PIN) == HIGH ? "HIGH" : "LOW");
        Serial.print(" (unlock = ");
        Serial.print(DOOR_RELAY_ACTIVE_LEVEL == HIGH ? "HIGH" : "LOW");
        Serial.println(").");
    }

    void saveUnlocked(bool value) {
        if (doorStoreReady && doorStore.getBool("unlocked", false) != value) doorStore.putBool("unlocked", value);
    }
    constexpr unsigned long LOCKED_TOUCH_MSG_COOLDOWN_MS = 5000UL;

    void mp3Command(uint8_t command, uint16_t value) {
        if (!audioReady) return;
        uint8_t packet[10] = {0x7E, 0xFF, 0x06, command, 0x00,
            static_cast<uint8_t>(value >> 8), static_cast<uint8_t>(value), 0, 0, 0xEF};
        uint16_t sum = 0;
        for (size_t index = 1; index <= 6; ++index) sum += packet[index];
        const uint16_t checksum = static_cast<uint16_t>(0 - sum);
        packet[7] = checksum >> 8;
        packet[8] = checksum & 0xFF;
        mp3.write(packet, sizeof(packet));
    }

    void playAudio(uint16_t track) { mp3Command(0x12, track); }
}

void initDoorHardware() {
    // ESP32 core 3.x ignores digitalWrite before pinMode; latch LOW directly.
    const uint8_t pins[] = {DOOR_RELAY_PIN, DOOR_UNUSED_RELAY_PIN};
    for (uint8_t pin : pins) {
        gpio_set_pull_mode(static_cast<gpio_num_t>(pin), GPIO_PULLDOWN_ONLY);
        gpio_set_level(static_cast<gpio_num_t>(pin), DOOR_RELAY_IDLE_LEVEL);
        pinMode(pin, OUTPUT);
        digitalWrite(pin, DOOR_RELAY_IDLE_LEVEL);
    }
    pinMode(TOUCH_PIN, INPUT);
    previousTouch = digitalRead(TOUCH_PIN) == TOUCH_ACTIVE_LEVEL;
    unlocked = false;
    exitAuthorized = false;

    // A restart must never lock an open door: re-energize the solenoid right
    // away if the door was unlocked before the restart.
    doorStoreReady = doorStore.begin("door", false);
    restoredUnlocked = doorStoreReady && doorStore.getBool("unlocked", false);
    if (restoredUnlocked) {
        digitalWrite(DOOR_RELAY_PIN, DOOR_RELAY_ACTIVE_LEVEL);
        unlocked = true;
    }
}

bool doorWasRestoredUnlocked() { return restoredUnlocked; }

bool relayPinIsActive() { return digitalRead(DOOR_RELAY_PIN) == DOOR_RELAY_ACTIVE_LEVEL; }

void saveUnlockSlot(uint16_t slot) {
    if (doorStoreReady && doorStore.getUShort("slot", 0) != slot) doorStore.putUShort("slot", slot);
}

uint16_t restoredUnlockSlot() { return doorStoreReady ? doorStore.getUShort("slot", 0) : 0; }

void saveUnlockUser(uint32_t userId) {
    if (doorStoreReady && doorStore.getULong("user", 0) != userId) doorStore.putULong("user", userId);
}

uint32_t restoredUnlockUser() { return doorStoreReady ? doorStore.getULong("user", 0) : 0; }

void initDoorFeedback() {
    Wire.begin(RTC_SDA_PIN, RTC_SCL_PIN);
    rtcReady = rtc.begin();
    if (!rtcReady) Serial.println("RTC unavailable; credential verification still works.");
    else if (rtc.lostPower()) Serial.println("RTC lost power. Scheduling is not enabled in this sketch.");
    mp3.begin(DFPLAYER_BAUDRATE, SERIAL_8N1, DFPLAYER_RX_PIN, DFPLAYER_TX_PIN);
    delay(700);
    audioReady = true;
    mp3Command(0x06, 25);
}

void printDeviceTime() {
    if (!rtcReady) { Serial.print("[RTC unavailable] "); return; }
    const DateTime now = rtc.now();
    char text[25];
    snprintf(text, sizeof(text), "%04d-%02d-%02d %02d:%02d:%02d ",
        now.year(), now.month(), now.day(), now.hour(), now.minute(), now.second());
    Serial.print(text);
}

void openDoorRelay(uint16_t track) {
    digitalWrite(DOOR_UNUSED_RELAY_PIN, DOOR_RELAY_IDLE_LEVEL);
    if (unlocked) return;
    digitalWrite(DOOR_RELAY_PIN, DOOR_RELAY_ACTIVE_LEVEL);
    unlocked = true;
    saveUnlocked(true);
    logRelay("UNLOCK");
    fingerprintExitTouchPending = false;
    queueDoorStatus(true);
    exitAuthorized = false;
    printDeviceTime();
    Serial.println("[DOOR] UNLOCKED. Touch alone never locks. To lock: scan an exit card inside, then touch; or touch, then scan the finger that unlocked.");
    playAudio(track);
}

void lockDoorRelay(uint16_t track) {
    digitalWrite(DOOR_RELAY_PIN, DOOR_RELAY_IDLE_LEVEL);
    digitalWrite(DOOR_UNUSED_RELAY_PIN, DOOR_RELAY_IDLE_LEVEL);
    const bool wasUnlocked = unlocked;
    unlocked = false;
    saveUnlocked(false);
    if (wasUnlocked) logRelay("LOCK");
    exitAuthorized = false;
    fingerprintExitTouchPending = false;
    if (wasUnlocked) {
        queueDoorStatus(false);
        printDeviceTime();
        Serial.println("[DOOR] LOCKED");
        playAudio(track);
    }
}

void authorizeExit() {
    if (!unlocked || exitAuthorized) return;
    exitAuthorized = true;
    Serial.println("[EXIT] Registered card verified. Touch GPIO18 to LOCK.");
}

void updateDoorHardware() {
    digitalWrite(DOOR_UNUSED_RELAY_PIN, DOOR_RELAY_IDLE_LEVEL);
    const bool pressed = digitalRead(TOUCH_PIN) == TOUCH_ACTIVE_LEVEL;
    if (pressed && !previousTouch && millis() - lastTouchAt >= TOUCH_DEBOUNCE_MS) {
        lastTouchAt = millis();
        if (unlocked && exitAuthorized) lockDoorRelay(AUDIO_ROOM_LOCKED);
        else if (unlocked) {
            fingerprintExitTouchPending = true;
            Serial.println("[TOUCH] Fingerprint exit armed. Scan your finger to record the exit and lock the door.");
        } else if (millis() - lastLockedTouchMsgAt >= LOCKED_TOUCH_MSG_COOLDOWN_MS) {
            lastLockedTouchMsgAt = millis();
            Serial.println("[TOUCH] Door is locked. Faculty: scan your finger to enter. Students: tap the entrance card.");
        }
    }
    previousTouch = pressed;
}

void playTrack(uint16_t track) { playAudio(track); }
void playDeniedFeedback(uint16_t track) { playAudio(track); }
bool isDoorUnlocked() { return unlocked; }
bool isExitAuthorized() { return exitAuthorized; }
bool consumeFingerprintExitTouch() {
    const bool accepted = fingerprintExitTouchPending && unlocked && !exitAuthorized;
    fingerprintExitTouchPending = false;
    return accepted;
}

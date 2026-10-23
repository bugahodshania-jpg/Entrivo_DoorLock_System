#include <Arduino.h>
#include <Wire.h>
#include <RTClib.h>
#include <driver/gpio.h>
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
    unsigned long lastTouchAt = 0;

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
}

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

void openDoorRelay() {
    digitalWrite(DOOR_UNUSED_RELAY_PIN, DOOR_RELAY_IDLE_LEVEL);
    if (unlocked) return;
    digitalWrite(DOOR_RELAY_PIN, DOOR_RELAY_ACTIVE_LEVEL);
    unlocked = true;
    queueDoorStatus(true);
    exitAuthorized = false;
    printDeviceTime();
    Serial.println("[DOOR] UNLOCKED. Scan a registered EXIT RFID, then touch to lock.");
    playAudio(1);
}

void lockDoorRelay() {
    digitalWrite(DOOR_RELAY_PIN, DOOR_RELAY_IDLE_LEVEL);
    digitalWrite(DOOR_UNUSED_RELAY_PIN, DOOR_RELAY_IDLE_LEVEL);
    const bool wasUnlocked = unlocked;
    unlocked = false;
    exitAuthorized = false;
    if (wasUnlocked) {
        queueDoorStatus(false);
        printDeviceTime();
        Serial.println("[DOOR] LOCKED");
        playAudio(9);
    }
}

void authorizeExit() {
    if (!unlocked || exitAuthorized) return;
    exitAuthorized = true;
    Serial.println("[EXIT] Registered card verified. Touch GPIO18 to LOCK.");
    playAudio(11);
}

void updateDoorHardware() {
    digitalWrite(DOOR_UNUSED_RELAY_PIN, DOOR_RELAY_IDLE_LEVEL);
    const bool pressed = digitalRead(TOUCH_PIN) == TOUCH_ACTIVE_LEVEL;
    if (pressed && !previousTouch && millis() - lastTouchAt >= TOUCH_DEBOUNCE_MS) {
        lastTouchAt = millis();
        if (unlocked && exitAuthorized) lockDoorRelay();
        else if (unlocked) Serial.println("[TOUCH] Scan a registered EXIT RFID before touching to lock.");
        else Serial.println("[TOUCH] Door is already locked.");
    }
    previousTouch = pressed;
}

void playDeniedFeedback() { playAudio(3); }
bool isDoorUnlocked() { return unlocked; }
bool isExitAuthorized() { return exitAuthorized; }

#ifndef COMBINED_DOOR_CONFIG_H
#define COMBINED_DOOR_CONFIG_H

#if __has_include("Secrets.h")
#include "Secrets.h"
#else
#error "Missing Secrets.h: copy Secrets.example.h to Secrets.h in this sketch folder and fill in the values."
#endif

// Match these to the backend and the ESP32's network before uploading.
#define WIFI_SSID "ESP32_HOTSPOT"
#define WIFI_PASSWORD SECRET_WIFI_PASSWORD
// Deployed backend (HTTPS). The ESP32 reaches it through the hotspot's internet.
// For a backend on this PC instead, use "http://192.168.137.1:8000".
#define SERVER_URL "https://entrivo-backend-production.up.railway.app"
#define ENROLLMENT_DEVICE_ID 1
// Set the SAME private value in backend/.env as DOOR_DEVICE_TOKEN.
#define DOOR_DEVICE_TOKEN SECRET_DOOR_DEVICE_TOKEN

// Requests reuse one open TLS connection (BackendClient.cpp), so a job check
// costs a few hundred ms instead of a 1-3 s handshake and can run every 2 s.
#define ENROLLMENT_POLL_INTERVAL_MS 2000UL
#define WIFI_RETRY_INTERVAL_MS 10000UL
#define SENSOR_RETRY_INTERVAL_MS 5000UL
#define ACCESS_SCAN_INTERVAL_MS 180UL
// Cloud requests over HTTPS need more time than the local backend did.
#define HTTP_CONNECT_TIMEOUT_MS 5000
#define HTTP_READ_TIMEOUT_MS 6000

// Exact wiring from Fully_working_codeproplus.ino.
#define FP_UART_INDEX 1
#define FP_RX_PIN 32
#define FP_TX_PIN 33
#define FP_BAUDRATE 57600
#define RFID_ENTRANCE_RX_PIN 16
#define RFID_EXIT_RX_PIN 27
#define RFID_BAUDRATE 9600
#define RFID_LISTEN_WINDOW_MS 650UL
#define RFID_COOLDOWN_MS 1800UL
#define DFPLAYER_UART_INDEX 2
#define DFPLAYER_RX_PIN 25
#define DFPLAYER_TX_PIN 26
#define DFPLAYER_BAUDRATE 9600
#define RTC_SDA_PIN 19
#define RTC_SCL_PIN 21
#define TOUCH_PIN 18
#define TOUCH_ACTIVE_LEVEL HIGH
#define TOUCH_DEBOUNCE_MS 300UL
#define FINGERPRINT_EXIT_WINDOW_MS 15000UL

// Emergency access card, used ONLY when the backend cannot be reached (WiFi
// down, backend or database offline). Same process as any card: the entrance
// reader unlocks; the exit reader (unlocking a locked door) arms touch-to-lock,
// then touch locks. While the backend is reachable the card is checked and
// logged online like every other card. Offline uses are not logged. The UID is in
// Secrets.h (SECRET_OFFLINE_ACCESS_CARD_UID); set it to "" to disable.
#define OFFLINE_ACCESS_CARD_UID SECRET_OFFLINE_ACCESS_CARD_UID

// IN2 controls the solenoid; IN1 is held OFF. No automatic locking timer.
// Confirmed on the door: HIGH energizes the relay and opens the solenoid.
#define DOOR_RELAY_PIN 17
#define DOOR_UNUSED_RELAY_PIN 4
#define DOOR_RELAY_ACTIVE_LEVEL HIGH
#define DOOR_RELAY_IDLE_LEVEL LOW

#endif

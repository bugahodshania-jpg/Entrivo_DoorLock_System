#ifndef COMBINED_DOOR_CONFIG_H
#define COMBINED_DOOR_CONFIG_H

// Match these to the backend and the ESP32's network before uploading.
#define WIFI_SSID "ESP32_HOTSPOT"
#define WIFI_PASSWORD "onetwoeight"
#define SERVER_URL "http://192.168.137.1:8000"
#define ENROLLMENT_DEVICE_ID 1
// Set the SAME private value in backend/.env as DOOR_DEVICE_TOKEN.
#define DOOR_DEVICE_TOKEN "1016SjHeAtNhItAaBgUuGrAaHnOD0130"

#define ENROLLMENT_POLL_INTERVAL_MS 1000UL
#define WIFI_RETRY_INTERVAL_MS 10000UL
#define SENSOR_RETRY_INTERVAL_MS 5000UL
#define ACCESS_SCAN_INTERVAL_MS 180UL
#define HTTP_CONNECT_TIMEOUT_MS 2000
#define HTTP_READ_TIMEOUT_MS 3000

// Exact wiring from Fully_working_codeproplus.ino.
#define FP_UART_INDEX 1
#define FP_RX_PIN 32
#define FP_TX_PIN 33
#define FP_BAUDRATE 57600
#define RFID_ENTRANCE_RX_PIN 14
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

// IN2 controls the solenoid; IN1 is held OFF. No automatic locking timer.
#define DOOR_RELAY_PIN 17
#define DOOR_UNUSED_RELAY_PIN 4
#define DOOR_RELAY_ACTIVE_LEVEL HIGH
#define DOOR_RELAY_IDLE_LEVEL LOW

#endif

#ifndef CONFIG_H
#define CONFIG_H

// ============================
// WiFi
// ============================

#define WIFI_SSID      "ESP32_TEST"
#define WIFI_PASSWORD  "12345678"

// ============================
// Backend
// ============================

#define SERVER_URL "http://192.168.137.1:8000"
#define ENROLLMENT_DEVICE_ID 1
#define ENROLLMENT_POLL_INTERVAL_MS 1000

// Replace with YOUR PC IP later

// ============================
// Fingerprint Sensor
// ============================

#define FP_RX_PIN 16
#define FP_TX_PIN 17

#define FP_BAUDRATE 57600

#endif

#ifndef DIRECT_FINGERPRINT_CONFIG_H
#define DIRECT_FINGERPRINT_CONFIG_H

// Configure these before uploading. Use the same enrollment device as the web module.
#define WIFI_SSID "ESP32_HOTSPOT"
#define WIFI_PASSWORD "onetwoeight"
#define SERVER_URL "http://192.168.137.1:8000"
#define ENROLLMENT_DEVICE_ID 1
// Must match DOOR_DEVICE_TOKEN in backend/.env. An empty value cannot complete enrollment.
#define DOOR_DEVICE_TOKEN "1016SjHeAtNhItAaBgUuGrAaHnOD0130"

#define ENROLLMENT_POLL_INTERVAL_MS 1000UL
#define WIFI_RETRY_INTERVAL_MS 10000UL
#define SENSOR_RETRY_INTERVAL_MS 5000UL
#define ACCESS_SCAN_INTERVAL_MS 150UL
#define HTTP_CONNECT_TIMEOUT_MS 2000
#define HTTP_READ_TIMEOUT_MS 3000

// The existing enrollment Sensor A, on ESP32 UART2.
#define FP_RX_PIN 16
#define FP_TX_PIN 17
#define FP_BAUDRATE 57600

// Lock channel only. GPIO17 belongs to the fingerprint sensor in this sketch.
#define DOOR_RELAY_PIN 4
#define DOOR_RELAY_ACTIVE_LEVEL LOW
#define DOOR_RELAY_IDLE_LEVEL HIGH
#define DOOR_UNLOCK_DURATION_MS 3000UL

#endif

#ifndef CONFIG_H
#define CONFIG_H

// ============================
// WiFi
// ============================

#define WIFI_SSID "ESP32_HOTSPOT"
#define WIFI_PASSWORD "onetwoeight"

// ============================
// Backend
// ============================

#define SERVER_URL "http://192.168.137.1:8000"

#define DOOR_DEVICE_ID 2
#define DOOR_DEVICE_CODE "sensor-b"

#define TEMPLATE_SYNC_POLL_INTERVAL_MS 2000
#define SCHEDULE_SYNC_POLL_INTERVAL_MS 10000
#define WIFI_RETRY_INTERVAL_MS 10000
#define MAIN_LOOP_DELAY_MS 50
#define ACCESS_CONTROL_POLL_INTERVAL_MS 150

// Replace these values with your final Sensor B configuration later.

// ============================
// Fingerprint Sensor
// ============================

#define FP_RX_PIN 16
#define FP_TX_PIN 17
#define FP_BAUDRATE 57600

#define EXPECTED_TEMPLATE_BYTES 512

// ============================
// Door Hardware
// ============================

#define DOOR_RELAY_PIN 25
#define DOOR_RELAY_ACTIVE_LEVEL HIGH
#define DOOR_RELAY_IDLE_LEVEL LOW
#define DOOR_UNLOCK_DURATION_MS 3000

// ============================
// Local Storage
// ============================

#define LOCAL_STATE_NAMESPACE "sensor_b"
#define MAX_ALLOWED_SLOTS 128

#endif

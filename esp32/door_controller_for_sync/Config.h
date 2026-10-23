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
// Door hardware pins
// This ESP32 syncs templates and schedules, then uses them to control the lock.
// Full wiring: esp32/docs/door-hardware-pins.md
// ============================

// R307S entrance. Sensor TX -> GPIO 32, sensor RX <- GPIO 33.
#define FP_RX_PIN 32
#define FP_TX_PIN 33
#define FP_BAUDRATE 57600

#define EXPECTED_TEMPLATE_BYTES 512

// RDM6300 readers. Module TX -> ESP32 RX. These readers have no RX wire.
#define RFID_ENTRANCE_RX_PIN 16
#define RFID_EXIT_RX_PIN 27
#define RFID_BAUDRATE 9600

// RTC on I2C.
#define RTC_SDA_PIN 19
#define RTC_SCL_PIN 21

// DFPlayer Mini. GPIO 25 wires to the module TX pin. GPIO 26 wires to the module RX pin.
// Audio leaves the player on DAC_L and goes into the GF1002 amplifier. The speaker is not on this module.
#define DFPLAYER_RX_PIN 25
#define DFPLAYER_TX_PIN 26
#define DFPLAYER_BAUDRATE 9600

// 2-channel relay module. Channel 1 is the lock. Channel 2 is wired and held off.
// These modules turn a channel on when its IN pin is LOW.
#define DOOR_RELAY_PIN 4
#define DOOR_RELAY2_PIN 17
#define DOOR_RELAY_ACTIVE_LEVEL LOW
#define DOOR_RELAY_IDLE_LEVEL HIGH
#define DOOR_UNLOCK_DURATION_MS 3000

// ============================
// Local Storage
// ============================

#define LOCAL_STATE_NAMESPACE "sensor_b"
#define MAX_ALLOWED_SLOTS 128

#endif

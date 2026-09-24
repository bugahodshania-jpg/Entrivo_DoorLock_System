# Sensor B Solenoid Door Wiring

This wiring is for Sensor B, the ESP32 attached to the door. Use this with:

```text
C:\xampp_new\htdocs\Entrivo_DoorLock_System\esp32\door_controller\door_controller.ino
```

## Firmware Pins

```cpp
FP_RX_PIN = 16
FP_TX_PIN = 17
DOOR_RELAY_PIN = 25
```

## Fingerprint Sensor To ESP32

| Fingerprint Sensor | ESP32 |
| --- | --- |
| VCC | 5V or 3.3V, depending on the sensor module |
| GND | GND |
| TX | GPIO 16 |
| RX | GPIO 17 |

TX and RX must be crossed:

```text
Fingerprint TX -> ESP32 RX GPIO16
Fingerprint RX -> ESP32 TX GPIO17
```

## Relay Module To ESP32

| Relay Module | ESP32 |
| --- | --- |
| VCC | 5V |
| GND | GND |
| IN | GPIO 25 |

The firmware activates the relay on GPIO 25 for 3 seconds:

```cpp
#define DOOR_RELAY_PIN 25
#define DOOR_RELAY_ACTIVE_LEVEL HIGH
#define DOOR_RELAY_IDLE_LEVEL LOW
#define DOOR_UNLOCK_DURATION_MS 3000
```

If the relay module turns on when the signal is LOW, change the config to:

```cpp
#define DOOR_RELAY_ACTIVE_LEVEL LOW
#define DOOR_RELAY_IDLE_LEVEL HIGH
```

## Solenoid Lock Wiring

Use an external power supply for the solenoid, usually 12V.

```text
12V Power Supply + -> Relay COM
Relay NO           -> Solenoid +
Solenoid -         -> 12V Power Supply -
```

Use the relay `NO` terminal, not `NC`.

This means the solenoid only receives power when access is granted. When the fingerprint is authorized, the ESP32 activates the relay for 3 seconds and the solenoid unlocks.

## Protection Diode

Add a diode across the solenoid terminals to protect the relay and ESP32 from voltage spikes.

Recommended diode: `1N4007`

```text
Diode stripe/cathode side -> Solenoid +
Diode non-stripe/anode    -> Solenoid -
```

## Important Notes

- Do not power the solenoid directly from the ESP32.
- Use a separate power supply for the solenoid.
- The relay input side must share GND with the ESP32 if the relay module requires common ground.
- Upload the combined door controller firmware, not the sync-only sketch, for normal operation.

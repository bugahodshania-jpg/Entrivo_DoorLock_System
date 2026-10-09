# Door Hardware Pins

One ESP32 at the door runs `esp32/door_controller`. That sketch pulls fingerprint templates and access schedules from the backend, stores them on the board, and uses them to unlock the door. Flash that sketch only. A separate synchronization board cannot feed this controller.

```text
esp32/door_controller/Config.h
```

The enrollment station is a different board and keeps its own wiring in `esp32/docs/enrollment-station-wiring.md`.

The fingerprint sensor and the relay are the pins the firmware drives today. The RFID readers, RTC, and DFPlayer pins are reserved in `Config.h` so those wires are not reused.

## Pin list

| Device | Device pin | ESP32 / supply | Purpose |
| --- | --- | --- | --- |
| RDM6300 entrance | TX | GPIO 16 | Entrance card reader sends its ID to the ESP32 |
| RDM6300 entrance | VCC | 5V | Reader power |
| RDM6300 entrance | GND | GND | Reader ground |
| RDM6300 exit | TX | GPIO 27 | Exit card reader sends its ID to the ESP32 |
| RDM6300 exit | VCC | 5V | Reader power |
| RDM6300 exit | GND | GND | Reader ground |
| R307S entrance | TX | GPIO 32 | Fingerprint sensor transmit, into the ESP32 receive pin |
| R307S entrance | RX | GPIO 33 | Fingerprint sensor receive, from the ESP32 transmit pin |
| R307S entrance | VCC | 5V | Sensor power |
| R307S entrance | GND | GND | Sensor ground |
| RTC | SDA | GPIO 19 | I2C data |
| RTC | SCL | GPIO 21 | I2C clock |
| RTC | VCC | 3.3V | Clock power. Use 3.3V so the I2C pins stay at ESP32 level |
| RTC | GND | GND | Clock ground |
| DFPlayer Mini | TX | GPIO 25 | Module transmit, wired to this ESP32 pin |
| DFPlayer Mini | RX | GPIO 26 | Module receive, wired to this ESP32 pin |
| DFPlayer Mini | VCC | 5V | Player power |
| DFPlayer Mini | GND | GND | Player ground |
| Relay module | IN / S | GPIO 4 | ESP32 unlock signal |
| Relay module | VCC | 5V | Relay coil-driver power |
| Relay module | GND | GND | Relay ground |
| Relay module | COM | 12V supply − | Common contact of the lock circuit |
| Relay module | NO | Solenoid − | Closes to ground when the door unlocks |
| Solenoid | + | 12V supply + | Lock positive stays on the supply |
| Solenoid | − | Relay NO | Lock negative is switched by the relay |
| 12V supply | − | ESP32 GND | One shared ground for the lock supply and the ESP32 |

Leave the R307S touch and 3.3V-output wires unconnected. The RDM6300 modules only need TX, VCC, and GND.

## Lock circuit

The relay switches the solenoid's negative wire. The positive wire stays connected to the 12V supply.

```text
12V supply +  ----------------------  Solenoid +
12V supply −  ------  Relay COM
Relay NO      ------  Solenoid −
ESP32 GND     ------  12V supply −
```

Put a `1N4007` diode across the solenoid coil. The banded end, the cathode, goes toward the solenoid + wire. The other end goes toward the solenoid − wire. The diode absorbs the spike when the lock turns off.

GPIO 4 goes HIGH for 3 seconds to unlock, then returns LOW. That matches `DOOR_RELAY_ACTIVE_LEVEL HIGH` in `esp32/door_controller/Config.h`. If the relay board instead turns on when IN is LOW, swap the active and idle levels in that file.

## Grounds and power

- Tie ESP32 GND, both RDM6300 grounds, the R307S ground, the RTC ground, the DFPlayer ground, the relay ground, and the 12V supply negative together.
- Power the solenoid only from the 12V supply. Do not take solenoid current from the ESP32 5V pin.
- Power the R307S, both RDM6300 readers, the DFPlayer, and the relay module from 5V.
- Power the RTC from 3.3V.

## Signal protection

- R307S serial is 3.3V logic. GPIO 32 and GPIO 33 connect directly. Cross the data wires: sensor TX goes to GPIO 32, and sensor RX comes from GPIO 33.
- RDM6300 TX pins are often 5V. Do not connect a 5V TX pin straight to GPIO 16 or GPIO 27. Use a divider on each reader TX: 1k from the reader TX to the GPIO, and 2k from that GPIO to GND.
- Put a 1k resistor in series between GPIO 26 and the DFPlayer RX pin. Connect the speaker to the DFPlayer speaker pads, not to an ESP32 pin.
- GPIO 1 and GPIO 3 stay free for USB programming and the serial monitor.

GPIO 25 used to be the relay. Move that wire to GPIO 4 before powering the board, or the player and the lock will share one pin.

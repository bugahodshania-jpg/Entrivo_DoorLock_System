# Door Hardware Pins

One ESP32 at the door runs `esp32/door_controller_for_sync`. That sketch pulls fingerprint templates and access schedules from the backend, stores them on the board, and uses them to unlock the door. Flash that sketch only. A separate synchronization board cannot feed this controller.

```text
esp32/door_controller_for_sync/Config.h
```

The enrollment station is a different board and keeps its own wiring in `esp32/docs/enrollment-station-wiring.md`.

The fingerprint sensor and both relay channels are the pins the firmware drives today. Channel 1 unlocks the door. Channel 2 is held off. The RFID readers, RTC, and DFPlayer pins are reserved in `Config.h` so those wires are not reused.

The HCW-P715 buck converter makes the 5V rail from the 12V supply. The GF1002 amplifier (board marks B50R and GS27076, PAM8403) takes the DFPlayer audio and drives the 5W 4Ω speaker.

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
| DFPlayer Mini | DAC_L | Amplifier L | Line audio into the GF1002 left input |
| DFPlayer Mini | GND | Amplifier G | Audio ground |
| DFPlayer Mini | VCC | 5V rail | Player power, from the buck converter |
| DFPlayer Mini | GND | GND | Player ground |
| GF1002 amplifier | +5V | 5V rail | Amplifier power. Keep this at or below 5.5V |
| GF1002 amplifier | GND | GND | Amplifier ground |
| GF1002 amplifier | L | DFPlayer DAC_L | Left audio input |
| GF1002 amplifier | G | DFPlayer GND | Audio ground |
| GF1002 amplifier | R | Amplifier G | Unused input, tied to G so that channel stays quiet |
| GF1002 amplifier | L+ | Speaker + | Left speaker output |
| GF1002 amplifier | L− | Speaker − | Left speaker return. Do not tie this to GND |
| 5W 4Ω speaker | + | Amplifier L+ | Speaker positive |
| 5W 4Ω speaker | − | Amplifier L− | Speaker negative |
| 2-channel relay | IN1 | GPIO 4 | Lock channel. LOW unlocks, HIGH holds the lock |
| 2-channel relay | IN2 | GPIO 17 | Spare channel. Held HIGH so relay 2 stays off |
| 2-channel relay | VCC | 5V rail | Logic and coil power. Leave the VCC–JD-VCC jumper installed |
| 2-channel relay | GND | GND | Relay ground |
| 2-channel relay | COM1 | 12V supply − | Common contact of the lock circuit |
| 2-channel relay | NO1 | Solenoid − | Closes to ground when the door unlocks |
| 2-channel relay | COM2, NO2, NC2 | unused | No load on channel 2 |
| Solenoid | + | 12V supply + | Lock positive stays on the supply |
| Solenoid | − | Relay NO1 | Lock negative is switched by channel 1 |
| HCW-P715 | IN+ | 12V supply + | Buck input. Accepts 9V to 36V |
| HCW-P715 | IN− | 12V supply − | Buck input ground |
| HCW-P715 | 5V output | 5V rail | About 5.2V. Screw OUT+ if the board has it, otherwise the USB 5V contact |
| HCW-P715 | output GND | GND | Same ground as IN− |
| 12V supply | − | ESP32 GND | One shared ground for the lock supply and the ESP32 |

Leave the R307S touch and 3.3V-output wires unconnected. The RDM6300 modules only need TX, VCC, and GND. Leave the DFPlayer SPK1 and SPK2 pads open. Leave the amplifier R+ and R− pads open.

## Power

The HCW-P715 is the only 5V source. The 12V supply feeds the buck and the solenoid.

```text
12V supply +  ------  HCW-P715 IN+
12V supply −  ------  HCW-P715 IN−  ------  ESP32 GND
HCW-P715 5V   ------  5V rail
HCW-P715 GND  ------  GND
```

The 5V rail feeds the ESP32 5V pin, the R307S, both RDM6300 readers, the DFPlayer, the relay VCC pin, and the amplifier +5V pin. The RTC still uses the ESP32 3.3V pin. Do not power the ESP32 from the buck and a computer USB cable at the same time.

## Lock circuit

Relay channel 1 switches the solenoid's negative wire. The positive wire stays connected to the 12V supply.

```text
12V supply +  ----------------------  Solenoid +
12V supply −  ------  Relay COM1
Relay NO1     ------  Solenoid −
Relay IN1     ------  ESP32 GPIO 4
Relay IN2     ------  ESP32 GPIO 17
ESP32 GND     ------  12V supply −
```

Put a `1N4007` diode across the solenoid coil. The banded end, the cathode, goes toward the solenoid + wire. The other end goes toward the solenoid − wire. The diode absorbs the spike when the lock turns off.

GPIO 4 goes LOW for 3 seconds to unlock, then returns HIGH. GPIO 17 stays HIGH, so channel 2 never closes. That matches `DOOR_RELAY_ACTIVE_LEVEL LOW` in `esp32/door_controller_for_sync/Config.h`. If this relay board instead turns on when IN is HIGH, swap the active and idle levels in that file. A board that unlocks as soon as power is applied is a high-trigger board.

## Audio

The speaker connects to the amplifier, not to the DFPlayer.

```text
DFPlayer DAC_L  ------  Amplifier L
DFPlayer GND    ------  Amplifier G
Amplifier R     ------  Amplifier G
Amplifier L+    ------  Speaker +
Amplifier L−    ------  Speaker −
```

The GF1002 knob is the volume control, and on this board it also switches the amplifier power. Turn it clockwise from the click. L− is a driven output. Do not connect L− or the speaker − wire to GND.

## Grounds and power

- Tie ESP32 GND, both RDM6300 grounds, the R307S ground, the RTC ground, the DFPlayer ground, the amplifier ground, the relay ground, the buck input and output grounds, and the 12V supply negative together.
- Power the solenoid only from the 12V supply. Do not take solenoid current from the 5V rail.
- Power the R307S, both RDM6300 readers, the DFPlayer, the relay module, and the amplifier from the buck 5V rail.
- Power the RTC from 3.3V.

## Signal protection

- R307S serial is 3.3V logic. GPIO 32 and GPIO 33 connect directly. Cross the data wires: sensor TX goes to GPIO 32, and sensor RX comes from GPIO 33.
- RDM6300 TX pins are often 5V. Do not connect a 5V TX pin straight to GPIO 16 or GPIO 27. Use a divider on each reader TX: 1k from the reader TX to the GPIO, and 2k from that GPIO to GND.
- Put a 1k resistor in series between GPIO 26 and the DFPlayer RX pin.
- GPIO 1 and GPIO 3 stay free for USB programming and the serial monitor.

GPIO 25 used to be the relay. Move that wire to GPIO 4 before powering the board, or the player and the lock will share one pin.

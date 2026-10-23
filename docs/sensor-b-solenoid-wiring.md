# Sensor B Solenoid Door Wiring

The full door pin list, including the fingerprint sensor, both card readers, the RTC, the DFPlayer, the GF1002 amplifier, the 4Ω speaker, the HCW-P715 buck converter, the 2-channel relay, and the solenoid, is in:

```text
esp32/docs/door-hardware-pins.md
```

That map is the one compiled into `esp32/door_controller_for_sync/Config.h`. That sketch is the only firmware for the door ESP32: it synchronizes templates and schedules on the board, then uses that local data to unlock the door.

The lock circuit is:

```text
12V supply +  ----------------------  Solenoid +
              ------  HCW-P715 IN+
12V supply −  ------  Relay COM1
              ------  HCW-P715 IN−
              ------  ESP32 GND
Relay NO1     ------  Solenoid −
Relay IN1     ------  ESP32 GPIO 4
Relay IN2     ------  ESP32 GPIO 17
HCW-P715 5V   ------  relay VCC and the other 5V modules
```

Channel 1 is the lock. GPIO 4 goes LOW to unlock and rests HIGH. GPIO 17 keeps channel 2 off. GPIO 25 is the DFPlayer TX connection, not a relay pin. A `1N4007` diode sits across the solenoid, with the band toward the + wire. The 5W 4Ω speaker is on the GF1002 amplifier left output, fed from the DFPlayer DAC_L pin.

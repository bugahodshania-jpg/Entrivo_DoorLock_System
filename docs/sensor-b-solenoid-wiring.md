# Sensor B Solenoid Door Wiring

The full door pin list, including the fingerprint sensor, both card readers, the RTC, the DFPlayer, the relay, and the solenoid, is in:

```text
esp32/docs/door-hardware-pins.md
```

That map is the one compiled into `esp32/door_controller/Config.h`. That sketch is the only firmware for the door ESP32: it synchronizes templates and schedules on the board, then uses that local data to unlock the door.

The lock circuit is:

```text
12V supply +  ----------------------  Solenoid +
12V supply −  ------  Relay COM
Relay NO      ------  Solenoid −
Relay IN      ------  ESP32 GPIO 4
12V supply −  ------  ESP32 GND
```

The relay input is GPIO 4, not GPIO 25. GPIO 25 is the DFPlayer TX connection. A `1N4007` diode sits across the solenoid, with the band toward the + wire.

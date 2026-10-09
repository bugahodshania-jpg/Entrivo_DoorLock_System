# RFID Scanner Wiring

Use this with:

```text
esp32/Rfid_Scanner/Rfid_Scanner.ino
```

Power the ESP32 from USB. If the display board is marked 5 V, connect its VCC to the ESP32 5 V pin instead.

## RDM6300 reader

- VCC → ESP32 5 V
- GND → ESP32 GND
- TX → 10 kΩ → GPIO 16
- GPIO 16 → 20 kΩ → GND
- RX → leave open
- GPIO 17 → leave open

## ILI9341 display

- VCC → ESP32 3.3 V
- LED → ESP32 3.3 V
- GND → ESP32 GND
- CS → GPIO 5
- RST → GPIO 4
- DC → GPIO 2
- MOSI → GPIO 23
- MISO → GPIO 19
- SCK → GPIO 18

## Touch

- T_CLK → GPIO 25
- T_CS → GPIO 27
- T_DIN → GPIO 33
- T_DO → GPIO 32
- T_IRQ → GPIO 26

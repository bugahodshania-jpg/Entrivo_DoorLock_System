# Fingerprint Enrollment Station Wiring

This wiring is for the enrollment station: an ESP32 talking to an R307S optical fingerprint sensor over UART. Use it with:

```text
esp32/Enrollment_Station/Enrollment_Station.ino
```

The station has no relay and no lock. It only captures a fingerprint, stores the template on the R307S, and sends that template to the backend over Wi-Fi. USB is used for power, firmware upload, and the debug serial monitor.

## Firmware Pins

From `esp32/Enrollment_Station/Config.h`:

```cpp
#define FP_RX_PIN 16
#define FP_TX_PIN 17
#define FP_BAUDRATE 57600
```

The sketch opens UART2 on those pins at 57600 baud, 8 data bits, no parity, 1 stop bit. The USB serial monitor stays at 115200 baud.

## Wiring Diagram

```text
                         ENROLLMENT STATION

   PC / USB charger                         R307S fingerprint sensor
          |                                 +--------------------------+
          | USB 5V + data                   | Pin  Signal   Typical    |
          v                                 |      name     wire color |
   +------------------+                     |  1   Vin      red        |
   | ESP32 DevKit     |                     |  2   GND      black      |
   |                  |                     |  3   TXD      yellow     |
   |  5V / VIN  ------+-------------------->|  4   RXD      green      |
   |  GND       ------+-------------------->|  5   Touch    blue       |  leave open
   |                  |                     |  6   3.3V out white      |  leave open
   |  GPIO16  RX2  <--+---------------------|      TXD                 |
   |  GPIO17  TX2  ---+-------------------->|      RXD                 |
   |                  |                     +--------------------------+
   |  UART2           |  57600 baud, 8N1, 3.3V TTL
   |  USB serial      |  115200 baud debug log
   +--------+---------+
            |
            | onboard Wi-Fi, no extra wires
            v
      Backend server
      (SERVER_URL in Config.h)
```

TX and RX must be crossed:

```text
R307S TXD  (yellow)  ->  ESP32 RX   GPIO16
R307S RXD  (green)   <-  ESP32 TX   GPIO17
R307S Vin  (red)     <-  ESP32 5V / VIN
R307S GND  (black)   --  ESP32 GND
```

## Connection Table

| R307S pin | Typical wire | ESP32 | Notes |
| --- | --- | --- | --- |
| 1 Vin | Red | 5V or VIN | Sensor power. Do not use the ESP32 3.3V pin for this module. |
| 2 GND | Black | GND | Required. The sensor and ESP32 must share ground. |
| 3 TXD | Yellow | GPIO 16 (RX2) | Sensor transmit goes to ESP32 receive. |
| 4 RXD | Green | GPIO 17 (TX2) | ESP32 transmit goes to sensor receive. |
| 5 Touch / Wake | Blue | Not connected | The enrollment firmware does not read the finger-detect pin. |
| 6 3.3V out | White | Not connected | This pin is a 3.3V output from the module. Do not feed power into it. |

Wire colors follow the usual R307S cable. If a cable differs, trust the labels printed next to the module connector.

## Power

- The R307S supply range is about 3.6V to 6.0V. Power it from the ESP32 `5V` or `VIN` pin while the board is powered from USB.
- Peak sensor current is roughly 150 mA, which a USB-powered ESP32 can supply.
- UART on the R307S is 3.3V TTL. GPIO16 and GPIO17 are 3.3V, so no level shifter is needed.
- Do not power the sensor from the ESP32 `3.3V` pin. That rail is below the module's supply range.
- Leave the module's own 3.3V output pin open.

## Unused Pins

The enrollment sketch only uses UART. Leave these open:

- R307S Touch / Wake
- R307S 3.3V output
- Every ESP32 GPIO other than GPIO16 and GPIO17

## Check After Wiring

1. Upload `esp32/Enrollment_Station`.
2. Open the serial monitor at 115200 baud.
3. A good connection prints `Fingerprint Sensor Connected`.
4. `Fingerprint Sensor NOT Found` usually means swapped TX/RX, a missing ground, the sensor powered from 3.3V, or a baud rate other than 57600.

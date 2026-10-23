# Combined door controller and fingerprint enrollment

Open `Door_Controller_Enrollment.ino` in Arduino IDE. This sketch uses one R307S
for enrollment, database template imports, and entry verification. Entrance RFID
can also unlock the door. Both methods verify the registered account through the
backend before granting entry. Scheduling and overrides are deferred in this
sketch's dedicated verification endpoint.

The wiring and latched door behavior follow the saved
`../door_hardware_test/Fully_working_codeproplus.ino`. Its local Preferences test
allowlist is not used. Existing sensor templates are preserved.

## Configure and upload

1. Select **ESP32 Dev Module** (`esp32:esp32:esp32`). The sketch was built with
   ESP32 core 3.3.12. Required libraries: Adafruit Fingerprint Sensor Library,
   ArduinoJson, EspSoftwareSerial, RTClib, and Adafruit BusIO. WiFi, HTTPClient,
   Wire, and mbedTLS come with the ESP32 core.
2. Edit `Config.h`: set `WIFI_SSID`, `WIFI_PASSWORD`, `SERVER_URL`, and
   `ENROLLMENT_DEVICE_ID`. The URL must be reachable from the ESP32; `localhost`
   on the board cannot reach the computer's backend. Sensor A normally uses ID 1.
3. Generate a private device token, put it in `DOOR_DEVICE_TOKEN` in `Config.h`,
   and set the same exact value in the backend's ignored `backend/.env`:

   ```dotenv
   DOOR_DEVICE_TOKEN=your-private-device-token
   ```

   The default firmware token is empty, so entry is denied until configured.
   Restart the backend after changing its environment. Keep a shared token
   private. The existing HTTP URL is intended for the trusted local test network.
4. Keep **only this board** polling the configured enrollment device ID.
   Stop any `Enrollment_Station` or `Direct_Fingerprint_Door` board using that ID;
   otherwise the boards compete to claim the same enrollment/import jobs.
5. Upload to the board wired below and open Serial Monitor at **115200 baud**.
   `M` prints status, `T` prints RTC time, and `L` locks the door. There is no
   serial command to bypass database verification and unlock it.

The main sketch explicitly includes `Wire.h` and `RTClib.h` so Arduino IDE keeps
the RTC dependencies when reusing compiled `.cpp` files. If an older cached build
reports undefined references to `Wire`, `TwoWire`, or `RTC_DS3231`, reload this
updated sketch before verifying again. These libraries are needed at build time
even when no RTC is connected.

## Wiring from the working hardware test

Directions below refer to ESP32 pins. Keep the tested power supply, common
ground, relay contact wiring, and peripheral voltage arrangements.

| Connection | ESP32 GPIO / behavior |
| --- | --- |
| R307S TX to ESP32 RX | 32, hardware UART1, 57600 baud |
| R307S RX from ESP32 TX | 33, hardware UART1 |
| Entrance RDM6300 TX | 14, software serial, 9600 baud |
| Exit RDM6300 TX | 27, software serial, 9600 baud |
| DFPlayer TX to ESP32 RX | 25, hardware UART2, 9600 baud |
| DFPlayer RX from ESP32 TX | 26, hardware UART2 |
| DS3231 SDA / SCL | 19 / 21 |
| TTP223 output | 18, active HIGH |
| Relay IN2 (solenoid control) | **17: HIGH unlocks; LOW locks** |
| Relay IN1 (unused) | **4: held LOW** |

GPIO17 is the actual lock output in the reference's `setDoor()` function.
The reference's separate `DOOR_RELAY_PIN = 4` constant does not describe that
function's output. This sketch drives GPIO17 and keeps GPIO4 idle.

## Door operation

1. A recognized fingerprint or registered entrance RFID requests an access
   decision from `POST /api/door/verify_access.php`, using `X-Device-Token`.
2. An explicit boolean grant energizes relay IN2 and leaves the door **unlocked**.
   There is no automatic relock timer, matching the working hardware test.
3. Scan a registered card on the **exit** reader. The backend verifies it and
   arms touch-to-lock. Touch GPIO18 to lock. Touch alone does not lock, and the
   exit reader does not unlock an already locked door.
4. Once exit is authorized, network requests and sensor work stop until touch
   locks the door. Enrollment and imports only run while locked.

Audio uses the reference's `/MP3/0001.mp3` (unlock), `0003.mp3` (denied),
`0009.mp3` (locked), and `0011.mp3` (exit authorized), at volume 25. RTC time is
printed locally; backend time supplies access log timestamps. Missing RTC or
fingerprint hardware does not disable RFID verification.

Every new credential decision requires a reachable backend and an active,
approved account with completed setup. RFID cards must be uniquely registered,
active, and linked to that account. There is no offline credential allowlist.
A failed request cannot unlock the door or arm exit. A connection loss after
unlock leaves the existing latched state intact; serial `L` can lock locally.

## Enroll or import on this same sensor

Use **Fingerprint (Direct)** at `/super-admin/fingerprint-direct` or
`/admin/fingerprint-direct`. Select the same enrollment device ID as `Config.h`.

- For a new fingerprint, follow the two capture prompts and final fresh-scan
  verification. The board checks an empty destination before capture, then uses
  native `RegModel -> Store(buffer 2)` with no template transfer, metadata query,
  or HTTP between those commands. It loads the stored slot into buffer 1 and
  downloads the flash read-back. Uniform data fails enrollment. Removing and
  rescanning the same finger must identify the reserved slot with positive sensor
  confidence. A second flash read after that scan must match the first read
  byte-for-byte before completion and backup to the database.
- For a saved database fingerprint, use **Import from database**, find the
  employee, select a saved finger, and import. The board validates the backup,
  stores it, and checks its read-back SHA-256 before reporting completion.
- A database record alone cannot match a live finger. Its template must be
  enrolled or imported onto this physical R307S. Each entry match sends the
  actual sensor template's SHA-256 as well as its slot; the backend requires
  that hash to match the saved backup and a completed enrollment/import proof.
  Old hardware-test templates cannot gain entry just by sharing a slot number.
- Enrollment/import pauses access scanning. Remove your finger afterward.
  A lost completion response retries the same proof for up to three minutes;
  check the web job status if confirmation is rejected or times out. A failed
  confirmation reports a job failure when the backend still permits that state
  change; completed and cancelled jobs retain their backend state.
- Existing occupied slots are never erased or overwritten with different data.
  An occupied reservation requests a fresh recovery probe. A match to that exact
  slot continues with a second matching capture and final fresh verification,
  without writing flash. If the probe has no match,
  the board reads the sensor's full occupied-slot index and asks the backend to
  reserve an empty slot that is also free of database mappings and reservations.
  Completion uses the replacement slot. The board checks the empty destination
  before requesting the actual enrollment capture pair, and preserves the
  original occupied slot throughout.
  A match to a different slot stops enrollment with that slot number so an
  existing finger cannot silently be duplicated into another account. Sensor
  communication errors also stop enrollment. Import can reuse a slot when its
  existing template matches the selected backup exactly.

The web module retains its three-minute transaction timeout and its cancel,
retry, and one-minute form reset behavior. This sketch does not alter those UI
timers. The three-minute firmware confirmation limit is separate from finger
capture prompts (30 seconds per scan, 15 seconds to remove the finger).

Completion sends a device-authenticated `verification` object containing
`fresh_scan_verified`, `stored_slot`, `matched_slot`, the sensor's positive
`confidence`, `template_bytes`, and the lowercase `template_sha256` of the
checked flash data. No accuracy threshold is invented. Success requires the
backend to return the matching completed job/device/slot and the same persisted
verification fields with `verified_at`. A generic success response, malformed
reply, or mismatched proof remains unconfirmed and retries the exact saved
payload without another capture or sensor write. Update the backend and firmware
together; compilation does not update a board that is already flashed.

If enrollment fails while downloading the template, the sensor may already have
saved that finger. Upload the updated sketch, choose **Retry** on the failed job,
and complete the two matching captures. Then remove the finger and perform the
required fresh final verification scan. Recovery requires a match to that job's
reserved slot and preserves its existing stored template.

If an older sketch reports that the occupied reserved slot could not be confirmed,
upload this sketch after updating the backend, then choose **Retry**. A new finger
will automatically move past sensor-only templates left from earlier tests or
incomplete enrollments. No sensor memory reset or manual database slot edit is
needed. If the finger already matches another slot, the message identifies that
slot; use a different finger or reconcile the existing fingerprint's mapping.

Template read-back validates packet checksums and waits for the sensor's END
packet before determining the complete template length. It supports 512, 768,
1024, and 1536 bytes, with a strict 1536-byte buffer limit. The
[GROW R307S specification](https://en.hzgrow.com/product/188.html) and
[June 2022 R307S manual](https://www.hubtronics.in/docs/R307S-fingerprint-module-user-manual.pdf)
specify 512-byte templates and 256-byte character files. The connected module is
identified as R307S, yet this installation has exported 768-byte backups with
nonuniform data beyond byte 512. That discrepancy remains unexplained; it does
not identify a different sensor or justify discarding bytes. Every byte is
retained, hashed, exported, and verified
on import. A stream is never truncated or padded to 512 bytes. A final packet
may contain the remaining data or be a separate empty END packet. A failed read
is retried up to three times without writing sensor memory. If it still fails,
the web error and Serial Monitor
`[TEMPLATE]` lines show the packet type, payload length, and byte count; include
those details when diagnosing the hardware transfer.

If enrollment reaches 95% and reports that the template exceeds 512 bytes,
update the backend and upload this updated sketch. Updating the web page alone
does not update the controller. Choose **Retry**, complete the two matching
captures, then remove the finger and perform the fresh final verification scan
to recover the stored template using the occupied-slot checks above.

If a previously completed enrollment is not recognized, upload this revision
before retrying enrollment or updating that finger in the web module. This
revision adds a required final verification gate; an older completed job does
not imply that gate passed. Progress 95 downloads the saved model, 96 requests
finger removal, 98 requests a fresh final scan, and 99 starts with
`Final verification passed` only after the standard full-capacity search returns
the reserved slot with positive confidence and the final flash comparison passes.
The firmware preserves every existing slot on failure.

Uniform data (all bytes equal, including `00` or `FF`) is rejected on flash
read-back and before importing a database backup. Template size and SHA-256 alone
do not prove usable data. Native enrollment follows the manual's buffer-2 flow:
checked RegModel immediately followed by checked Store, with no model transfer,
metadata, or HTTP in between. Store/Load diagnostics include buffer, slot, and
status. GenImg, GenChar, RegModel, Store, Load, and UpChar require complete
checksummed status ACKs. These checks distinguish a valid command rejection from
a malformed response.
Database import still uses DownChar. Some compatible modules omit its post-data
download ACK. If no byte arrives in
the bounded final-ACK window, restoration still requires an exact current-buffer
read-back before succeeding. A received negative, partial, or malformed ACK
fails the restoration. Import requires this verified buffer immediately before
Store; native enrollment does not use DownChar.

Startup logs show `[FP] Sensor capacity=...` and `[FP] Stored templates=...`.
Each placement uses one standard full-capacity search. It no longer tries a
second compatibility search on the same capture. Search sends opcode `0x04`
against character buffer 1. Responses must pass header, address, packet type,
length, and checksum checks before their status is trusted. A successful ACK
must contain exactly five payload bytes: status, slot, and confidence. All
failed or malformed responses clear the previous match fields.

- `[FP] Search standard=0x09` means that capture did not match a stored template.
  Fully remove the finger before another scan.
- A validated status `0x17` is kept distinct. The R307S manual does not define
  it, and its cause is not established. A malformed packet is a host-side
  protocol failure (`0xFE`), with the specific error printed to Serial Monitor.
- An `image`, `image conversion`, or search communication error (`0x01`, `0xFE`,
  or `0xFF`) causes sensor reinitialization. Other sensor errors retain their
  actual status code. Invalid or stale match replies are rejected.

These diagnostics distinguish local sensor matching from backend authorization;
they do not assume that a particular sensor model or command caused the failure.

## Backend and validation

The new verification route uses `CombinedDoorAccessService.php` and the existing
enrollment/import endpoints. It records grants before returning permission to
the board. This route checks registered identities without schedules; the older
scheduled direct-access endpoint and `door_controller_for_sync` remain available
for their existing workflows.

The accompanying backend regression tests use connection-local temporary tables:

```powershell
php backend/tests/combined_door_access_test.php
php backend/tests/direct_fingerprint_access_test.php
php backend/tests/fingerprint_empty_slot_reservation_test.php
php backend/tests/fingerprint_enrollment_pickup_timeout_test.php
```

Firmware compilation includes RDM6300 framing/checksum, standard-search, and
enrollment proof workflow tests. The proof tests cover native RegModel/Store
ordering, uniform and changed flash read-back, failed command ACKs, recovery
without writing, failed fresh verification, and completion receipts bound to the
exact job, device, slot, confidence, template length, and hash. Physical fingerprint
enrollment, RFID reads, relay polarity, and audio still need a test on your board
after configuration and upload.

Run these compile-time tests by clicking **Verify** in Arduino IDE with this
sketch open, or run from the repository root with Arduino CLI on your PATH:

```powershell
arduino-cli compile --fqbn esp32:esp32:esp32 esp32/Door_Controller_Enrollment
```

The sketch's `*SelfTest.cpp` files run their `static_assert` checks during
compilation. They cover all four template sizes and require matching buffer
read-back even when a final download ACK is absent; received negative, partial,
or malformed ACKs fail. Search fixtures cover valid matches and `0x09`/`0x17`,
wrong checksums/addresses/types/lengths, truncated frames, missing match fields,
and stale IDs. The literal no-match frame with checksum `0x0017` must report
status `0x09`. A failed assertion stops the build. Verification does
not upload firmware or change sensor memory.

## Live door status and Sensor Memory

The portal header displays this controller's reported lock state beside the
date and time. `DoorStatus.cpp` sends authenticated state changes and a heartbeat
every three seconds from a separate task; HTTP waits do not delay touch-to-lock.
The page and backend block Sensor Memory reads unless the controller has
confirmed a locked door within fifteen seconds. Unlocking cancels queued or
running reads for this controller. Install the additive door-status migration
and upload this revision; see [Sensor Memory setup](../../docs/sensor-memory.md).

# Direct fingerprint enrollment and door access

Upload `Direct_Fingerprint_Door.ino` to the ESP32 connected to Sensor A when using the **Direct Fingerprint** web module. This separate sketch keeps the enrollment workflow and backend template backup, and uses the same sensor for access scans. It does not request Sensor B template or schedule sync jobs. The original `Enrollment_Station` and `door_controller_for_sync` sketches remain available for the two-sensor setup.

## Configuration and wiring

- Set `WIFI_SSID`, `WIFI_PASSWORD`, `SERVER_URL`, and `ENROLLMENT_DEVICE_ID` in `Config.h`. Device `1` is the current enrollment Sensor A.
- Set `DOOR_DEVICE_TOKEN` to the same private token configured in the backend before using enrollment completion or Sensor Memory. Device requests send it in `X-Device-Token`; the empty placeholder cannot confirm enrollment. Keep only one board polling this enrollment device ID.
- Fingerprint sensor TX → ESP32 GPIO16, sensor RX ← ESP32 GPIO17, UART2 at 57600 baud. Keep the sensor's existing power/ground wiring and voltage requirements.
- Lock relay IN1 → GPIO4, active LOW. Use the lock relay wiring/power arrangement documented in `../docs/door-hardware-pins.md`.
- **Do not wire relay channel 2 to GPIO17 in this setup**: GPIO17 is the sensor UART TX. This sketch uses only relay channel 1.
- The default unlock pulse is 3000 ms. The idle level is latched before the relay output is enabled. Hardware must hold the relay inactive during ESP32 reset as well.

Install the ESP32 board package, **Adafruit Fingerprint Sensor Library**, and **ArduinoJson** (6.x or 7.x), select the matching ESP32 board/port, and compile/upload the sketch. Serial Monitor runs at 115200 baud.

## Behavior

1. Enroll through the Direct Fingerprint module. The board checks an empty destination before the actual capture pair, then runs native `RegModel -> Store(buffer 2)` with no template transfer, metadata query, or HTTP between those commands. It loads the stored slot into buffer 1 and downloads its flash read-back, rejecting uniform data. Remove the finger and perform the required final fresh scan. Completion requires that standard full-capacity search to identify the reserved slot before the backend receives its backup. An occupied reservation may first request a recovery probe; follow all removal and capture prompts.
2. Remove the finger after enrollment, then scan for door access. A local sensor match is sent to `POST /api/fingerprint/verify_direct_access.php` as `{ "enrollment_device_id": 1, "matched_slot": N }`.
3. The backend validates the mapped user and access schedule. Only an HTTP 200 JSON response containing boolean `success: true` and boolean `access_granted: true` activates the relay.
4. The relay returns to its locked level after the pulse. The main loop pauses access requests, enrollment, and sensor work while the relay is active, and another access attempt requires finger removal. A separate status-reporting task sends the lock state without delaying the pulse timer.

The portal header shows the controller's reported lock state. Sensor Memory
reads require a fresh **locked** report; unlocked or unavailable controllers
cannot start reads. Install `backend/migrations/create_door_status.php` and
upload this revision to enable the reports. See [Sensor Memory setup](../../docs/sensor-memory.md).

Enrollment completion requires a positive-confidence fresh match to the reserved slot, followed by a second flash read that is byte-identical to the first. The completion request includes `verification` with `fresh_scan_verified`, `stored_slot`, `matched_slot`, the actual positive sensor `confidence`, `template_bytes`, and lowercase `template_sha256`. The backend must confirm the matching completed job/device/slot and echo that persisted proof with `verified_at`; generic success or mismatched replies do not complete the firmware workflow. The exact proof and backup are retained for confirmation retries for up to three minutes, without capturing or storing another model, including if the sensor disconnects after verification. Rejection or timeout attempts failure reporting while leaving existing sensor slots intact. No confidence accuracy threshold is invented. Update the backend and firmware together.

## Import an existing database backup

Use **Import from DB** in Direct Fingerprint to look up the employee and choose their stored fingerprint backup. The backend queues a direct Sensor A import. This updated sketch must be uploaded before using that button.

The ESP32 claims the job at `/api/fingerprint/direct_import_device.php`, validates its supported byte size and SHA-256 hash, checks the reserved slot against the sensor's actual index, sends the template to the sensor, saves it, and reads it back. The backend receives completion only after the stored template's full byte length and SHA-256 hash match the backup. No enrollment scans or Sensor B are required.

Template backup and import support 512, 768, 1024, and 1536 bytes. The board checks each sensor packet and waits for the END packet, preserving every template byte up to the strict 1536-byte limit. It never truncates or pads a larger template to 512 bytes. The connected module is identified as R307S. Its [GROW specification](https://en.hzgrow.com/product/188.html) and [June 2022 manual](https://www.hubtronics.in/docs/R307S-fingerprint-module-user-manual.pdf) specify 512-byte templates and 256-byte character files, while this installation has exported 768-byte backups containing nonuniform data beyond byte 512. That discrepancy remains unexplained; it does not identify a different sensor or justify discarding bytes. Upload this updated sketch as well as updating the backend if enrollment fails at 95% while downloading a template larger than 512 bytes. The web page alone cannot update firmware already on the ESP32.

An occupied slot is accepted only when its existing template already has the exact same hash; it is verified without rewriting. A different template, unreadable slot index, or matching fingerprint found in another slot stops the import without overwriting anything. The backend retains the same reserved slot when retrying an unchanged backup, so a lost completion response can be recovered without creating a second copy.

Enrollment and access scans pause while an import runs or its result awaits backend confirmation. Result reporting retries the same job for up to three minutes; the backend also enforces its own pickup and processing deadlines. Remove your finger after import before scanning for access. A failed or unconfirmed import never authorizes door access by itself.

WiFi loss, unreachable backend, invalid JSON, unknown/disabled user, and denied schedules keep the relay locked. **Direct access requires the backend online for every scan.** Enrollment pauses access scanning because both functions share the same sensor. A template stored locally without confirmed backend completion does not by itself grant access; resolve the enrollment in the web module and retry if completion failed.

## Diagnose an enrolled finger that is not recognized

Upload this revision before retrying enrollment or updating a finger that an older completed job cannot recognize. New enrollments require a final fresh-scan verification; older completed jobs do not imply that this gate passed. Progress 95 downloads the saved template, 96 requests finger removal, 98 requests a fresh final scan, and 99 starts with `Final verification passed` only after standard full-capacity search identifies the reserved slot. A different match fails with that slot number for reconciliation; existing sensor data is preserved.

Startup logs report sensor capacity and stored-template count. Each placement uses one standard full-capacity Search (`0x04`) against character buffer 1, with no second compatibility search on the same capture. Every search response must pass header, address, packet type, length, and checksum checks. Success requires exactly five payload bytes containing the status, slot, and confidence; failed or malformed responses clear prior match fields. `[FP] Search standard=0x09` means no stored template matched that capture. A validated status `0x17` remains visible as undefined by the R307S manual; its cause is not established. Host-rejected malformed packets use `0xFE` and include the protocol error in Serial Monitor. Successful matches print slot and confidence before backend authorization. Acquisition, conversion, and search errors remain separate; communication errors trigger reinitialization.

Uniform templates (all bytes equal, including `00` or `FF`) are rejected on flash read-back and before importing a database backup. Valid size and SHA-256 alone are insufficient. Native enrollment checks the destination before capture and stores the sensor-generated buffer 2 immediately after RegModel. It does not send an exported model back to the sensor before Store. Store, Load, RegModel, GenImg, GenChar, and UpChar use checked status ACKs; Store/Load log buffer, slot, and status. The final fresh capture must identify the reserved slot before completion.

Database import still uses DownChar to restore an existing backup. Some compatible modules omit the post-data download ACK. Restoration may proceed to current-buffer verification only if no byte arrives in the bounded final-ACK window; it succeeds only after exact byte read-back. Any received negative, partial, or malformed ACK fails. Import requires this verified restoration immediately before Store; native enrollment does not use DownChar.

## Run the firmware regression checks

Click **Verify** in Arduino IDE with this sketch open, or run from the repository root with Arduino CLI on your PATH:

```powershell
arduino-cli compile --fqbn esp32:esp32:esp32 esp32/Direct_Fingerprint_Door
```

The sketch's `*SelfTest.cpp` files use `static_assert` during compilation. They check validated search and status ACK frames, explicit buffer/slot command bytes, bounded transfers at all four supported sizes, adjacent native RegModel/Store operations, uniform or changed flash rejection, recovery without writing, required fresh verification, and completion receipts bound to the exact job/device/slot/confidence/template length/hash. Search fixtures cover valid matches and `0x09`/`0x17`, malformed or truncated frames, wrong addresses/types/lengths/checksums, and stale match fields. The literal no-match frame whose checksum is `0x0017` must still report status `0x09`. Import restoration checks retain exact byte proof, including when a final ACK is absent. A failed assertion stops the build. Verify compiles without uploading or changing sensor memory.

To return to the two-sensor setup, use the original Fingerprint module and its original enrollment/door-controller firmware and wiring.

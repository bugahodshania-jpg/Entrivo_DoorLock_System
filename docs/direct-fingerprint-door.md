# Fingerprint (Direct)

Use one physical Sensor A for both fingerprint enrollment and door access. The
new **Fingerprint (Direct)** page uses the existing fingerprint page's styling
and enrollment workflow. **Fingerprint (Sync)** remains available for a separate
Sensor B door controller.

## Open the module

- Super Admin: `/super-admin/fingerprint-direct`
- Admin: `/admin/fingerprint-direct`

Both pages use the existing Fingerprint and Update Fingerprints privileges.
The direct module shares user records, enrollment jobs, and stored fingerprint
backups with the sync module. It does not create Sensor B template sync jobs.

Enroll, add, update, view, and delete fingerprints from the direct page. A
successful enrollment stores the fingerprint on Sensor A and records its user
and local slot in the backend. Exporting a backup is optional; no manual upload
or template sync is required for direct access.

## Import a saved database backup

1. Open **Fingerprint (Direct)** on a desktop or laptop and select **Import from
   database**.
2. Enter the employee ID exactly as registered, then search. Review the matched
   user's name, employee ID, role, account status, and contact/work information.
3. Select the saved finger to restore. The dialog shows which backups are valid
   and explains why an unavailable backup cannot be imported.
4. Confirm the import. Sensor A retrieves the selected database backup, stores
   it locally, and reads it back to verify the template before the dialog reports
   completion. No new finger scans or backup file upload are required.

Searching requires the Fingerprint privilege. Restoring a template also requires
Update Fingerprints access. The selected backup stays linked to its existing
owner; entering another employee ID does not reassign a fingerprint.

The controller reuses that fingerprint's own sensor slot where possible. It
checks occupied slots before writing and refuses to replace different template
data. Retrying an interrupted import reuses its reserved slot to avoid creating
duplicate templates. Keep Sensor A powered and connected during the import.

Queued imports cancel after three minutes without pickup. Imports also cancel
if Sensor A does not confirm completion within three minutes after pickup. The
dialog explains the failure and allows retrying after the controller is ready.

Use the updated `Direct_Fingerprint_Door` firmware for this feature, including
when an earlier version of that sketch was already installed. The backend
creates its import job table on first use; the equivalent migration is included
under `database/` for managed deployments. The original Sensor B queue and its
sync status are not used by this restore.

The enrollment indicator describes the stored fingerprint. Actual door access
also requires the account, fingerprint, device, and current access schedule to
be eligible. A stale template left in sensor memory after deletion does not
authorize entry because each match is checked against current backend records.

## Install the direct controller firmware

Open `esp32/Direct_Fingerprint_Door/Direct_Fingerprint_Door.ino` in Arduino IDE.
Configure `Config.h` for the Wi-Fi network, backend URL, and enrollment device ID.
The page uses Sensor A device ID **1** by default.

The default wiring keeps Sensor A's existing serial pins:

| Connection | ESP32 pin |
| --- | --- |
| Fingerprint sensor TX | GPIO 16 (ESP32 RX) |
| Fingerprint sensor RX | GPIO 17 (ESP32 TX) |
| Lock relay input | GPIO 4 |

GPIO 17 is used by the fingerprint sensor in this sketch. The direct sketch uses
one relay channel. Set its active and idle levels in `Config.h` to match the
actual relay module; the default follows the existing door controller's active
LOW relay. See the existing enrollment and door hardware wiring documents for
power and relay contact wiring.

Upload this new sketch to the ESP32 connected to Sensor A. The existing
`Enrollment_Station` and `door_controller_for_sync` sketches remain separate and available.
The web page alone does not change firmware already installed on the ESP32.

## Enrollment or update stops at 95%

If an attempt reports `sensor template exceeds the expected 512 bytes`, update
the controller firmware. Older firmware stopped reading at 512 bytes even when
the sensor was still sending the template. Both direct controller sketches now
read through the checksummed final data packet and preserve complete 512, 768,
1024, or 1536-byte templates. Unsupported lengths, missing final packets, and
checksum failures still fail enrollment; data is never truncated to fit.

The installed module has been identified as an R307S. GROW's
[R307S specification](https://en.hzgrow.com/product/188.html) and
[June 2022 manual](https://www.hubtronics.in/docs/R307S-fingerprint-module-user-manual.pdf)
specify a 512-byte template. The observed 768-byte transfers do not match that
published format. One such backup contains nonuniform data throughout all three
256-byte segments, so discarding its final segment would lose data. The firmware
preserves the complete stream and requires valid flash read-back and fresh recognition;
support for a transfer length alone does not establish that the template is usable.

Upload the sketch matching the controller already installed:

- `esp32/Direct_Fingerprint_Door/Direct_Fingerprint_Door.ino` for the standalone
  fingerprint door with GPIO16/17 sensor wiring.
- `esp32/Door_Controller_Enrollment/Door_Controller_Enrollment.ino` for the
  combined fingerprint/RFID controller with GPIO32/33 sensor wiring and GPIO17
  relay wiring. See that sketch's README for setup.

After uploading, select **Retry** on the failed enrollment job and follow the
two capture prompts, then remove and present the same finger for final
verification. A successful attempt must reach 100% and show **Completed**. The
backend now returns template metadata in completion JSON, keeping raw binary
bytes in the database so they cannot break the success response.

Backup imports, exports, and direct door verification preserve and validate the
complete template and its SHA-256 hash. The separate legacy Sensor B firmware
still accepts only 512-byte templates; larger backups require a compatible
controller and are not converted or shortened for Sensor B.

## Enrollment reports completion but the finger does not match

The R307S enrollment path reserves and checks an empty destination before the
actual capture pair. It then follows the manufacturer's native sequence:
capture into buffers 1 and 2, generate the model, and immediately store buffer 2.
No template upload/download, metadata query, or HTTP request occurs between
model generation and Store. The board loads the saved slot into buffer 1 and
downloads that flash read-back for backup. It then prompts for finger removal
and a fresh verification scan. The standard sensor search must find the assigned
slot before the job can complete.

An older path exported the generated model to the ESP32 and sent it back before
Store. The observed hardware could pass that RAM roundtrip yet return uniform
data after Store/Load. Native enrollment no longer depends on that roundtrip.
Store, Load, model generation, image conversion, and template-upload replies now
require complete checksummed status ACKs. Serial Monitor identifies the Store
and Load buffer, slot, and status for diagnosing an actual flash failure.

A failed read-back, a constant buffer (such as all `0xFF`), or a final scan that
does not match the assigned slot fails the job with its actual reason. The
backend also rejects constant buffers during completion, import, export, and
access verification. A matching hash proves byte integrity; a fresh scan proves
that the stored model can recognize the enrolled finger.

For an older completed enrollment that fails verification, upload the updated
matching sketch and use **Update** on the existing fingerprint record. Follow
all capture and final verification prompts. Failed or cancelled jobs can use
**Retry**. Completed jobs cannot be retried.

An occupied reservation first requests a recovery probe. A match to that exact
slot requires the second matching capture and final fresh verification without
writing flash. A non-match reserves an empty replacement before requesting a
new pair of capture scans. Follow the removal prompts between the recovery
probe, enrollment captures, and final verification.

Sensor memory and backend registration are separate. A message such as
`Matched slot 21` followed by `This sensor slot is not linked to a registered
fingerprint` means that the sensor reported a locally stored template without a
linked backend registration for that controller. Firmware uploads do not reconcile
those registrations. An enrollment
that finds the same finger at another slot stops with that slot number so the
existing mapping can be reviewed before assigning ownership.

## How door access works

If enrollment completes but the Serial Monitor reports an unrecognized finger,
the failure is at the sensor search stage, before backend authorization. Older
firmware used the same message for a genuine non-match and sensor communication
errors. Upload the updated matching sketch, remove your finger, and scan the
enrolled finger again. The scanner uses the standard full-capacity search.
A match still requires backend authorization. The automatic fast-search retry
was removed because the observed controller returned `0x17` after a standard
non-match; a second command on the same captured buffer did not resolve it.
Both standard and fast search are documented R307S commands; that observed result
does not establish that either opcode is unsupported. Search replies are checked
for header, address, acknowledgement type, payload length, and checksum before a
status or slot is accepted. A successful reply must include the complete slot and
confidence fields. Malformed replies are reported as communication/protocol errors.

The new `[FP] Search standard=0x..` line identifies the result:

- `0x09` means the sensor did not match that scan.
- `0x07` during image conversion means too few fingerprint features were
  extracted. Remove and reposition the finger before retrying.
- `0x17` remains visible only as an undefined sensor status. The R307S manual
  does not assign this response a meaning. It is not evidence of a residual
  finger or an unsupported search command. Preserve the diagnostic line for
  investigation rather than translating it to a match or a normal non-match.
- `0x01`, `0xFE`, or `0xFF` indicates a communication failure; the controller
  retries sensor initialization.
- `[FP] Matched slot N` means local matching succeeded. The next message reports
  backend authorization or a template-verification problem.

Include that search line and the startup `[FP] Sensor capacity` and
`[FP] Stored templates` lines when diagnosing a persistent failure.

1. Sensor A matches the scanned finger against its local enrolled templates.
2. The ESP32 sends the device ID and matched local slot to
   `POST /api/fingerprint/verify_direct_access.php`.
3. The backend resolves the fingerprint's user and checks enrollment, account,
   device, and current schedule or approved override.
4. The relay opens only after an explicit successful access grant. The controller
   relocks after its configured unlock duration and requires finger removal
   before another scan.

This version requires a reachable backend for every door decision. A failed
request or unavailable backend leaves the lock in its idle state. Enrollment
temporarily pauses door matching because both operations use the same sensor.

## Return to the sync workflow

Use **Fingerprint (Sync)** at `/super-admin/fingerprint` (or `/admin/fingerprint`)
and the existing separate enrollment and Sensor B controller firmware. Templates
backed up during enrollment remain available to the original sync workflow.


# R307S Sensor Memory

Open **Sensor Memory** in the Admin or Super Admin sidebar, beside
**Fingerprint (Direct)**. The module uses the existing Fingerprint privilege.
It reads the R307S connected to the selected enrollment controller and compares
those readings with the database's device/slot mappings and saved templates.
**Erase sensor templates** asks for the signed-in administrator's password, then
tells that controller to delete every fingerprint template and slot ID on the R307S.

## Read the actual sensor

1. Select the controller connected to the R307S, normally Sensor A / device 1.
2. Select **Read sensor**. Keep the controller powered and connected to the
   backend. It must have the updated firmware described below.
   The header shows the selected controller's **Door locked**, **Door unlocked**,
   or **Door unavailable** status beside the date and time. Both **Read sensor**
   and **Read template** are disabled unless a recent controller report confirms
   the door is locked. The API enforces the same check. An unlock cancels queued
   or running reads; request a new reading after locking the door again.
3. Wait for the controller to return its capacity, stored-template count, and
   occupied slot IDs. The module shows the last completed reading while a new
   request waits or runs.
4. Open a slot's three-dot menu and select **View**. For an occupied slot, use
   **Read template** to retrieve that slot's actual stored binary template and
   compare its size and SHA-256 with the database copy. The template view also
   provides its raw representation and download.

Slot IDs come from the sensor's occupied-slot index, including slot 0 when it
is present. A sensor-only slot has no database owner to display. A database-only
row is a saved device/slot mapping absent from that particular sensor reading.
Conflicting mappings are shown separately. A mapped slot alone does not prove
the template bytes match; template comparison requires a successful template
read. A slot read error preserves the inventory and reports the error.

The page labels readings with their received time. These are snapshots of the
physical sensor, not a claim that it is continuously connected or unchanged.
Database comparisons use the current database records. Inventory and individual
template reads can have different timestamps. An offline controller, missing
firmware, or failed read must not appear as an empty sensor.

## Install the firmware support

The web server cannot access the R307S UART directly. The ESP32 must receive the
request and return the actual sensor result. Update whichever sketch is running
on that board:

- Combined RFID/fingerprint door controller and enrollment:
  `esp32/Door_Controller_Enrollment/Door_Controller_Enrollment.ino`
- Standalone direct fingerprint controller:
  `esp32/Direct_Fingerprint_Door/Direct_Fingerprint_Door.ino`

Set `SERVER_URL` and `ENROLLMENT_DEVICE_ID` for that controller. Set the same
private `DOOR_DEVICE_TOKEN` in its `Config.h` and `backend/.env`; the standalone
sketch's new token setting is empty until configured. Preserve the existing
network settings, wiring, and token of a configured combined controller.
Keep only one controller polling each enrollment device ID.

Verify and upload the selected sketch through Arduino IDE. Adding the web module
does not update firmware already flashed on a board. Firmware verification alone
does not upload it. Reads run while the door is locked and yield to existing
enrollment/import work. Existing door operation and authentication remain in
their respective sketches.

## Backend setup

Run the additive migration once before using the new API:

```powershell
& C:\xampp\php\php.exe backend/migrations/create_sensor_memory.php
& C:\xampp\php\php.exe backend/migrations/create_door_status.php
```

The module keeps read requests, completed inventories, and individual template
readings in separate `sensor_memory_*` tables. Reading does not assign, import,
or modify an enrolled fingerprint. **Erase sensor templates** is the only action
that changes sensor flash: after the signed-in administrator's security password
is accepted, the controller issues the R307S empty command and confirms that the
template count and every slot ID are clear. The door must stay locked. Upload
the updated controller firmware before using erase; an older sketch cannot
perform it.

Admin requests use `backend/api/fingerprint/sensor_memory.php`. The controller
uses `backend/api/fingerprint/sensor_memory_device.php` with its configured
`X-Device-Token`. Device responses are bound to a particular controller, request,
and claim token. Unclaimed or unfinished reads time out after three minutes;
retrying does not overwrite the last completed inventory.

Templates are binary fingerprint features. A hex or Base64 view represents those
bytes; it is not a captured fingerprint photograph. Raw sensor readings are
stored separately from the original fingerprint database backup.

The controller reports its lock relay state on changes and every three seconds
to `backend/api/door_status_device.php`, using the existing `X-Device-Token`.
Reporting runs in a separate ESP32 task so network waits do not delay the
touch-to-lock path or the standalone controller's unlock timer. Portal headers
refresh through `backend/api/door_status.php` every half second while visible
and online, and refresh immediately on focus, tab return, or network reconnection.
Failed requests retry automatically without reloading the page or restarting the
system. Reports expire
after fifteen seconds; unavailable, stale, and never-reported controllers cannot
enable reads. This indicates the controller's lock state, not whether the door
panel is physically closed. Upload the updated firmware to enable these reports.

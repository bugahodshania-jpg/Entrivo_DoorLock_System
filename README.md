# Entrivo Door Lock System

Entrivo is an IoT smart door lock for a classroom or laboratory. Faculty and
staff enter with a fingerprint or an RFID card, students enter with an RFID card
during an approved override, and every entry, exit and refusal is logged. The
door is managed from a web portal.

| Part | Folder | Runs on |
| --- | --- | --- |
| Web portal (React + Vite) | `frontend/` | Vercel: `https://entrivodoorlocksystem.vercel.app` |
| Backend API (PHP 8) | `backend/` | Railway: `https://entrivo-backend-production.up.railway.app` |
| Database (MySQL) | `database/`, `backend/migrations/` | MySQL server used by the backend |
| Door controller firmware | `esp32/Door_Controller_Enrollment/` | ESP32 at the door |
| RFID registration scanner | `esp32/Rfid_Scanner/` | Separate ESP32 with a touch display |

Turn-over documents (user manual and installation, deployment and wiring guide)
are in `Manuscript/Turnover Files/`.

## Current status of the door lock

The door ESP32 runs **`esp32/Door_Controller_Enrollment`**. It is the only door
firmware in use. Its README has the full wiring, voice tracks and behaviour:
[Door Controller + Enrollment](esp32/Door_Controller_Enrollment/README.md).

- **Entry.** One R307S fingerprint sensor (GPIO 32/33) and the entrance RDM6300
  reader (GPIO 16) are checked by the backend
  (`/api/door/verify_access.php`, `X-Device-Token`). Entry needs a registered
  credential, an active account and the role's schedule rule: faculty and staff
  a regular schedule or an approved override, students an approved override,
  administrators any time.
- **Lock.** The solenoid is switched by relay IN2 on **GPIO 17** (HIGH unlocks,
  LOW locks). GPIO 4 (IN1) is held LOW and unused. A granted entry leaves the
  door unlocked; there is no automatic relock timer.
- **Exit and locking.** A card on the exit reader inside (GPIO 27), or touch and
  then the same finger, records the exit and arms the TTP223 touch sensor
  (GPIO 18). Touching the sensor then locks the door. Exit is never refused.
- **Voice.** A DFPlayer Mini plays tracks `0001`–`0024` through a GF1002
  amplifier and 4 Ω speaker at volume 26, including a reminder 15 minutes
  before a schedule ends.
- **Offline.** The controller keeps a copy of who may enter today and the next
  7 days. When the backend does not answer, entries inside a saved schedule
  window are allowed, exits are always allowed, and both are saved on the
  controller and added to the access log when the connection returns. The
  emergency card (set in `Secrets.h`) opens the door when the backend is
  unreachable.
- **Settings → Door control** sets scheduling to Auto (recommended), On or Off,
  and locks or unlocks the door remotely. **Staff room hours** let chosen staff
  enter during the room's daily hours without a schedule.
- **Portal header** shows the live door status. It reads *Door unavailable*
  when the controller has not reported for a while.

`esp32/door_controller_for_sync` and `esp32/docs/door-hardware-pins.md` describe
an earlier two-sensor design (lock on GPIO 4). They are kept for reference only;
do not flash that sketch on the door.

## Portal modules

- **Super admin / admin:** Dashboard, Manage Users, Pending registration,
  Fingerprint (Direct), Sensor Memory (super admin), RFID Cards, Schedules,
  Override Requests, Delete Requests, Access Logs, Login / Activity / System
  Logs, Reports, Settings. Admins see only the pages their privileges allow.
- **Faculty and staff:** Dashboard, My Schedule, My Override Requests, Access
  Logs, logs, My Account.
- **Students:** Dashboard, Access Logs, logs, My Profile. Students register
  themselves with the school ID read on the RFID registration scanner.

Approved overrides notify the affected users by email and in the portal. See
[override notification setup](docs/override-notifications.md). The
[Sensor Memory setup](docs/sensor-memory.md) explains comparing the R307S slots
with the database.

## Run it locally

Double-click `start-system.bat`, or run this from PowerShell:

```powershell
.\start-system.ps1
```

The launcher starts:

- Backend API: `http://127.0.0.1:8000`
- Frontend: `http://127.0.0.1:5173`

Keep both server windows open while using the system.

Temporary admin login:

- Email: `superadmin@entrivo.local`
- Password: `AdminPassword1016`

## Configuration

Private values are never stored in git:

- `backend/.env`: database (`DB_*`), email (`SMTP_*` or `BREVO_API_KEY`),
  `APP_LOGIN_URL`, `DOOR_DEVICE_TOKEN`, `RFID_DEVICE_TOKEN` and
  `DOOR_EMERGENCY_RFID_UIDS`.
- `esp32/Door_Controller_Enrollment/Secrets.h` and
  `esp32/Rfid_Scanner/Secrets.h`: Wi-Fi password, the device token that must
  equal the backend value, and the emergency card UID. Copy each
  `Secrets.example.h` to `Secrets.h` and fill it in.
- `frontend`: `VITE_API_BASE_URL` points the portal at the backend.

Run the backend tests with `php backend/tests/<name>_test.php`. Compile the
door firmware, which also runs its self-tests, with:

```powershell
arduino-cli compile --fqbn esp32:esp32:esp32 esp32/Door_Controller_Enrollment
```

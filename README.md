# Entrivo Door Lock System

PHP API, MySQL database, and React frontend scaffold for the Entrivo smart door lock system.

The separate **Fingerprint (Direct)** module supports enrollment and door access
on the same Sensor A. **Fingerprint (Sync)** retains the existing Sensor B
workflow. See [direct fingerprint setup](docs/direct-fingerprint-door.md) for
the new controller sketch and wiring.

For the combined fingerprint enrollment, fingerprint/RFID door controller using
the tested GPIO32/33 sensor and GPIO17 relay wiring, see
[Door Controller + Enrollment](esp32/Door_Controller_Enrollment/README.md).
This version verifies registered identities; scheduling will be added later.

## Start the System

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

Database credentials belong in `backend/.env`, which is not stored in git.

Approved overrides notify affected users by email and through a dashboard modal
that checks for new notices every five seconds. See
[override notification setup](docs/override-notifications.md) for SMTP settings,
delivery retries, and verification commands.

Access Logs retain the scanned RFID UID, including denied attempts from unknown
cards, and show it beneath the RFID method. Existing installations can run
`backend/migrations/add_access_log_rfid_uid.php` once; the door verification
service also prepares the column automatically. Older logs without a saved UID
remain blank.

Admin and personal Access Logs refresh automatically every two seconds while
the page is visible and online. The Live indicator shows the last successful
update; temporary connection failures retain displayed records and retry.

The **Sensor Memory** sidebar module reads the physical R307S occupied slots and
individual templates for comparison with database records. See
[Sensor Memory setup](docs/sensor-memory.md), including the required ESP32
firmware update and database migration.

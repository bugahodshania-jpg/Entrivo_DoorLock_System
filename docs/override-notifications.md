# Approved override notifications

Approving a request creates one persistent notice per affected user, grouping that
user's overlapping schedules. The modal opens after login and checks for new
notices every five seconds while the dashboard is visible. Acknowledgement is
stored in the database, including across logins and browsers.

Only approved schedules with a real time overlap qualify. Adjacent windows do
not overlap, and daily/weekly/selected-weekday legacy recurrences respect their
date bounds. New recurring schedules already exist as individual dated rows.
Pending, cancelled, completed, and expired schedules are excluded. All displayed
and stored notification times use Asia/Manila. Notices describe the overlap;
existing door-access rules are unchanged.

Administrator-created override schedules add a new Override row and stamp the
overlapping Regular schedule without changing its times. The affected user is
notified in the dashboard modal and by email. User-requested approvals use the
same stamp and also notify the owner when their regular schedule is overlapped.

## Setup

Run this once when deploying with a database user that cannot create tables at
runtime:

```powershell
& C:\xampp\php\php.exe backend/migrations/create_override_notifications.php
```

The API also creates the table automatically before starting an approval
transaction. Notification creation and schedule approval commit together; a mail
failure cannot undo approval or remove the dashboard notice.

The existing `backend/.env` SMTP settings are used:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-sending-account@example.com
SMTP_PASSWORD=your-app-password
SMTP_FROM_NAME=Entrivo
```

Use the sending account's actual app password. These are placeholders; keep real
credentials in the ignored `.env` file. The CLI worker loads the same file as the
API.

After approval, a separate PHP CLI worker sends email, keeping the HTTP server
available even when SMTP is slow. On Windows it uses PowerShell `Start-Process`
with a hidden window; other hosts launch a detached CLI process. PHP must allow
`exec`; Windows also needs PowerShell and `iconv`. The approval response reports
whether a worker was started and says that mail is queued, rather than claiming
that queued mail was sent.

The worker automatically retries known failures with backoff (5, 10, 20, then
30 seconds), at most five attempts per recipient, for approximately three
minutes per worker plus any in-progress SMTP operation. Multiple workers cannot
claim the same recipient concurrently. Cancelled overrides, revoked override
schedules, blocked recipients, and override windows that have already ended are
rechecked before each attempted delivery. Previously created dashboard notices
remain available after the time window ends, provided the override and its
approved schedule still exist.

If a large or slow approval still has eligible recipients when that worker's
budget ends, it starts another bounded worker after making progress. Continuation
stops when no retryable recipients remain; the five-attempt cap still applies to
each recipient. A failed continuation launch is logged for manual retry.

If process launch is disabled or the worker was interrupted, run one delivery
batch manually or through a scheduler:

```powershell
& C:\xampp\php\php.exe backend/tools/deliver_override_notifications.php 20
```

For one override, including automatic retries, supply its id and `--loop`:

```powershell
& C:\xampp\php\php.exe backend/tools/deliver_override_notifications.php 100 123 --loop
```

No worker automatically retries `sent`, `sending`, or `uncertain` rows. A lost
SMTP acceptance response can mean that the email already arrived; leaving that
row for inspection avoids duplicate mail. Interrupted `sending` rows likewise
require manual inspection. Inspect `email_status`, `email_attempts`,
`email_attempted_at`, `email_sent_at`, and `email_error` in
`override_notifications` when troubleshooting. SMTP acceptance does not guarantee
inbox delivery; the receiving provider can still filter the email.

## API and verification

`GET /api/notifications.php?user_id=ID` returns unacknowledged current-override
notices. `POST /api/notifications.php` accepts
`{"action":"acknowledge","user_id":ID,"id":NOTICE_ID}` and only acknowledges
that owner's row. Responses use `Cache-Control: no-store`. This follows the
existing portal's `user_id` identity convention; the application does not yet
have a general authenticated server session for these endpoints.

Run the regressions without live email or production database changes:

```powershell
& C:\xampp\php\php.exe backend/tests/override_notifications_test.php
& C:\xampp\php\php.exe backend/tests/override_notifications_dispatch_test.php
```

The first uses SQLite and injected mail callbacks, including known failures and
ambiguous SMTP acceptance. The second launches a harmless local sleeper to
verify that dispatch returns before its worker completes.

import re
from pathlib import Path

root = Path(r"c:\xampp_new\htdocs\Entrivo_DoorLock_System\backend")

api_files = [
    root / "api" / "access_logs.php",
    root / "api" / "schedules.php",
    root / "api" / "dashboard_stats.php",
    root / "api" / "rfid.php",
    root / "api" / "user.php",
    root / "api" / "fingerprint" / "fingerprint_dashboard.php",
]

dsn_block = re.compile(
    r"\$config = require .+?/config/database\.php';\s*"
    r"\$dsn = sprintf\(\s*'mysql:host=%s;port=%s;dbname=%s;charset=%s',\s*"
    r"\$config\['host'\],\s*\$config\['port'\],\s*\$config\['database'\],\s*\$config\['charset'\]\s*\);\s*",
    re.S,
)

pdo_block = re.compile(
    r"\$pdo = new PDO\(\$dsn, \$config\['username'\], \$config\['password'\], \[\s*"
    r"PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,\s*"
    r"PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,\s*\]\);\s*"
    r"(?:\$pdo->exec\(\"SET time_zone = '\+08:00'\"\);\s*)?",
    re.S,
)

for path in api_files:
    text = path.read_text(encoding="utf-8")
    orig = text
    if "fingerprint" in str(path).replace("\\", "/"):
        require = "require_once dirname(__DIR__, 2) . '/config/connection.php';\n"
    else:
        require = "require_once dirname(__DIR__) . '/config/connection.php';\n"

    text = dsn_block.sub(require + "\n", text)
    text = pdo_block.sub("$pdo = entrivo_pdo();\n", text)

    if text != orig:
        path.write_text(text, encoding="utf-8")
        print("updated", path)
    else:
        print("NO CHANGE", path)
        if "$config = require" in text:
            print("  still has config require")
        if "new PDO" in text:
            print("  still has new PDO")

# Models
model_files = [
    root / "models" / "Fingerprint.php",
    root / "models" / "FingerprintEnrollmentJob.php",
    root / "models" / "FingerprintSyncQueue.php",
]

model_ctor = re.compile(
    r"\$config = require __DIR__ \. '/\.\./config/database\.php';\s*"
    r"\$dsn = \"mysql:host=\{\$config\['host'\]\};port=\{\$config\['port'\]\};dbname=\{\$config\['database'\]\};charset=\{\$config\['charset'\]\}\";\s*"
    r"\$this->conn = new PDO\(\s*"
    r"\$dsn,\s*"
    r"\$config\['username'\],\s*"
    r"\$config\['password'\],\s*"
    r"\[\s*"
    r"PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,\s*"
    r"PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,\s*"
    r"\]\s*"
    r"\);",
    re.S,
)

for path in model_files:
    text = path.read_text(encoding="utf-8")
    orig = text
    text = text.replace(
        "require_once __DIR__ . '/../config/database.php';",
        "require_once __DIR__ . '/../config/connection.php';",
    )
    text = model_ctor.sub("$this->conn = entrivo_pdo();", text)
    if text != orig:
        path.write_text(text, encoding="utf-8")
        print("updated", path)
    else:
        print("NO CHANGE", path)

# Thin API endpoints: ensure connection.php is required so PHP TZ is set
# (models already open PDO with Manila)
thin_apis = list((root / "api" / "fingerprint").glob("*.php")) + list((root / "api" / "sensorB").glob("*.php"))
for path in thin_apis:
    if path.name == "fingerprint_dashboard.php":
        continue
    text = path.read_text(encoding="utf-8")
    orig = text
    if "config/connection.php" in text:
        continue
    # Replace date_default_timezone_set line with connection require
    if "date_default_timezone_set('Asia/Manila');" in text:
        depth = "dirname(__DIR__, 2)" if path.parent.name in {"fingerprint", "sensorB"} else "dirname(__DIR__)"
        text = text.replace(
            "date_default_timezone_set('Asia/Manila');",
            f"require_once {depth} . '/config/connection.php';",
            1,
        )
    if text != orig:
        path.write_text(text, encoding="utf-8")
        print("updated thin", path)

print("done")

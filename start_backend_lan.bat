@echo off
setlocal

cd /d "%~dp0"

echo Starting Entrivo backend on http://0.0.0.0:8000
echo LAN access should be available at http://192.168.1.9:8000
echo Press Ctrl+C to stop the server.
echo.

set "PHP_EXE=C:\php\php.exe"

if not exist "%PHP_EXE%" (
  echo PHP was not found at "%PHP_EXE%".
  echo Please update PHP_EXE in this file.
  pause
  exit /b 1
)

"%PHP_EXE%" -S 0.0.0.0:8000 -t backend

endlocal

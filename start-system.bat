@echo off
setlocal

set "PROJECT_DIR=%~dp0"
set "PHP_EXE=C:\php\php.exe"
set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"
set "START_URL=http://127.0.0.1:5173/"

if not exist "%PHP_EXE%" (
  echo PHP was not found at "%PHP_EXE%".
  echo Please update PHP_EXE in this file.
  pause
  exit /b 1
)

if not exist "%NPM_CMD%" (
  echo npm was not found at "%NPM_CMD%".
  echo Please install Node.js or update NPM_CMD in this file.
  pause
  exit /b 1
)

if not exist "%PROJECT_DIR%frontend\node_modules" (
  echo Installing frontend dependencies...
  pushd "%PROJECT_DIR%frontend"
  call "%NPM_CMD%" install
  popd
)

echo Starting Entrivo Door Lock System...
echo Backend API: http://127.0.0.1:8000
echo Frontend:    %START_URL%
echo.
echo Keep the two server windows open while using the system.
echo.

start "Entrivo Backend API" cmd /k "cd /d "%PROJECT_DIR%" && "%PHP_EXE%" -S 127.0.0.1:8000 -t backend"
start "Entrivo Frontend Vite" cmd /k "cd /d "%PROJECT_DIR%frontend" && "%NPM_CMD%" run dev"

ping 127.0.0.1 -n 4 >nul
start "" "%START_URL%"

endlocal

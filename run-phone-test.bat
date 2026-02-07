@echo off
title Phone Test - Route 1 (ADB CDP)

cd /d "%~dp0"

echo.
echo ============================================================
echo   Phone Test - Route 1: ADB CDP
echo ============================================================
echo.

echo [ADB] checking devices...
adb devices
echo.

set CDP_PORT=9222
echo [ADB] port forwarding tcp:%CDP_PORT%...
adb forward tcp:%CDP_PORT% localabstract:chrome_devtools_remote
if errorlevel 1 (
    echo [ERROR] ADB port forward failed. Check device connection.
    pause
    exit /b 1
)
echo   OK: localhost:%CDP_PORT%
echo.

echo [PHONE] checking Chrome...
adb shell am start -n com.android.chrome/com.google.android.apps.chrome.Main
timeout /t 3 /nobreak >nul
echo.

if not exist "node_modules" (
    echo [SETUP] npm install...
    call npm install
)

echo [RUN] route1-phone.ts (port=%CDP_PORT%)...
echo.
call npx tsx shoppingtab/phone/route1-phone.ts --port=%CDP_PORT%

echo.
echo [DONE]
pause

@echo off
chcp 65001 >nul
title Phone Test - Route 1 (ADB CDP)

cd /d "%~dp0"

echo.
echo ============================================================
echo   Phone Test - Route 1: ADB CDP 연결
echo ============================================================
echo.

:: ADB 연결 확인
echo [ADB] 연결된 디바이스 확인...
adb devices
echo.

:: 포트 포워딩 설정
set CDP_PORT=9222
echo [ADB] Chrome DevTools 포트 포워딩 (tcp:%CDP_PORT%)...
adb forward tcp:%CDP_PORT% localabstract:chrome_devtools_remote
if errorlevel 1 (
    echo [오류] ADB 포트 포워딩 실패. 디바이스 연결을 확인하세요.
    echo   - USB 디버깅이 활성화되어 있는지 확인
    echo   - adb devices에 디바이스가 표시되는지 확인
    pause
    exit /b 1
)
echo   포트 포워딩 완료: localhost:%CDP_PORT%
echo.

:: Chrome이 폰에서 실행 중인지 확인
echo [폰] Chrome 실행 확인...
adb shell "dumpsys activity activities | findstr chrome" >nul 2>&1
if errorlevel 1 (
    echo [폰] Chrome을 실행합니다...
    adb shell am start -n com.android.chrome/com.google.android.apps.chrome.Main
    timeout /t 3 /nobreak >nul
) else (
    echo   Chrome이 이미 실행 중입니다.
)
echo.

:: node_modules 확인
if not exist "node_modules" (
    echo [설치] npm install...
    call npm install
)

:: 스크립트 실행
echo [시작] route1-phone.ts 실행 (port=%CDP_PORT%)...
echo.
call npx tsx shoppingtab/route1-phone.ts --port=%CDP_PORT%

echo.
echo [완료] 스크립트가 종료되었습니다.
pause

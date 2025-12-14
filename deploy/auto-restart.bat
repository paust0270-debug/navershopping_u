@echo off
chcp 65001 >nul
title Turafic Auto-Restart

cd /d D:\turafic

echo ============================================================
echo   Turafic Auto-Restart (무한 재시작)
echo ============================================================
echo.
echo   Ctrl+C 로 종료
echo.

:loop
echo [%date% %time%] 러너 시작...

:: 최신 코드 Pull
git pull origin main 2>nul

:: 실행
npx tsx scripts/slot-naver-runner.ts

echo.
echo [%date% %time%] 러너 종료됨. 10초 후 재시작...
timeout /t 10 /nobreak >nul

goto loop

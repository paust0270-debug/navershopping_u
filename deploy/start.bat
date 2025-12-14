@echo off
chcp 65001 >nul
title Turafic Slot-Naver Runner

cd /d D:\turafic

echo ============================================================
echo   Turafic Slot-Naver Runner
echo ============================================================
echo.

:: 최신 코드 Pull
echo [업데이트] 최신 코드 확인 중...
git pull origin main 2>nul

:: 실행
echo [시작] 러너 실행 중...
echo.

npx tsx scripts/slot-naver-runner.ts

:: 오류 발생 시 대기
if errorlevel 1 (
    echo.
    echo [오류] 러너가 비정상 종료되었습니다.
    echo        10초 후 재시작합니다...
    timeout /t 10 /nobreak >nul
    goto :0
)

pause

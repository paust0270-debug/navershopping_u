@echo off
chcp 65001 >nul
echo ============================================
echo   쇼핑탭 러너 중지
echo ============================================
echo.

call pm2 stop turafic-shopping-tab

if errorlevel 1 (
    echo [ERROR] PM2 중지 실패
    pause
    exit /b 1
)

echo.
echo [OK] 중지 완료
echo.

call pm2 list

echo.
pause

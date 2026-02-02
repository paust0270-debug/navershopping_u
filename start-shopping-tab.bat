@echo off
chcp 65001 >nul
echo ============================================
echo   쇼핑탭 러너 시작
echo ============================================
echo.

REM 현재 디렉토리 확인
cd /d "%~dp0"
echo 작업 디렉토리: %CD%
echo.

REM .env 파일 확인
if not exist ".env" (
    echo [ERROR] .env 파일이 없습니다!
    echo SETUP-SHOPPING-TAB.md를 참고하여 .env 파일을 생성하세요.
    pause
    exit /b 1
)
echo [OK] .env 파일 확인

REM node_modules 확인
if not exist "node_modules" (
    echo [WARNING] node_modules 없음 - npm install 실행...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install 실패
        pause
        exit /b 1
    )
)
echo [OK] node_modules 확인

REM logs 폴더 생성
if not exist "logs\shopping-tab" (
    echo [INFO] logs\shopping-tab 폴더 생성...
    mkdir "logs\shopping-tab"
)

echo.
echo ============================================
echo   PM2로 시작 중...
echo ============================================
echo.

REM PM2로 시작
call pm2 start ecosystem.config.js --only turafic-shopping-tab

if errorlevel 1 (
    echo.
    echo [ERROR] PM2 시작 실패
    echo PM2가 설치되지 않았다면: npm install -g pm2
    pause
    exit /b 1
)

echo.
echo ============================================
echo   시작 완료!
echo ============================================
echo.
echo 상태 확인:    pm2 list
echo 로그 확인:    pm2 logs turafic-shopping-tab
echo 재시작:       pm2 restart turafic-shopping-tab
echo 중지:         pm2 stop turafic-shopping-tab
echo.

REM 상태 확인
call pm2 list

echo.
pause

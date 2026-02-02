@echo off
chcp 65001 >nul
echo ============================================
echo   환경변수 테스트
echo ============================================
echo.

cd /d "%~dp0"
echo 작업 디렉토리: %CD%
echo.

REM .env 파일 확인
if not exist ".env" (
    echo [ERROR] .env 파일이 없습니다!
    echo 현재 디렉토리: %CD%
    pause
    exit /b 1
)

echo [OK] .env 파일 존재: %CD%\.env
echo.
echo .env 파일 내용 (처음 30줄):
echo ----------------------------------------
type .env | findstr /n "^" | findstr /r "^[1-9]: ^[12][0-9]: ^30:"
echo ----------------------------------------
echo.

echo [INFO] 환경변수 로드 테스트 시작...
echo.

npx tsx unified-runner-shopping-tab.ts

pause

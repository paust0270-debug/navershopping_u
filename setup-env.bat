@echo off
chcp 65001 >nul
echo ========================================
echo  TURAFIC 환경 설정 자동화 스크립트
echo ========================================
echo.

REM 1. .env.example 존재 확인
if not exist ".env.example" (
    echo [오류] .env.example 파일이 없습니다.
    echo 이 파일은 git 저장소에 포함되어 있어야 합니다.
    pause
    exit /b 1
)

REM 2. 기존 .env 백업 (있는 경우)
if exist ".env" (
    echo [알림] 기존 .env 파일을 .env.backup으로 백업합니다.
    copy /Y .env .env.backup >nul
)

REM 3. .env.example을 .env로 복사
echo [1/3] .env.example을 .env로 복사 중...
copy /Y .env.example .env >nul
if errorlevel 1 (
    echo [오류] .env 파일 복사 실패
    pause
    exit /b 1
)
echo      완료!
echo.

REM 4. 장비 이름 입력 받기
echo [2/3] 이 PC의 장비 이름을 입력하세요.
echo      예: 네이버1, 네이버2, 네이버3
echo.
set /p equipment_name="장비 이름 입력: "

REM 5. 입력값 검증
if "%equipment_name%"=="" (
    echo [오류] 장비 이름을 입력하지 않았습니다.
    pause
    exit /b 1
)

if "%equipment_name%"=="CHANGE_ME" (
    echo [경고] CHANGE_ME는 사용할 수 없습니다. 고유한 이름을 입력하세요.
    pause
    exit /b 1
)

REM 6. PowerShell로 EQUIPMENT_NAME 치환
echo [3/3] EQUIPMENT_NAME을 '%equipment_name%'로 설정 중...
powershell -Command "(Get-Content .env) -replace 'EQUIPMENT_NAME=CHANGE_ME', 'EQUIPMENT_NAME=%equipment_name%' | Set-Content .env"
if errorlevel 1 (
    echo [오류] 설정 파일 수정 실패
    pause
    exit /b 1
)
echo      완료!
echo.

REM 7. 완료 메시지
echo ========================================
echo  설정 완료!
echo ========================================
echo.
echo .env 파일이 성공적으로 생성되었습니다.
echo 장비 이름: %equipment_name%
echo.
echo 설정을 확인하시겠습니까? (Y/N)
set /p open_file="입력: "

if /i "%open_file%"=="Y" (
    notepad .env
)

echo.
echo 이제 다음 명령으로 러너를 실행할 수 있습니다:
echo   - npx tsx unified-runner-shopping-tab-app.ts
echo   - npx tsx unified-runner-shopping-tab-test.ts
echo.
pause

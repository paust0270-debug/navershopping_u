@echo off
chcp 65001 >nul
title Turafic Setup

echo ============================================================
echo   Turafic Slot-Naver Runner - 원격 PC 초기 설정
echo ============================================================
echo.

:: 1. Node.js 확인
where node >nul 2>nul
if errorlevel 1 (
    echo [오류] Node.js가 설치되지 않았습니다.
    echo        https://nodejs.org 에서 LTS 버전을 설치하세요.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo [OK] Node.js: %NODE_VER%

:: 2. Git 확인
where git >nul 2>nul
if errorlevel 1 (
    echo [오류] Git이 설치되지 않았습니다.
    echo        https://git-scm.com 에서 설치하세요.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('git --version') do set GIT_VER=%%i
echo [OK] %GIT_VER%

:: 3. 프로젝트 클론
echo.
echo [설치] D:\turafic 폴더에 프로젝트 설치 중...

if exist "D:\turafic" (
    echo [정보] 기존 폴더가 존재합니다. 업데이트합니다.
    cd /d D:\turafic
    git pull origin main
) else (
    cd /d D:\
    git clone https://github.com/mim1012/turafic_update.git turafic
    cd /d D:\turafic
)

:: 4. 의존성 설치
echo.
echo [설치] npm 패키지 설치 중... (2-3분 소요)
call npm install

:: 5. .env 파일 확인
if not exist "D:\turafic\.env" (
    echo.
    echo ============================================================
    echo   [중요] .env 파일을 생성해야 합니다!
    echo ============================================================
    echo.

    copy "D:\turafic\deploy\.env.example" "D:\turafic\.env"

    echo .env 파일이 생성되었습니다.
    echo 메모장에서 열어 Supabase 키를 입력하세요.
    echo.
    notepad "D:\turafic\.env"
)

:: 6. 프로필 폴더 생성
if not exist "D:\turafic\profiles\profile_01" (
    echo.
    echo [설치] 프로필 폴더 생성 중...
    for /L %%i in (1,1,4) do (
        if %%i LSS 10 (
            mkdir "D:\turafic\profiles\profile_0%%i" 2>nul
        ) else (
            mkdir "D:\turafic\profiles\profile_%%i" 2>nul
        )
    )
)

:: 7. temp 폴더 생성
if not exist "D:\temp" mkdir "D:\temp"

echo.
echo ============================================================
echo   설치 완료!
echo ============================================================
echo.
echo   실행 방법:
echo     D:\turafic\start.bat 실행
echo.
echo   또는 명령어:
echo     cd /d D:\turafic
echo     npx tsx scripts/slot-naver-runner.ts
echo.
pause

@echo off
chcp 65001 >nul
title Shopping Tab - Route 1 (검색→쇼핑탭→상품)

cd /d "%~dp0"

:loop
echo.
echo ============================================================
echo   Shopping Tab Route 1: 검색 → 쇼핑탭 → 상품
echo ============================================================
echo.

:: 최신 코드 Pull
echo [업데이트] git pull...
git pull origin main 2>nul
echo.

:: node_modules 확인
if not exist "node_modules" (
    echo [설치] npm install...
    call npm install
)

:: IP 로테이션
echo [IP] 로테이션 중...
call npx tsx -e "import { rotateIP } from './ipRotation'; rotateIP().then(r => console.log(r.success ? 'IP: ' + r.newIP : 'IP 변경 실패 (현재 IP로 진행)'))"
echo.

:: 실행
echo [시작] route1-search-tab.ts 실행...
echo.
call npx tsx shoppingtab/pc/route1-search-tab.ts

:: 오류 발생 시 재시작
echo.
echo [재시작] 10초 후 재시작...
timeout /t 10 /nobreak >nul
goto :loop

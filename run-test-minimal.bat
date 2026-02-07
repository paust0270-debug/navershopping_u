@echo off
chcp 65001 >nul
title Shopping Tab - 차단 원인 분리 진단

cd /d "%~dp0"

echo.
echo ============================================================
echo   msearch.shopping.naver.com 차단 원인 분리 진단
echo   A) 순수 Patchright (데스크톱)
echo   B) 모바일 에뮬레이션 + CDP
echo   C) 데스크톱 자연 네비게이션 (검색→쇼핑탭)
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

:: IP 로테이션 (깨끗한 IP로 테스트)
echo [IP] 로테이션 중...
call npx tsx -e "import { rotateIP } from './ipRotation'; rotateIP().then(r => console.log(r.success ? 'IP: ' + r.newIP : 'IP 변경 실패 (현재 IP로 진행)'))"
echo.

:: 실행
echo [시작] test-minimal.ts 실행...
echo.
call npx tsx shoppingtab/test-minimal.ts

echo.
echo 완료. 아무 키나 누르세요...
pause >nul

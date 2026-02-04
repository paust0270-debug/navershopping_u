@echo off
taskkill /F /IM node.exe /FI "WINDOWTITLE eq Shopping Tab Runner (Test)*"
echo Stopped shopping-tab-test runner
pause

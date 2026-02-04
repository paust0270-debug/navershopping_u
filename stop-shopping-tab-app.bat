@echo off
taskkill /F /IM node.exe /FI "WINDOWTITLE eq Shopping Tab Runner (App)*"
echo Stopped shopping-tab-app runner
pause

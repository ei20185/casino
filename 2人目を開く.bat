@echo off
cd /d "%~dp0"

netstat -ano | findstr ":3000 " | findstr LISTENING >nul
if not %errorlevel%==0 goto notready

echo Opening another player window ...
start "" http://localhost:3000
timeout /t 2 >nul
goto :eof

:notready
echo The app is not running yet.
echo Please double-click the START bat file first.
echo.
pause

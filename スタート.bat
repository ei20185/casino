@echo off
cd /d "%~dp0"
title Online Casino App

netstat -ano | findstr ":3000 " | findstr LISTENING >nul
if %errorlevel%==0 goto already

echo ================================================
echo    Online Casino App  -  starting ...
echo ================================================
echo.
echo A browser opens automatically in a few seconds.
echo Do NOT close this window while playing.
echo Closing this window stops the app.
echo.
start "" cmd /c "timeout /t 8 >nul & start http://localhost:3000"
call npm run dev
echo.
echo Server stopped. You can close this window.
pause
goto :eof

:already
echo App is already running. Opening a browser ...
start "" http://localhost:3000
timeout /t 3 >nul

@echo off
echo アプリ（サーバー）を停止します...
taskkill /F /IM node.exe >nul 2>&1
echo 停止しました。このウィンドウは閉じてOKです。
timeout /t 3 >nul
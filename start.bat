@echo off
title EVO Server Launcher
echo.
echo  ============================================
echo   EVO Server Launcher - Web Interface
echo  ============================================
echo.

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js non trovato. Scaricalo da https://nodejs.org
    pause
    exit /b 1
)

echo [INFO] Verifica dipendenze...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] npm install fallito!
    pause
    exit /b 1
)

echo.
echo [INFO] Avvio server su http://localhost:3000
echo [INFO] Premi Ctrl+C per fermare.
echo.
node src/server.js
pause

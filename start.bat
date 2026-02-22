@echo off
:: QuantumClaw Start Script (Windows)
::
:: Just double-click this file or run: start.bat

echo.
echo  QuantumClaw
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  Node.js not found!
    echo.
    echo  Download it from https://nodejs.org
    echo  Then restart this script.
    pause
    exit /b 1
)

:: Check version
for /f "tokens=1 delims=v." %%a in ('node -v') do set NODE_MAJOR=%%a
echo  Node.js found

:: Install deps if needed
if not exist "node_modules" (
    echo  Installing dependencies...
    call npm install
)

:: Check if onboarded
if not exist "%USERPROFILE%\.quantumclaw\config.json" (
    echo.
    echo  First time? Running setup wizard...
    echo.
    node src\cli\onboard.js
) else (
    node src\index.js
)

pause

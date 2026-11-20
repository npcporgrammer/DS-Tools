@echo off
rem Add this app's folder to Windows Defender exclusions.
rem Must run as administrator - this file will request elevation itself.
chcp 65001 >nul
cd /d "%~dp0"

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting administrator rights...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0添加信任.ps1"
echo.
pause

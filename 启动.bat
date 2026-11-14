@echo off
rem Discrete Math Homework Board - launcher
rem Keep this file ASCII-only so cmd.exe never misparses it.
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
set "DMATH_BOOTSTRAPPED=1"

if not exist "dist" (
  echo [1/2] dist not found, building...
  powershell -ExecutionPolicy Bypass -File "build.ps1"
  if errorlevel 1 (
    echo Build failed. Run build.ps1 manually to see the error.
    pause
    exit /b 1
  )
)

for %%f in ("dist\*.exe") do (
  start "" "%%~ff" --no-sandbox --disable-features=RendererCodeIntegrity
)

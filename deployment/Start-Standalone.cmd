@echo off
powershell.exe -NoProfile -File "%~dp0setup-standalone.ps1"
if errorlevel 1 (
  echo Setup failed. Read the error above. Do not disable organization security policies.
)
pause

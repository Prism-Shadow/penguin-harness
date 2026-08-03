@echo off
setlocal

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -ArchivePath "%~dp0payload.zip"
set "INSTALL_EXIT_CODE=%ERRORLEVEL%"

echo.
if "%INSTALL_EXIT_CODE%"=="0" (
  echo PenguinHarness offline installation completed.
) else (
  echo PenguinHarness offline installation failed.
)

echo.
pause
exit /b %INSTALL_EXIT_CODE%

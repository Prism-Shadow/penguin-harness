@echo off
rem penguin CLI launcher, installed as bin\penguin.cmd inside the program directory.
rem Runs the CLI on the Node runtime bundled at node\ when this package carries one,
rem otherwise on system Node (>= 24). The web assets sit beside it at web\.
rem
rem There is deliberately no penguin.ps1 sibling: PowerShell prefers .ps1 over .cmd on
rem PATH, and client Windows defaults to the Restricted execution policy, which would
rem then break the plain `penguin` command. Batch files are exempt from that policy.
setlocal
set "DIR=%~dp0.."
if not defined PENGUIN_WEB_DIST set "PENGUIN_WEB_DIST=%DIR%\web"
if exist "%DIR%\git\usr\bin\sh.exe" set "PENGUIN_BUNDLED_SHELL=%DIR%\git\usr\bin\sh.exe"
if exist "%DIR%\node\node.exe" (
  "%DIR%\node\node.exe" "%DIR%\lib\dist\penguin.js" %*
) else (
  node "%DIR%\lib\dist\penguin.js" %*
)
exit /b %ERRORLEVEL%

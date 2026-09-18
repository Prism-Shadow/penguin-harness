# Installs WSL for the PenguinHarness WSL sandbox. Runs ELEVATED, once: the harness raises the
# Windows consent prompt for this script, or a person runs it from an administrator PowerShell.
#
#   powershell -ExecutionPolicy Bypass -File install-wsl.ps1 -Log C:\path\install.log
#
# It installs the WSL package and the Windows features it needs, without a Linux distribution
# (the harness imports its own). The output goes to <Log>.out as wsl.exe writes it, so the
# harness can show its progress; the last line of <Log> is "PENGUIN-EXIT <code>".
param([Parameter(Mandatory = $true)][string]$Log)
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Log) | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue "$Log.out", "$Log.err"
"started $(Get-Date -Format o) as $([Security.Principal.WindowsIdentity]::GetCurrent().Name)" | Out-File -Encoding utf8 $Log
$env:WSL_UTF8 = '1'
$wsl = Join-Path $env:SystemRoot 'System32\wsl.exe'
try {
  $p = Start-Process -FilePath $wsl -ArgumentList '--install', '--no-distribution' -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput "$Log.out" -RedirectStandardError "$Log.err"
  $code = $p.ExitCode
} catch {
  "failed to start wsl.exe: $($_.Exception.Message)" | Out-File -Append -Encoding utf8 $Log
  $code = -1
}
"PENGUIN-EXIT $code" | Out-File -Append -Encoding utf8 $Log

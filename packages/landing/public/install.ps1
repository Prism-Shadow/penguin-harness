# https://penguin.ooo/install.ps1 - PenguinHarness installer entry point for Windows.
#
# GitHub Pages cannot serve HTTP redirects, so this thin forwarder IS the
# stable install URL: it fetches the real installer attached to the latest
# GitHub release and runs it, forwarding every argument it was given. Usage:
#
#   irm https://penguin.ooo/install.ps1 | iex
#   & ([scriptblock]::Create((irm https://penguin.ooo/install.ps1))) -Version v0.2.0
#
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {
  # .NET builds where the enum is immutable already default to TLS 1.2+.
}
# Download fully first, then run: executing a piped stream directly would run a
# truncated download line by line, and the real installer moves the old
# bin/lib/web/node aside before moving the new ones in - a cut connection
# mid-way must never leave a half-executed installer. The installer runs as an
# in-memory script block (not a script file): script files are subject to the
# execution policy, which is Restricted by default on client Windows - while the
# user has already consented to remote code by piping this forwarder into iex.
# Neither this forwarder nor the installer calls `exit`, which in iex/script-block
# context would terminate the user's whole PowerShell session.
$Tmp = Join-Path ([IO.Path]::GetTempPath()) "penguin-install-$PID.ps1"
try {
  Invoke-WebRequest -Uri "https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.ps1" -OutFile $Tmp -UseBasicParsing
  $Installer = [scriptblock]::Create((Get-Content -Path $Tmp -Raw))
  & $Installer @args
} finally {
  Remove-Item -Force $Tmp -ErrorAction SilentlyContinue
}

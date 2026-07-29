# PenguinHarness one-line installer for Windows.
#
#   irm https://penguin.ooo/install.ps1 | iex
#
# Options:
#   $env:PENGUIN_VERSION = "vX.Y.Z"     pin a version (same as -Version vX.Y.Z); default is the latest Release
#   $env:PENGUIN_INSTALL_DIR = "<dir>"  install dir; default $env:USERPROFILE\.penguin
#
# There is no -Universal on Windows: where the zip is unsuitable, install Node.js >= 24 and run
# `npm install -g @prismshadow/penguin-cli` instead.
#
# The data dir (%USERPROFILE%\.penguin\data) sits under the install home but is never touched by
# reinstall/upgrade (which only replace bin/lib/web/node/git). Upgrading = re-running this installer.
#
# Docs: https://penguin.ooo/docs/installation
param(
  [string]$Version = "",
  [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue" # Invoke-WebRequest progress rendering slows downloads massively on PS 5.1

$Repo = "https://github.com/Prism-Shadow/penguin-harness"
$Asset = "penguin-win32-x64.zip"

function Fail([string]$Message) {
  # `throw` rather than `exit`: the penguin.ooo forwarder runs this installer as an in-memory
  # script block (see packages/landing/public/install.ps1), where `exit` would terminate the
  # user's whole PowerShell session. `throw` aborts cleanly in both file and script-block runs.
  throw "error: $Message"
}

# --- Resolve options (parameters win over env vars, mirroring install.sh's --version) ---
if (-not $Version) { $Version = if ($env:PENGUIN_VERSION) { $env:PENGUIN_VERSION } else { "" } }
if (-not $InstallDir) {
  $InstallDir = if ($env:PENGUIN_INSTALL_DIR) { $env:PENGUIN_INSTALL_DIR } else { Join-Path $env:USERPROFILE ".penguin" }
}

# --- Platform preconditions: 64-bit Windows; the only Windows package is x64 (ARM64 runs it emulated) ---
if (-not [Environment]::Is64BitOperatingSystem) {
  Fail "32-bit Windows is not supported. Install Node.js >= 24 and use: npm install -g @prismshadow/penguin-cli"
}
if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
  Write-Host "note: no native ARM64 package yet; installing the x64 package (runs via emulation)."
}

# PowerShell 5.1 defaults to TLS 1.0 on older systems; GitHub requires TLS 1.2+.
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {
  # .NET builds where the enum is immutable already default to TLS 1.2+.
}

# --- Download (latest Release by default; PENGUIN_VERSION pins a version) ---
if ($Version) {
  $BaseUrl = "$Repo/releases/download/$Version"
} else {
  $BaseUrl = "$Repo/releases/latest/download"
}
$Tmp = Join-Path ([IO.Path]::GetTempPath()) "penguin-install-$PID"
if (Test-Path $Tmp) { Remove-Item -Recurse -Force $Tmp }
New-Item -ItemType Directory -Path $Tmp | Out-Null
# Pre-declare so the finally block can read them even when an early failure skipped the
# assignments (the user's session may run this under Set-StrictMode via the forwarder).
$Staging = $null
$OldDir = $null

try {
  Write-Host "Downloading $BaseUrl/$Asset ..."
  $ZipPath = Join-Path $Tmp $Asset
  try {
    Invoke-WebRequest -Uri "$BaseUrl/$Asset" -OutFile $ZipPath -UseBasicParsing
  } catch {
    Fail "download failed. Check the version tag and your network, then retry. ($($_.Exception.Message))"
  }

  # --- SHA256 verify: only when the .sha256 asset exists (skip on 404) ---
  $ShaPath = Join-Path $Tmp "$Asset.sha256"
  $HaveSha = $true
  try {
    Invoke-WebRequest -Uri "$BaseUrl/$Asset.sha256" -OutFile $ShaPath -UseBasicParsing
  } catch {
    $HaveSha = $false
    Write-Host "warning: checksum file not available; skipping verification."
  }
  if ($HaveSha) {
    # The .sha256 file is `<hex>  <filename>` (sha256sum format); the first token is the hash.
    $Expected = ((Get-Content $ShaPath -Raw).Trim() -split "\s+")[0]
    $Actual = (Get-FileHash -Algorithm SHA256 $ZipPath).Hash
    if ($Expected -and ($Actual -ieq $Expected)) {
      Write-Host "Checksum OK."
    } else {
      Fail "checksum mismatch for $Asset."
    }
  }

  # --- Extract and swap into place: expand into a staging dir under the install dir (same volume,
  #    so the swap below is cheap renames), then rename-then-delete: move the old dirs aside first
  #    (a locked file fails fast here, before anything is deleted), move the new ones in, then
  #    drop the old. The data dir (%USERPROFILE%\.penguin\data) is untouched. ---
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  $Staging = Join-Path $InstallDir ".staging.$PID"
  $OldDir = Join-Path $InstallDir ".old.$PID"
  if (Test-Path $Staging) { Remove-Item -Recurse -Force $Staging }
  if (Test-Path $OldDir) { Remove-Item -Recurse -Force $OldDir }
  New-Item -ItemType Directory -Path $Staging | Out-Null

  Write-Host "Extracting ..."
  Expand-Archive -Path $ZipPath -DestinationPath $Staging -Force
  $NewRoot = Join-Path $Staging "penguin"
  if (-not (Test-Path $NewRoot)) { Fail "unexpected archive layout: top-level penguin\ missing." }
  if (-not (Test-Path (Join-Path $NewRoot "bin"))) { Fail "unexpected archive layout: penguin\bin missing." }

  $Dirs = @("bin", "lib", "web", "node", "git")
  $Moved = @()
  New-Item -ItemType Directory -Path $OldDir | Out-Null
  try {
    foreach ($d in $Dirs) {
      $Existing = Join-Path $InstallDir $d
      if (Test-Path $Existing) {
        Move-Item -Path $Existing -Destination (Join-Path $OldDir $d)
        $Moved += $d
      }
    }
  } catch {
    # Roll the already-moved dirs back so a locked install stays intact and usable.
    foreach ($d in $Moved) {
      Move-Item -Path (Join-Path $OldDir $d) -Destination (Join-Path $InstallDir $d) -ErrorAction SilentlyContinue
    }
    Fail "files in $InstallDir are locked: close running penguin processes (and any node.exe they started), then retry. ($($_.Exception.Message))"
  }
  foreach ($d in $Dirs) {
    $Src = Join-Path $NewRoot $d
    if (Test-Path $Src) {
      Move-Item -Path $Src -Destination (Join-Path $InstallDir $d)
    }
  }
  Remove-Item -Recurse -Force $OldDir -ErrorAction SilentlyContinue
  if (Test-Path $OldDir) {
    Write-Host "warning: could not fully remove $OldDir (files in use); delete it after closing running penguin processes."
  }
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
  if ($Staging -and (Test-Path $Staging)) { Remove-Item -Recurse -Force $Staging -ErrorAction SilentlyContinue }
}

# --- Launcher shims: shipped in the zip; (re)generate only when missing ---
$CmdShim = Join-Path $InstallDir "bin\penguin.cmd"
if (-not (Test-Path $CmdShim)) {
  @(
    '@echo off'
    'setlocal'
    'set "DIR=%~dp0.."'
    'if not defined PENGUIN_WEB_DIST set "PENGUIN_WEB_DIST=%DIR%\web"'
    'if exist "%DIR%\git\usr\bin\sh.exe" set "PENGUIN_BUNDLED_SHELL=%DIR%\git\usr\bin\sh.exe"'
    'if exist "%DIR%\node\node.exe" ('
    '  "%DIR%\node\node.exe" "%DIR%\lib\dist\index.js" %*'
    ') else ('
    '  node "%DIR%\lib\dist\index.js" %*'
    ')'
    'exit /b %ERRORLEVEL%'
  ) | Set-Content -Path $CmdShim -Encoding ascii
}
$Ps1Shim = Join-Path $InstallDir "bin\penguin.ps1"
if (-not (Test-Path $Ps1Shim)) {
  @(
    '$dir = Split-Path -Parent $PSScriptRoot'
    'if (-not $env:PENGUIN_WEB_DIST) { $env:PENGUIN_WEB_DIST = Join-Path $dir "web" }'
    '$sh = Join-Path $dir "git\usr\bin\sh.exe"'
    'if (Test-Path $sh) { $env:PENGUIN_BUNDLED_SHELL = $sh }'
    '$node = Join-Path $dir "node\node.exe"'
    'if (-not (Test-Path $node)) { $node = "node" }'
    '& $node (Join-Path $dir "lib\dist\index.js") @args'
    'exit $LASTEXITCODE'
  ) | Set-Content -Path $Ps1Shim -Encoding ascii
}
if (-not (Test-Path $CmdShim)) { Fail "install incomplete: $CmdShim missing." }

# --- User PATH: append <install>\bin once; new terminals pick it up.
#     Go through the registry, not [Environment]::*EnvironmentVariable: GetEnvironmentVariable
#     expands REG_EXPAND_SZ and SetEnvironmentVariable writes back REG_SZ, which would
#     irreversibly hard-code a user's %USERPROFILE%-style Path entries. Read the raw
#     (unexpanded) value, append to it, and write it back with its original value kind.
#     The registry only exists on Windows; skip the block elsewhere (functional test runs
#     of this script on pwsh/Linux — where the old API was a silent no-op anyway). ---
$BinDir = Join-Path $InstallDir "bin"
if ($env:OS -eq "Windows_NT") {
  $EnvKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)
  if ($null -eq $EnvKey) { $EnvKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Environment") }
  try {
    # Missing Path value: create it as REG_EXPAND_SZ (the kind Windows itself uses for Path).
    $Kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
    try { $Kind = $EnvKey.GetValueKind("Path") } catch {}
    $RawPath = [string]$EnvKey.GetValue("Path", "", [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    # Membership is checked per entry after expansion, so both literal and %VAR%-style
    # spellings of the bin dir count as already present; the append itself stays raw.
    $OnPath = @($RawPath -split ";" | Where-Object { $_ } | ForEach-Object {
      [Environment]::ExpandEnvironmentVariables($_).TrimEnd("\")
    }) -contains $BinDir.TrimEnd("\")
    if (-not $OnPath) {
      $NewPath = if ($RawPath -and -not $RawPath.EndsWith(";")) { "$RawPath;$BinDir" } else { "$RawPath$BinDir" }
      $EnvKey.SetValue("Path", $NewPath, $Kind)
      Write-Host ""
      Write-Host "note: appended $BinDir to your user Path. Restart your terminal so 'penguin' is found."
    }
  } finally {
    $EnvKey.Close()
  }
}
# Make `penguin` work in this session too.
if (($env:Path -split ";") -notcontains $BinDir) { $env:Path = "$env:Path;$BinDir" }

# --- Finish: print version and getting-started tips ---
$InstalledVersion = "unknown"
try { $InstalledVersion = (& $CmdShim --version 2>$null | Select-Object -First 1) } catch {}
Write-Host ""
Write-Host "PenguinHarness $InstalledVersion installed to $InstallDir"
Write-Host ""
Write-Host "Get started:"
Write-Host "  penguin --help    # all commands"
Write-Host "  penguin web       # start the Web UI at http://127.0.0.1:7364 (initial login: admin / penguin-2026)"
Write-Host "  penguin server    # headless server (PORT / HOST to override)"

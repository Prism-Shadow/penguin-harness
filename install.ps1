# PenguinHarness one-line installer for Windows.
#
#   irm https://penguin.ooo/install.ps1 | iex
#
# Options:
#   $env:PENGUIN_VERSION = "vX.Y.Z"     pin a version (same as -Version vX.Y.Z); default is the latest Release
#   $env:PENGUIN_INSTALL_DIR = "<dir>"  install dir; default $env:USERPROFILE\.penguin
#   $env:PENGUIN_ARCHIVE = "<file>"     install a local Release zip without network access (same as -ArchivePath)
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
  [string]$InstallDir = "",
  [string]$ArchivePath = ""
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

function Restore-PreviousInstall(
  [string]$InstallDir,
  [string]$OldDir,
  [string[]]$MovedOld,
  [string[]]$MovedNew
) {
  foreach ($d in @($MovedNew)) {
    if (-not $d) { continue }
    $Current = Join-Path $InstallDir $d
    if (Test-Path -LiteralPath $Current) {
      Remove-Item -LiteralPath $Current -Recurse -Force -ErrorAction Stop
    }
  }
  foreach ($d in @($MovedOld)) {
    if (-not $d) { continue }
    $Previous = Join-Path $OldDir $d
    if (Test-Path -LiteralPath $Previous) {
      Move-Item -LiteralPath $Previous -Destination (Join-Path $InstallDir $d) -ErrorAction Stop
    }
  }
}

# --- Resolve options (parameters win over env vars, mirroring install.sh's --version) ---
if (-not $Version) { $Version = if ($env:PENGUIN_VERSION) { $env:PENGUIN_VERSION } else { "" } }
if (-not $InstallDir) {
  $InstallDir = if ($env:PENGUIN_INSTALL_DIR) { $env:PENGUIN_INSTALL_DIR } else { Join-Path $env:USERPROFILE ".penguin" }
}
if (-not $ArchivePath) {
  $ArchivePath = if ($env:PENGUIN_ARCHIVE) { $env:PENGUIN_ARCHIVE } else { "" }
}
# An extracted offline bundle keeps this script, the Windows zip and its checksum together.
# `$PSScriptRoot` is empty for the documented `irm ... | iex` path, so online installs do not
# accidentally pick up an unrelated archive from the caller's current directory.
if (-not $ArchivePath -and $PSScriptRoot) {
  $SiblingArchive = Join-Path $PSScriptRoot $Asset
  if (Test-Path -LiteralPath $SiblingArchive -PathType Leaf) { $ArchivePath = $SiblingArchive }
}
if ($ArchivePath -and $Version) {
  Fail "-ArchivePath/PENGUIN_ARCHIVE cannot be combined with -Version/PENGUIN_VERSION"
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
  $UsingLocalArchive = [bool]$ArchivePath
  if ($UsingLocalArchive) {
    try {
      $ZipPath = (Resolve-Path -LiteralPath $ArchivePath -ErrorAction Stop).Path
    } catch {
      Fail "local archive not found: $ArchivePath"
    }
    $ArchiveName = [IO.Path]::GetFileName($ZipPath)
    Write-Host "Using local archive $ZipPath ..."
  } else {
    Write-Host "Downloading $BaseUrl/$Asset ..."
    $ZipPath = Join-Path $Tmp $Asset
    try {
      Invoke-WebRequest -Uri "$BaseUrl/$Asset" -OutFile $ZipPath -UseBasicParsing
    } catch {
      Fail "download failed. Check the version tag and your network, then retry. ($($_.Exception.Message))"
    }
    $ArchiveName = $Asset
  }

  # --- SHA256 verify: mandatory offline; online keeps the existing warn-and-skip fallback. ---
  $HaveSha = $true
  if ($UsingLocalArchive) {
    $ShaPath = "$ZipPath.sha256"
    if (-not (Test-Path -LiteralPath $ShaPath -PathType Leaf) -and
        $ArchiveName -ine $Asset) {
      $CanonicalShaPath = Join-Path ([IO.Path]::GetDirectoryName($ZipPath)) "$Asset.sha256"
      if (Test-Path -LiteralPath $CanonicalShaPath -PathType Leaf) {
        $ShaPath = $CanonicalShaPath
      }
    }
    if (-not (Test-Path -LiteralPath $ShaPath -PathType Leaf)) {
      Fail "offline checksum file not found: $ShaPath"
    }
  } else {
    $ShaPath = Join-Path $Tmp "$Asset.sha256"
    try {
      Invoke-WebRequest -Uri "$BaseUrl/$Asset.sha256" -OutFile $ShaPath -UseBasicParsing
    } catch {
      $HaveSha = $false
      Write-Host "warning: checksum file not available; skipping verification."
    }
  }
  if ($HaveSha) {
    # The .sha256 file is `<hex>  <filename>` (sha256sum format); the first token is the hash.
    $Expected = ((Get-Content -LiteralPath $ShaPath -Raw).Trim() -split "\s+")[0]
    $Actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $ZipPath).Hash
    if ($Expected -and ($Actual -ieq $Expected)) {
      Write-Host "Checksum OK."
    } else {
      Fail "checksum mismatch for $Asset."
    }
  }

  # --- Extract into staging, then swap by same-volume renames. Keep the previous dirs in .old.$PID
  #    until the installed command runs successfully; any move or launch failure restores them.
  #    The data dir (%USERPROFILE%\.penguin\data) is never part of the swap. ---
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  $Staging = Join-Path $InstallDir ".staging.$PID"
  $OldDir = Join-Path $InstallDir ".old.$PID"
  if (Test-Path $Staging) { Remove-Item -Recurse -Force $Staging }
  if (Test-Path $OldDir) { Remove-Item -Recurse -Force $OldDir }
  New-Item -ItemType Directory -Path $Staging | Out-Null

  Write-Host "Extracting ..."
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $Staging -Force
  $NewRoot = Join-Path $Staging "penguin"
  if (-not (Test-Path $NewRoot)) { Fail "unexpected archive layout: top-level penguin\ missing." }
  if (-not (Test-Path (Join-Path $NewRoot "bin"))) { Fail "unexpected archive layout: penguin\bin missing." }
  $ManifestPath = Join-Path $NewRoot "package-manifest.json"
  if (Test-Path -LiteralPath $ManifestPath -PathType Leaf) {
    try {
      $PackageManifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
    } catch {
      Fail "package manifest is malformed: $($_.Exception.Message)"
    }
    $TargetProperty = $PackageManifest.PSObject.Properties["target"]
    if ($null -eq $TargetProperty -or -not $TargetProperty.Value) {
      Fail "package manifest is malformed: target missing."
    }
    if ([string]$TargetProperty.Value -ine "win32-x64") {
      Fail "package target mismatch: expected win32-x64, found $($TargetProperty.Value)."
    }
  } elseif ($UsingLocalArchive -and $ArchiveName -ine $Asset) {
    Fail "a renamed local archive must contain package-manifest.json; use the original filename for legacy packages."
  }

  $Dirs = @("bin", "lib", "web", "node", "git")
  $MovedOld = @()
  $MovedNew = @()
  New-Item -ItemType Directory -Path $OldDir | Out-Null
  try {
    foreach ($d in $Dirs) {
      $Existing = Join-Path $InstallDir $d
      if (Test-Path -LiteralPath $Existing) {
        Move-Item -LiteralPath $Existing -Destination (Join-Path $OldDir $d)
        $MovedOld += $d
      }
    }
    foreach ($d in $Dirs) {
      $Src = Join-Path $NewRoot $d
      if (Test-Path -LiteralPath $Src) {
        Move-Item -LiteralPath $Src -Destination (Join-Path $InstallDir $d)
        $MovedNew += $d
      }
    }

    # --- Launcher shims: shipped in the zip; (re)generate only when missing. ---
    $CmdShim = Join-Path $InstallDir "bin\penguin.cmd"
    if (-not (Test-Path -LiteralPath $CmdShim)) {
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
      ) | Set-Content -LiteralPath $CmdShim -Encoding ascii
    }
    $Ps1Shim = Join-Path $InstallDir "bin\penguin.ps1"
    if (-not (Test-Path -LiteralPath $Ps1Shim)) {
      @(
        '$dir = Split-Path -Parent $PSScriptRoot'
        'if (-not $env:PENGUIN_WEB_DIST) { $env:PENGUIN_WEB_DIST = Join-Path $dir "web" }'
        '$sh = Join-Path $dir "git\usr\bin\sh.exe"'
        'if (Test-Path $sh) { $env:PENGUIN_BUNDLED_SHELL = $sh }'
        '$node = Join-Path $dir "node\node.exe"'
        'if (-not (Test-Path $node)) { $node = "node" }'
        '& $node (Join-Path $dir "lib\dist\index.js") @args'
        'exit $LASTEXITCODE'
      ) | Set-Content -LiteralPath $Ps1Shim -Encoding ascii
    }
    if (-not (Test-Path -LiteralPath $CmdShim)) { Fail "install incomplete: $CmdShim missing." }

    # Verify from the final path before deleting the backup. Keep stderr visible so platform
    # policy, permission and runtime errors are not disguised as an "unknown" version.
    # Windows PowerShell 5.1 turns native stderr into NativeCommandError records. Temporarily
    # keep those non-terminating so the real stderr stays visible and the exit code remains the
    # authoritative result; restore Stop immediately afterwards for installer operations.
    $PreviousErrorActionPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = "Continue"
      $VersionOutput = @(& $CmdShim --version)
      $VersionExitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $PreviousErrorActionPreference
    }
    if ($VersionExitCode -ne 0) {
      Fail "installed PenguinHarness failed to run (exit code $VersionExitCode). See the error above."
    }
    $InstalledVersion = $VersionOutput | Select-Object -First 1
    if ([string]::IsNullOrWhiteSpace([string]$InstalledVersion)) {
      Fail "installed PenguinHarness returned an empty version."
    }
  } catch {
    $InstallFailure = $_
    try {
      Restore-PreviousInstall -InstallDir $InstallDir -OldDir $OldDir -MovedOld $MovedOld -MovedNew $MovedNew
      Write-Host "Previous PenguinHarness installation restored."
    } catch {
      throw "error: installation failed and automatic rollback was incomplete. Original error: $($InstallFailure.Exception.Message) Rollback error: $($_.Exception.Message) Previous files may remain in $OldDir"
    }
    throw $InstallFailure
  }

  Remove-Item -LiteralPath $OldDir -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $OldDir) {
    Write-Host "warning: could not fully remove $OldDir; delete it after closing running penguin processes."
  }
} finally {
  Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue
  if ($Staging -and (Test-Path -LiteralPath $Staging)) {
    Remove-Item -LiteralPath $Staging -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# --- User PATH: append <install>\bin once only after the installed command is known to work.
#     Go through the registry, not [Environment]::*EnvironmentVariable: GetEnvironmentVariable
#     expands REG_EXPAND_SZ and SetEnvironmentVariable writes back REG_SZ, which would
#     irreversibly hard-code a user's %USERPROFILE%-style Path entries. Read the raw
#     (unexpanded) value, append to it, and write it back with its original value kind.
#     The registry only exists on Windows; skip the block elsewhere (functional test runs
#     of this script on pwsh/Linux — where the old API was a silent no-op anyway). ---
$BinDir = Join-Path $InstallDir "bin"
$PathUpdateMessage = ""
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
      $PathUpdateMessage = "note: installation succeeded and $BinDir was appended to your user Path. Restart your terminal so 'penguin' is found."
    }
  } finally {
    $EnvKey.Close()
  }
}
# Make `penguin` work in this session too.
if (($env:Path -split ";") -notcontains $BinDir) { $env:Path = "$env:Path;$BinDir" }

Write-Host ""
Write-Host "PenguinHarness $InstalledVersion installed to $InstallDir"
if ($PathUpdateMessage) {
  Write-Host ""
  Write-Host $PathUpdateMessage
}
Write-Host ""
Write-Host "Get started:"
Write-Host "  penguin --help    # all commands"
Write-Host "  penguin web       # start the Web UI at http://127.0.0.1:7364 (initial login: admin / penguin-2026)"
Write-Host "  penguin server    # headless server (PORT / HOST to override)"

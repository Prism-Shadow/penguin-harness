# PenguinHarness one-line installer for Windows.
#
#   irm https://penguin.ooo/install.ps1 | iex
#
# Options:
#   $env:PENGUIN_VERSION = "vX.Y.Z"     choose a version (same as -Version vX.Y.Z); a published Release
#                                         installer defaults to its own version, an unstamped source copy to latest
#   $env:PENGUIN_INSTALL_DIR = "<dir>"  install dir; default $env:LOCALAPPDATA\penguin
#   $env:PENGUIN_ARCHIVE = "<file>"     install a local Release zip without network access (same as -ArchivePath)
#   $env:PENGUIN_DOWNLOAD_SOURCE = "auto|oss|github" choose the online source; default auto
#                                         (speed-probed, with the same-version other source as fallback)
#   $env:PENGUIN_DOWNLOAD_SPEED_PROBE = "0" disable same-version OSS/GitHub probe timing in auto mode
#   $env:PENGUIN_DOWNLOAD_BASE_URL = "https://..." exact online asset directory selected by the stable forwarder
#   $env:PENGUIN_DOWNLOAD_FALLBACK_BASE_URL = "https://..." fallback for PENGUIN_DOWNLOAD_BASE_URL
#
# Each Release attaches exactly one Windows artifact: penguin-win32-x64.zip, a shallow installer
# bundle holding install.cmd, this script, the program payload (payload.zip) and the payload's
# checksum. Online installs download that bundle and verify it against its published .sha256;
# offline installs transfer the same single file, extract it once (the outer layer is flat, so
# no deep paths are created) and double-click install.cmd. Both paths verify the payload
# checksum sealed inside the bundle, then expand the payload straight into the short staging
# directory. Releases up to v0.1.5 shipped the program tree directly (top-level penguin\);
# such zips are still accepted, from -Version pins and -ArchivePath files alike.
#
# There is no -Universal on Windows: where the zip is unsuitable, install Node.js >= 24 and run
# `npm install -g @prismshadow/penguin-cli` instead.
#
# The program (bin/lib/web/node/git) and the data are separate trees: the program goes to
# %LOCALAPPDATA%\penguin, while the data root stays at %USERPROFILE%\.penguin\data and is never
# touched by install, reinstall or upgrade. Installs up to v0.2.2 put the program under
# %USERPROFILE%\.penguin next to the data; a run of this installer moves that layout over (see the
# one-time cleanup after the swap), and an explicit -InstallDir / PENGUIN_INSTALL_DIR opts out.
# Upgrading = re-running this installer.
#
# Docs: https://penguin.ooo/docs/quickstart-cli
param(
  [string]$Version = "",
  [string]$InstallDir = "",
  [string]$ArchivePath = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue" # Invoke-WebRequest progress rendering slows downloads massively on PS 5.1

$Repo = "https://github.com/Prism-Shadow/penguin-harness"
$OssOrigin = "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com"
$OssReleaseRoot = "$OssOrigin/releases"
$GitHubReleaseRoot = "$Repo/releases/download"
$GitHubLatestBase = "$Repo/releases/latest/download"
$Asset = "penguin-win32-x64.zip"
# Auto-mode source selection, one rule shared by install.ps1, install.sh and the download page on
# penguin.ooo (packages/landing/src/lib/download-source.ts):
#
#   1. Measure GitHub on the release's large probe file. At or above
#      $SpeedProbeGitHubMinBytesPerSecond it wins outright and OSS is never touched.
#   2. Only below that is OSS measured, and it takes over only when it is more than
#      $SpeedProbeOssSwitchRatio of GitHub — a mirror that is merely a little quicker does not
#      justify its bandwidth bill, and a slow GitHub download still resumes.
#
# GitHub is the free source, so every tie and every unmeasurable comparison stays there. The two
# constants are duplicated because these three implementations cannot import from each other — an
# installer is a standalone file fetched over the network. Change them in all three at once, which
# scripts/test-installer.sh pins.
#
# The total budget covers the whole probe: manifest, the small reachability pair, and up to two
# large probes. It is deliberately the sum of their caps, so the second large probe always gets its
# full window rather than being squeezed into declaring a healthy mirror unreachable.
$SpeedProbeManifestTimeoutSeconds = 5
$SpeedProbeSmallTimeoutSeconds = 5
$SpeedProbeLargeTimeoutSeconds = 8
$SpeedProbeTotalTimeoutSeconds = 26
$SpeedProbeGitHubMinBytesPerSecond = 262144
$SpeedProbeOssSwitchRatio = 1.5
$PayloadName = "payload.zip"
# The release workflow replaces this token with the immutable tag before publishing both the
# standalone installer and the copy sealed inside the Windows bundle.
$EmbeddedReleaseVersion = "__PENGUIN_RELEASE_VERSION__"

function Fail([string]$Message) {
  # `throw` rather than `exit`: the penguin.ooo forwarder runs this installer as an in-memory
  # script block (see packages/landing/public/install.ps1), where `exit` would terminate the
  # user's whole PowerShell session. `throw` aborts cleanly in both file and script-block runs.
  throw "error: $Message"
}

# Lists a zip's top-level entry names without extracting (PS 5.1-safe; Expand-Archive itself
# uses the same .NET type). Used to tell an installer bundle (contains payload.zip) from a
# program archive (payload.zip itself, or a pre-0.1.6 release zip with a top-level penguin\).
function Get-ZipEntryNames([string]$ZipPath) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $Zip = [IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    return @($Zip.Entries | ForEach-Object { $_.FullName })
  } finally {
    $Zip.Dispose()
  }
}

# Verifies a file against a sha256sum-format checksum file (`<hex>  <filename>`; the first
# token is the hash). Checksums are never optional: every install path either downloads the
# published .sha256 or reads the one sealed inside the bundle.
function Assert-Sha256([string]$FilePath, [string]$ShaPath, [string]$Label) {
  $Expected = ((Get-Content -LiteralPath $ShaPath -Raw).Trim() -split "\s+")[0]
  if (-not $Expected) { Fail "checksum file is empty or malformed: $ShaPath" }
  $Actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $FilePath).Hash
  if ($Actual -ine $Expected) { Fail "checksum mismatch for $([IO.Path]::GetFileName($FilePath))." }
  Write-Host "$Label checksum OK."
}

function Assert-HttpsUrl([string]$Name, [string]$Value) {
  try { $Uri = [Uri]$Value } catch { Fail "$Name is not a valid URL" }
  if (-not $Uri.IsAbsoluteUri -or $Uri.Scheme -ne "https") {
    Fail "$Name must be an absolute HTTPS URL"
  }
}

function Test-ReleaseTag([string]$Value) {
  return $Value -match '^v[0-9A-Za-z][0-9A-Za-z._-]*$'
}

function Try-DownloadFile([string]$Uri, [string]$OutFile, [int]$TimeoutSec) {
  try {
    Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing -TimeoutSec $TimeoutSec | Out-Null
    return $true
  } catch {
    Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
    return $false
  }
}

function Get-SpeedProbeTimeoutSec([DateTime]$Deadline, [int]$MaxSec) {
  $Remaining = [int][Math]::Ceiling(($Deadline - [DateTime]::UtcNow).TotalSeconds)
  if ($Remaining -le 0) { return 0 }
  return [Math]::Min($MaxSec, $Remaining)
}

function Get-OssLatestTag([string]$ManifestPath) {
  Remove-Item -LiteralPath $ManifestPath -Force -ErrorAction SilentlyContinue
  try {
    Invoke-WebRequest -Uri "$OssOrigin/latest.json" -OutFile $ManifestPath -UseBasicParsing -TimeoutSec 8 | Out-Null
  } catch {
    Remove-Item -LiteralPath $ManifestPath -Force -ErrorAction SilentlyContinue
    return ""
  }
  try {
    $Manifest = [IO.File]::ReadAllText($ManifestPath, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
    $CandidateTag = [string]$Manifest.tag
    $CandidateBase = ([string]$Manifest.releaseBaseUrl).TrimEnd('/')
    if ([int]$Manifest.schemaVersion -eq 1 -and
        (Test-ReleaseTag $CandidateTag) -and
        $CandidateBase -eq "$OssReleaseRoot/$CandidateTag") {
      return $CandidateTag
    }
  } catch {
  }
  return ""
}

function Get-DownloadSourceLabel([string]$BaseUrl) {
  try { $HostName = ([Uri]$BaseUrl).Host } catch { return "configured mirror" }
  if ($HostName -like "*.aliyuncs.com") { return "OSS mirror" }
  if ($HostName -eq "github.com") { return "GitHub" }
  return "configured mirror"
}

function Get-ReleasePair(
  [string]$BaseUrl,
  [string]$ZipPath,
  [string]$ShaPath
) {
  $Label = Get-DownloadSourceLabel $BaseUrl
  Write-Host "Downloading $Asset from $Label ..."
  Remove-Item -LiteralPath $ZipPath, $ShaPath -Force -ErrorAction SilentlyContinue
  try {
    Invoke-WebRequest -Uri "$BaseUrl/$Asset" -OutFile $ZipPath -UseBasicParsing
    Invoke-WebRequest -Uri "$BaseUrl/$Asset.sha256" -OutFile $ShaPath -UseBasicParsing
    return $true
  } catch {
    Remove-Item -LiteralPath $ZipPath, $ShaPath -Force -ErrorAction SilentlyContinue
    return $false
  }
}

function Test-SafeReleaseAssetName([string]$Value) {
  return $Value -match '^[A-Za-z0-9._+-]+$' -and -not $Value.Contains('..')
}

function Read-ReleaseDownloadManifest([string]$Tag, [string]$ManifestPath, [DateTime]$Deadline) {
  Remove-Item -LiteralPath $ManifestPath -Force -ErrorAction SilentlyContinue
  $TimeoutSec = Get-SpeedProbeTimeoutSec $Deadline $SpeedProbeManifestTimeoutSeconds
  if ($TimeoutSec -le 0 -or -not (Try-DownloadFile "$OssReleaseRoot/$Tag/release-download-manifest.tsv" $ManifestPath $TimeoutSec)) {
    $TimeoutSec = Get-SpeedProbeTimeoutSec $Deadline $SpeedProbeManifestTimeoutSeconds
    if ($TimeoutSec -le 0 -or -not (Try-DownloadFile "$GitHubReleaseRoot/$Tag/release-download-manifest.tsv" $ManifestPath $TimeoutSec)) {
      return $null
    }
  }

  $Lines = [IO.File]::ReadAllLines($ManifestPath, [Text.UTF8Encoding]::new($false))
  if ($Lines.Count -lt 4) { return $null }
  if ($Lines[0] -ne "penguin-release-download-manifest`t1`t$Tag") { return $null }

  $SmallProbe = $null
  $LargeProbe = $null
  $AssetSize = 0L
  foreach ($Line in $Lines | Select-Object -Skip 1) {
    if (-not $Line) { return $null }
    $Fields = $Line -split "`t"
    if ($Fields[0] -eq "probe") {
      if ($Fields.Count -ne 5) { return $null }
      $Probe = [PSCustomObject]@{
        Name = [string]$Fields[2]
        Size = 0L
        Sha256 = [string]$Fields[4]
      }
      if (-not (Test-SafeReleaseAssetName $Probe.Name)) { return $null }
      $ProbeSize = 0L
      if (-not [Int64]::TryParse([string]$Fields[3], [ref]$ProbeSize) -or $ProbeSize -le 0) { return $null }
      $Probe.Size = $ProbeSize
      if ($Probe.Sha256 -notmatch '^[0-9a-f]{64}$') { return $null }
      if ($Fields[1] -eq "small") { $SmallProbe = $Probe }
      if ($Fields[1] -eq "large") { $LargeProbe = $Probe }
    } elseif ($Fields[0] -eq "asset" -and $Fields.Count -eq 4 -and $Fields[1] -eq $Asset) {
      # Not part of the decision — an integrity check that this manifest belongs to a release which
      # actually carries this target's bundle, so a mismatched manifest cannot steer the probe.
      if (-not [Int64]::TryParse([string]$Fields[2], [ref]$AssetSize) -or $AssetSize -le 0) { return $null }
    }
  }

  if (-not $SmallProbe -or -not $LargeProbe -or $AssetSize -le 0) { return $null }
  [PSCustomObject]@{
    SmallProbe = $SmallProbe
    LargeProbe = $LargeProbe
    AssetSize = $AssetSize
  }
}

function Invoke-ProbeDownload(
  [string]$BaseUrl,
  [object]$Probe,
  [string]$Tmp,
  [string]$Label,
  [DateTime]$Deadline,
  [int]$MaxTimeoutSec = $SpeedProbeSmallTimeoutSeconds
) {
  $ProbePath = Join-Path $Tmp "probe-$Label-$($Probe.Name)"
  Remove-Item -LiteralPath $ProbePath -Force -ErrorAction SilentlyContinue
  $TimeoutSec = Get-SpeedProbeTimeoutSec $Deadline $MaxTimeoutSec
  if ($TimeoutSec -le 0) {
    return [PSCustomObject]@{ Ok = $false; Seconds = 0.0 }
  }
  $Succeeded = $false
  $Elapsed = Measure-Command {
    $Succeeded = Try-DownloadFile "$BaseUrl/$($Probe.Name)" $ProbePath $TimeoutSec
  }
  if (-not $Succeeded) {
    return [PSCustomObject]@{ Ok = $false; Seconds = 0.0 }
  }
  try {
    $Item = Get-Item -LiteralPath $ProbePath -ErrorAction Stop
    if ($Item.Length -ne $Probe.Size) {
      return [PSCustomObject]@{ Ok = $false; Seconds = 0.0 }
    }
    $ActualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ProbePath).Hash.ToLowerInvariant()
    if ($ActualHash -ne $Probe.Sha256) {
      return [PSCustomObject]@{ Ok = $false; Seconds = 0.0 }
    }
  } catch {
    return [PSCustomObject]@{ Ok = $false; Seconds = 0.0 }
  }
  $Seconds = [Math]::Max($Elapsed.TotalSeconds, 0.001)
  [PSCustomObject]@{ Ok = $true; Seconds = $Seconds }
}

# Throughput a completed probe measured, in bytes per second; 0 when it did not complete, which
# sorts it below any real measurement in the comparison below.
function Get-ProbeBytesPerSecond([object]$Probe, [Int64]$ProbeSize) {
  if (-not $Probe.Ok) { return 0.0 }
  return [double]$ProbeSize / [Math]::Max([double]$Probe.Seconds, 0.001)
}

# The shared rule, in one place: GitHub clears the minimum and wins outright, otherwise the mirror
# has to beat it by the switch ratio to take over.
function Select-SpeedProbeSource([double]$GitHubBytesPerSecond, [double]$OssBytesPerSecond) {
  if ($GitHubBytesPerSecond -ge $SpeedProbeGitHubMinBytesPerSecond) { return "github" }
  if ($OssBytesPerSecond -gt ($GitHubBytesPerSecond * $SpeedProbeOssSwitchRatio)) { return "oss" }
  return "github"
}

function Select-SpeedProbeDownloadSources([string]$Tag, [string]$Tmp) {
  $Deadline = [DateTime]::UtcNow.AddSeconds($SpeedProbeTotalTimeoutSeconds)
  $Manifest = Read-ReleaseDownloadManifest $Tag (Join-Path $Tmp "release-download-manifest.tsv") $Deadline
  if (-not $Manifest) { return $null }

  Write-Host "Testing OSS mirror and GitHub download sources ..."
  $OssBase = "$OssReleaseRoot/$Tag"
  $GitHubBase = "$GitHubReleaseRoot/$Tag"
  $OssSmall = Invoke-ProbeDownload $OssBase $Manifest.SmallProbe $Tmp "oss-small" $Deadline
  $GitHubSmall = Invoke-ProbeDownload $GitHubBase $Manifest.SmallProbe $Tmp "github-small" $Deadline

  if ($GitHubSmall.Ok -and -not $OssSmall.Ok) {
    Write-Host "Selected GitHub (OSS mirror probe unavailable)."
    return [PSCustomObject]@{ BaseUrl = $GitHubBase; FallbackBaseUrl = $OssBase }
  }
  if ($OssSmall.Ok -and -not $GitHubSmall.Ok) {
    Write-Host "Selected OSS mirror (GitHub probe unavailable)."
    return [PSCustomObject]@{ BaseUrl = $OssBase; FallbackBaseUrl = $GitHubBase }
  }
  if (-not $OssSmall.Ok -and -not $GitHubSmall.Ok) { return $null }

  $GitHubLarge = Invoke-ProbeDownload $GitHubBase $Manifest.LargeProbe $Tmp "github-large" $Deadline $SpeedProbeLargeTimeoutSeconds
  $GitHubBytesPerSecond = Get-ProbeBytesPerSecond $GitHubLarge $Manifest.LargeProbe.Size

  # OSS is measured only once GitHub has failed the minimum: above it GitHub has already won, and
  # the mirror's bandwidth is not spent on a probe that could not change the answer. Probing runs
  # one source at a time on purpose — two concurrent transfers share the link and would each read
  # as half as fast, which an absolute threshold cannot tolerate.
  $OssBytesPerSecond = 0.0
  if ($GitHubBytesPerSecond -lt $SpeedProbeGitHubMinBytesPerSecond) {
    $OssLarge = Invoke-ProbeDownload $OssBase $Manifest.LargeProbe $Tmp "oss-large" $Deadline $SpeedProbeLargeTimeoutSeconds
    $OssBytesPerSecond = Get-ProbeBytesPerSecond $OssLarge $Manifest.LargeProbe.Size
  }

  if ((Select-SpeedProbeSource $GitHubBytesPerSecond $OssBytesPerSecond) -eq "github") {
    if ($GitHubBytesPerSecond -ge $SpeedProbeGitHubMinBytesPerSecond) {
      Write-Host "Selected GitHub (meets minimum download speed)."
    } else {
      Write-Host "Selected GitHub (the OSS mirror was not enough faster to be worth switching)."
    }
    return [PSCustomObject]@{ BaseUrl = $GitHubBase; FallbackBaseUrl = $OssBase }
  }
  Write-Host "Selected OSS mirror (clearly faster than GitHub here)."
  return [PSCustomObject]@{ BaseUrl = $OssBase; FallbackBaseUrl = $GitHubBase }
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
# Program tree: %LOCALAPPDATA% by default (Windows' equivalent of the XDG data dir install.sh
# uses). $LegacyInstallDir is where installs up to v0.2.2 put it, beside the data root, which
# does not move. $InstallDirExplicit opts the one-time move below out.
$LegacyInstallDir = Join-Path $env:USERPROFILE ".penguin"
$InstallDirExplicit = [bool]$InstallDir -or [bool]$env:PENGUIN_INSTALL_DIR
if (-not $InstallDir) {
  $InstallDir = if ($env:PENGUIN_INSTALL_DIR) {
    $env:PENGUIN_INSTALL_DIR
  } elseif ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA "penguin"
  } else {
    $LegacyInstallDir
  }
}
if (-not $ArchivePath) {
  $ArchivePath = if ($env:PENGUIN_ARCHIVE) { $env:PENGUIN_ARCHIVE } else { "" }
}
$DownloadBaseUrl = if ($env:PENGUIN_DOWNLOAD_BASE_URL) {
  $env:PENGUIN_DOWNLOAD_BASE_URL.TrimEnd('/')
} else {
  ""
}
$DownloadFallbackBaseUrl = if ($env:PENGUIN_DOWNLOAD_FALLBACK_BASE_URL) {
  $env:PENGUIN_DOWNLOAD_FALLBACK_BASE_URL.TrimEnd('/')
} else {
  ""
}
if (-not $DownloadBaseUrl) { $DownloadFallbackBaseUrl = "" }
$SourceMode = if ($env:PENGUIN_DOWNLOAD_SOURCE) {
  $env:PENGUIN_DOWNLOAD_SOURCE.ToLowerInvariant()
} else {
  "auto"
}
$DownloadSpeedProbe = if ($env:PENGUIN_DOWNLOAD_SPEED_PROBE) {
  $env:PENGUIN_DOWNLOAD_SPEED_PROBE
} else {
  "1"
}
# An extracted installer bundle keeps install.cmd, this script, payload.zip and its checksum
# together. `$PSScriptRoot` is empty for the documented `irm ... | iex` path, so online installs
# do not accidentally pick up an unrelated archive from the caller's current directory.
if (-not $ArchivePath -and $PSScriptRoot) {
  $SiblingArchive = Join-Path $PSScriptRoot $PayloadName
  if (Test-Path -LiteralPath $SiblingArchive -PathType Leaf) { $ArchivePath = $SiblingArchive }
}
if ($ArchivePath -and $Version) {
  Fail "-ArchivePath/PENGUIN_ARCHIVE cannot be combined with -Version/PENGUIN_VERSION"
}
if ($Version -and -not (Test-ReleaseTag $Version)) {
  Fail "invalid release version: $Version"
}
if ($SourceMode -notin @("auto", "oss", "github")) {
  Fail "PENGUIN_DOWNLOAD_SOURCE must be auto, oss, or github"
}
if ($DownloadSpeedProbe -notin @("0", "1")) {
  Fail "PENGUIN_DOWNLOAD_SPEED_PROBE must be 0 or 1"
}
$ResolvedReleaseVersion = if ($Version) {
  $Version
} elseif (Test-ReleaseTag $EmbeddedReleaseVersion) {
  $EmbeddedReleaseVersion
} else {
  ""
}
if ($DownloadBaseUrl) {
  Assert-HttpsUrl "PENGUIN_DOWNLOAD_BASE_URL" $DownloadBaseUrl
}
if ($DownloadBaseUrl -and $DownloadFallbackBaseUrl) {
  Assert-HttpsUrl "PENGUIN_DOWNLOAD_FALLBACK_BASE_URL" $DownloadFallbackBaseUrl
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

# --- Download. Explicit forwarder/configured URLs win. Otherwise a stamped Release installer
#     uses its own immutable version: auto prefers OSS and falls back only to the same GitHub
#     tag. An unstamped source-tree installer resolves latest.json first so it also locks one
#     version before downloading assets. ---
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
    $BaseUrl = ""
    $FallbackBaseUrl = $DownloadFallbackBaseUrl
    if ($DownloadBaseUrl) {
      $BaseUrl = $DownloadBaseUrl
    } elseif ($SourceMode -eq "github") {
      $BaseUrl = if ($ResolvedReleaseVersion) {
        "$GitHubReleaseRoot/$ResolvedReleaseVersion"
      } else {
        $GitHubLatestBase
      }
    } else {
      $SelectedTag = $ResolvedReleaseVersion
      if (-not $SelectedTag) {
        $SelectedTag = Get-OssLatestTag (Join-Path $Tmp "latest.json")
      }
      if ($SelectedTag) {
        $BaseUrl = "$OssReleaseRoot/$SelectedTag"
        if ($SourceMode -eq "auto" -and -not $FallbackBaseUrl) {
          $FallbackBaseUrl = "$GitHubReleaseRoot/$SelectedTag"
        }
        if ($SourceMode -eq "auto" -and $DownloadSpeedProbe -eq "1" -and -not $DownloadBaseUrl) {
          $SpeedProbeSources = Select-SpeedProbeDownloadSources $SelectedTag $Tmp
          if ($SpeedProbeSources) {
            $BaseUrl = $SpeedProbeSources.BaseUrl
            $FallbackBaseUrl = $SpeedProbeSources.FallbackBaseUrl
          } else {
            Write-Host "Download source test was inconclusive; using OSS with same-version GitHub fallback."
          }
        }
      } elseif ($SourceMode -eq "oss") {
        Fail "the OSS mirror is unavailable or its release metadata is invalid."
      } else {
        $BaseUrl = $GitHubLatestBase
      }
    }

    # Online: download the canonical bundle; the published checksum is mandatory.
    $ZipPath = Join-Path $Tmp $Asset
    $ArchiveName = $Asset
    $ShaPath = Join-Path $Tmp "$Asset.sha256"
    if (-not (Get-ReleasePair $BaseUrl $ZipPath $ShaPath)) {
      if ($FallbackBaseUrl -and $FallbackBaseUrl -ne $BaseUrl) {
        Write-Host "Primary download source unavailable; trying $(Get-DownloadSourceLabel $FallbackBaseUrl) ..."
        if (-not (Get-ReleasePair $FallbackBaseUrl $ZipPath $ShaPath)) {
          Fail "download failed from both the primary source and its fallback. Check your network, then retry."
        }
      } else {
        Fail "download failed from $(Get-DownloadSourceLabel $BaseUrl). Check the version tag and your network, then retry."
      }
    }
    Assert-Sha256 $ZipPath $ShaPath "Bundle"
  }

  # --- Resolve the program payload. An installer bundle (contains payload.zip) is opened flat
  #     and its sealed payload checksum verified; a program archive (payload.zip itself, or a
  #     pre-0.1.6 release zip with a top-level penguin\) is used directly. ---
  $ArchiveShape = if ((Get-ZipEntryNames $ZipPath) -contains $PayloadName) { "bundle" } else { "program" }
  if ($ArchiveShape -eq "bundle") {
    # A local bundle is self-verifying through its sealed payload checksum; when the published
    # outer .sha256 was transferred alongside it, verify that layer too.
    if ($UsingLocalArchive -and (Test-Path -LiteralPath "$ZipPath.sha256" -PathType Leaf)) {
      Assert-Sha256 $ZipPath "$ZipPath.sha256" "Bundle"
    }
    $BundleDir = Join-Path $Tmp "bundle"
    New-Item -ItemType Directory -Path $BundleDir | Out-Null
    Write-Host "Opening installer bundle ..."
    # The outer layer is flat (four files), so this extraction never creates deep paths.
    Expand-Archive -LiteralPath $ZipPath -DestinationPath $BundleDir -Force
    $ZipPath = Join-Path $BundleDir $PayloadName
    if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) {
      Fail "unexpected bundle layout: $PayloadName missing."
    }
    if (-not (Test-Path -LiteralPath "$ZipPath.sha256" -PathType Leaf)) {
      Fail "unexpected bundle layout: $PayloadName.sha256 missing."
    }
    Assert-Sha256 $ZipPath "$ZipPath.sha256" "Payload"
  } elseif ($UsingLocalArchive) {
    # Program archive from disk: an adjacent checksum is required — its own, or the canonical
    # asset checksum next to a renamed legacy file. (An online download was already verified
    # against the published .sha256 above.)
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
    Assert-Sha256 $ZipPath $ShaPath "Payload"
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
  } elseif ($UsingLocalArchive -and $ArchiveShape -eq "program" -and
            $ArchiveName -ine $Asset -and $ArchiveName -ine $PayloadName) {
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

    # --- Launcher shim: shipped in the payload; (re)generated only when missing. There is
    #     deliberately no penguin.ps1 launcher — PowerShell would prefer it over penguin.cmd on
    #     PATH, and client Windows defaults to the Restricted execution policy, so a .ps1
    #     launcher makes the plain `penguin` command fail with "running scripts is disabled".
    #     Batch files are policy-exempt and both PowerShell and cmd.exe resolve penguin.cmd.
    #     (bin\ is swapped wholesale above, so upgrading also removes the penguin.ps1 that
    #     pre-0.1.6 payloads shipped.) ---
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
      # A raw registry write does not broadcast WM_SETTINGCHANGE, so Explorer — and every
      # terminal window launched from it afterwards — would keep the stale Path until the next
      # logon. Broadcast it the way [Environment]::SetEnvironmentVariable would; best-effort,
      # a failure only means new terminals need a fresh logon to see the Path.
      try {
        if (-not ("PenguinInstaller.NativeMethods" -as [type])) {
          Add-Type -Namespace PenguinInstaller -Name NativeMethods -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out System.UIntPtr lpdwResult);
'@
        }
        $BroadcastResult = [UIntPtr]::Zero
        # HWND_BROADCAST (0xffff), WM_SETTINGCHANGE (0x1a), SMTO_ABORTIFHUNG (0x2), 5s timeout.
        [PenguinInstaller.NativeMethods]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero,
          "Environment", 2, 5000, [ref]$BroadcastResult) | Out-Null
      } catch {
      }
      $PathUpdateMessage = "note: installation succeeded and $BinDir was appended to your user Path. Open a new terminal window so 'penguin' is found (a new tab of an already-running terminal keeps the old Path)."
    }
  } finally {
    $EnvKey.Close()
  }
}
# Make `penguin` work in this session too.
if (($env:Path -split ";") -notcontains $BinDir) { $env:Path = "$env:Path;$BinDir" }

# --- One-time move out of %USERPROFILE%\.penguin (installs up to v0.2.2 kept the program beside
#     the data). The new tree is installed and verified by now, so the legacy PROGRAM directories
#     are just removed; data\ is never touched. Failure is a warning: the new install works, and
#     only a stale copy is left behind. ---
$MigratedLegacy = $false
if (-not $InstallDirExplicit -and $InstallDir -ne $LegacyInstallDir) {
  foreach ($d in @("bin", "lib", "web", "node", "git")) {
    $Stale = Join-Path $LegacyInstallDir $d
    if (Test-Path -LiteralPath $Stale) {
      try {
        Remove-Item -LiteralPath $Stale -Recurse -Force -ErrorAction Stop
        $MigratedLegacy = $true
      } catch {
        Write-Warning "could not remove the previous program directory $Stale"
      }
    }
  }
  # Only when nothing of ours (notably data\) is left behind.
  if ((Test-Path -LiteralPath $LegacyInstallDir) -and
      -not (Get-ChildItem -LiteralPath $LegacyInstallDir -Force)) {
    Remove-Item -LiteralPath $LegacyInstallDir -Force -ErrorAction SilentlyContinue
  }
}

Write-Host ""
Write-Host "PenguinHarness $InstalledVersion installed to $InstallDir"
if ($MigratedLegacy) {
  Write-Host "moved the program out of $LegacyInstallDir; your data stays in $LegacyInstallDir\data"
}
if ($PathUpdateMessage) {
  Write-Host ""
  Write-Host $PathUpdateMessage
}
Write-Host ""
Write-Host "Get started:"
Write-Host "  penguin --help    # all commands"
Write-Host "  penguin web       # start the Web UI at http://127.0.0.1:7376 (a first-login link is printed on first start)"
Write-Host "  penguin server    # headless server (PORT / HOST to override)"

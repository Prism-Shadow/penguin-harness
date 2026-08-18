# https://penguin.ooo/install.ps1 - PenguinHarness installer entry point for Windows.
#
# GitHub Pages cannot serve HTTP redirects, so this thin forwarder IS the
# stable install URL. It selects an immutable OSS release when that mirror is
# available, otherwise it falls back to GitHub, then runs the real installer
# while forwarding every argument it was given. In auto mode the script source
# does not lock the large payload source; the real versioned installer decides
# that for its own release. Usage:
#
#   irm https://penguin.ooo/install.ps1 | iex
#   & ([scriptblock]::Create((irm https://penguin.ooo/install.ps1))) -Version v0.2.0
#
& {
  $ForwardedArgs = @($args)
  $ErrorActionPreference = "Stop"
  $ProgressPreference = "SilentlyContinue"
  $OssOrigin = "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com"
  $OssReleaseRoot = "$OssOrigin/releases"
  $GitHubReleaseRoot = "https://github.com/Prism-Shadow/penguin-harness/releases/download"
  $GitHubLatestBase = "https://github.com/Prism-Shadow/penguin-harness/releases/latest/download"

  function Fail([string]$Message) {
    throw "error: $Message"
  }

  function Test-HttpsUrl([string]$Value) {
    try { $Uri = [Uri]$Value } catch { return $false }
    return $Uri.IsAbsoluteUri -and $Uri.Scheme -eq "https"
  }

  function Test-ReleaseTag([string]$Value) {
    return $Value -match '^v[0-9A-Za-z][0-9A-Za-z._-]*$'
  }

  function Try-DownloadFile([string]$Uri, [string]$OutFile, [int]$TimeoutSec) {
    try {
      Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing -TimeoutSec $TimeoutSec
      return $true
    } catch {
      Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
      return $false
    }
  }

  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  } catch {
    # .NET builds where the enum is immutable already default to TLS 1.2+.
  }

  $SourceMode = if ($env:PENGUIN_DOWNLOAD_SOURCE) { $env:PENGUIN_DOWNLOAD_SOURCE.ToLowerInvariant() } else { "auto" }
  if ($SourceMode -notin @("auto", "oss", "github")) {
    Fail "PENGUIN_DOWNLOAD_SOURCE must be auto, oss, or github"
  }

  $RequestedVersion = if ($env:PENGUIN_VERSION) { $env:PENGUIN_VERSION } else { "" }
  for ($i = 0; $i -lt $ForwardedArgs.Count; $i++) {
    if ([string]$ForwardedArgs[$i] -ieq "-Version" -and $i + 1 -lt $ForwardedArgs.Count) {
      $RequestedVersion = [string]$ForwardedArgs[$i + 1]
      $i++
    }
  }
  if ($RequestedVersion -and -not (Test-ReleaseTag $RequestedVersion)) {
    Fail "invalid release version: $RequestedVersion"
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
  $TmpDir = Join-Path ([IO.Path]::GetTempPath()) "penguin-forwarder-$PID"
  $InstallerPath = Join-Path $TmpDir "install.ps1"
  $ManifestPath = Join-Path $TmpDir "latest.json"
  $SelectedBase = ""
  $FallbackBase = ""
  $OriginalBase = [Environment]::GetEnvironmentVariable("PENGUIN_DOWNLOAD_BASE_URL", "Process")
  $OriginalFallback = [Environment]::GetEnvironmentVariable("PENGUIN_DOWNLOAD_FALLBACK_BASE_URL", "Process")

  try {
    if (Test-Path -LiteralPath $TmpDir) {
      Remove-Item -LiteralPath $TmpDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $TmpDir | Out-Null

    if ($OriginalBase) {
      $SelectedBase = $OriginalBase.TrimEnd('/')
      $FallbackBase = if ($OriginalFallback) { $OriginalFallback.TrimEnd('/') } else { "" }
      if (-not (Test-HttpsUrl $SelectedBase)) { Fail "PENGUIN_DOWNLOAD_BASE_URL must be an absolute HTTPS URL" }
      if ($FallbackBase -and -not (Test-HttpsUrl $FallbackBase)) {
        Fail "PENGUIN_DOWNLOAD_FALLBACK_BASE_URL must be an absolute HTTPS URL"
      }
      if (-not (Try-DownloadFile "$SelectedBase/install.ps1" $InstallerPath 30)) {
        Fail "could not download the installer from the configured mirror."
      }
    } elseif ($SourceMode -eq "github") {
      $SelectedBase = if ($RequestedVersion) { "$GitHubReleaseRoot/$RequestedVersion" } else { $GitHubLatestBase }
      if (-not (Try-DownloadFile "$SelectedBase/install.ps1" $InstallerPath 30)) {
        Fail "could not download the installer from GitHub. Check your network, then retry."
      }
    } else {
      $OssTag = $RequestedVersion
      $OssBase = if ($OssTag) { "$OssReleaseRoot/$OssTag" } else { "" }

      if (-not $OssTag -and (Try-DownloadFile "$OssOrigin/latest.json" $ManifestPath 8)) {
        try {
          $Manifest = [IO.File]::ReadAllText($ManifestPath, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
          $CandidateTag = [string]$Manifest.tag
          $CandidateBase = ([string]$Manifest.releaseBaseUrl).TrimEnd('/')
          if ([int]$Manifest.schemaVersion -eq 1 -and
              (Test-ReleaseTag $CandidateTag) -and
              $CandidateBase -eq "$OssReleaseRoot/$CandidateTag") {
            $OssTag = $CandidateTag
            $OssBase = $CandidateBase
          }
        } catch {
          $OssTag = ""
          $OssBase = ""
        }
      }

      if ($OssBase -and (Try-DownloadFile "$OssBase/install.ps1" $InstallerPath 30)) {
        $SelectedBase = $OssBase
        if ($SourceMode -eq "auto") {
          $FallbackBase = "$GitHubReleaseRoot/$OssTag"
        }
      } elseif ($SourceMode -eq "oss") {
        Fail "the OSS mirror is unavailable or its release metadata is invalid."
      } else {
        $SelectedBase = if ($OssTag) { "$GitHubReleaseRoot/$OssTag" } else { $GitHubLatestBase }
        if (-not (Try-DownloadFile "$SelectedBase/install.ps1" $InstallerPath 30)) {
          Fail "could not download the installer from GitHub. Check your network, then retry."
        }
      }
    }

    if ($OriginalBase) {
      $env:PENGUIN_DOWNLOAD_BASE_URL = $SelectedBase
      if ($FallbackBase) {
        $env:PENGUIN_DOWNLOAD_FALLBACK_BASE_URL = $FallbackBase
      } else {
        Remove-Item Env:\PENGUIN_DOWNLOAD_FALLBACK_BASE_URL -ErrorAction SilentlyContinue
      }
    } else {
      Remove-Item Env:\PENGUIN_DOWNLOAD_BASE_URL -ErrorAction SilentlyContinue
      Remove-Item Env:\PENGUIN_DOWNLOAD_FALLBACK_BASE_URL -ErrorAction SilentlyContinue
    }
    $InstallerText = [IO.File]::ReadAllText($InstallerPath, [Text.UTF8Encoding]::new($false))
    $Installer = [scriptblock]::Create($InstallerText)
    & $Installer @ForwardedArgs
  } finally {
    if ($null -eq $OriginalBase) {
      Remove-Item Env:\PENGUIN_DOWNLOAD_BASE_URL -ErrorAction SilentlyContinue
    } else {
      $env:PENGUIN_DOWNLOAD_BASE_URL = $OriginalBase
    }
    if ($null -eq $OriginalFallback) {
      Remove-Item Env:\PENGUIN_DOWNLOAD_FALLBACK_BASE_URL -ErrorAction SilentlyContinue
    } else {
      $env:PENGUIN_DOWNLOAD_FALLBACK_BASE_URL = $OriginalFallback
    }
    Remove-Item -LiteralPath $TmpDir -Recurse -Force -ErrorAction SilentlyContinue
  }
} @args

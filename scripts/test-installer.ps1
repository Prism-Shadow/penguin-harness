# Hermetic Windows installer tests with tiny fixtures: offline upgrade rollback, canonical
# bundle installs (local, sibling and online), both checksum layers, no-fallback failures, and
# pre-0.1.6 legacy archives from pinned versions.
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Installer = Join-Path $RepoRoot "install.ps1"
$WorkDir = Join-Path ([IO.Path]::GetTempPath()) "penguin-installer-tests-$PID"
$OriginalPath = $env:Path
$OriginalOs = $env:OS
$OriginalDownloadBaseUrl = $env:PENGUIN_DOWNLOAD_BASE_URL
$OriginalDownloadFallbackBaseUrl = $env:PENGUIN_DOWNLOAD_FALLBACK_BASE_URL
$OriginalDownloadSource = $env:PENGUIN_DOWNLOAD_SOURCE
$OriginalDownloadBenchmark = $env:PENGUIN_DOWNLOAD_BENCHMARK
$OriginalArchive = $env:PENGUIN_ARCHIVE
$OriginalInstallDir = $env:PENGUIN_INSTALL_DIR
$OriginalVersion = $env:PENGUIN_VERSION
$Fixture = @{
  Requests = [Collections.Generic.List[string]]::new()
  Mode = "canonical"
  GoodBundle = $null
  BadInnerBundle = $null
  LegacyArchive = $null
  Installer = $Installer
  Probe64 = $null
  Probe64Hash = $null
  Probe1M = $null
  Probe1MHash = $null
}
$global:PenguinInstallerFixture = $Fixture

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "test failure: $Message" }
}

function New-FixtureArchive([string]$Name, [bool]$Fails = $false) {
  $SourceDir = Join-Path $WorkDir "$Name-source"
  $PenguinDir = Join-Path $SourceDir "penguin"
  New-Item -ItemType Directory -Path (Join-Path $PenguinDir "bin") -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $PenguinDir "lib") -Force | Out-Null
  $VersionLines = if ($Fails) {
    @("echo fixture runtime failure 1>&2", "exit /b 42")
  } else {
    @("echo fixture-old", "exit /b 0")
  }
  @("@echo off", "if `"%~1`"==`"--version`" (") + $VersionLines + @(")", "exit /b 0") |
    Set-Content -LiteralPath (Join-Path $PenguinDir "bin\penguin.cmd") -Encoding ascii
  "fixture" | Set-Content -LiteralPath (Join-Path $PenguinDir "lib\fixture.txt") -Encoding ascii
  @{ schemaVersion = 1; target = "win32-x64" } | ConvertTo-Json -Compress |
    Set-Content -LiteralPath (Join-Path $PenguinDir "package-manifest.json") -Encoding ascii
  $Archive = Join-Path $WorkDir "$Name.zip"
  Compress-Archive -Path $PenguinDir -DestinationPath $Archive -CompressionLevel Fastest
  $Hash = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash
  "$Hash  $([IO.Path]::GetFileName($Archive))" |
    Set-Content -LiteralPath "$Archive.sha256" -Encoding ascii
  return $Archive
}

# Serves release assets for the online cases. The new installer never inspects HTTP status
# codes, so failure modes are plain throws.
function global:Invoke-WebRequest {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [switch]$UseBasicParsing,
    [int]$TimeoutSec = 0
  )
  $f = $global:PenguinInstallerFixture
  $f.Requests.Add($Uri)
  if ($f.Mode -eq "404") { throw "fixture 404: $Uri" }
  if ($f.Mode -eq "network") { throw "fixture network failure: $Uri" }
  if ($f.Mode -eq "primary-network" -and $Uri -like "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/*") {
    throw "fixture primary network failure"
  }
  if ($f.Mode -eq "forced-oss-payload" -and
      $Uri -like "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/*/penguin-*") {
    throw "fixture forced OSS payload failure"
  }
  if ($f.Mode -eq "forwarder-auto-github" -and $Uri -like "*/latest.json") {
    throw "fixture OSS metadata failure"
  }
  if ($f.Mode -eq "benchmark-missing-manifest" -and $Uri -like "*/release-download-manifest.tsv") {
    throw "fixture missing release download manifest"
  }
  switch -Wildcard ($Uri) {
    "*/latest.json" {
      if ($f.Mode -eq "forwarder-invalid-metadata") {
        '{"schemaVersion":1,"tag":"../invalid","releaseBaseUrl":"https://example.invalid"}' |
          Set-Content -LiteralPath $OutFile -Encoding ascii
      } else {
        @{
          schemaVersion = 1
          tag = "v0.0.0-test"
          releaseBaseUrl = "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/releases/v0.0.0-test"
        } | ConvertTo-Json | Set-Content -LiteralPath $OutFile -Encoding ascii
      }
    }
    "*/release-download-manifest.tsv" {
      if ($f.Mode -eq "benchmark-small") {
        @(
          "penguin-release-download-manifest`t1`tv0.0.0-test"
          "probe`tsmall`tprobe-64k.bin`t65536`t$($f.Probe64Hash)"
          "probe`tlarge`tprobe-1m.bin`t1048576`t$($f.Probe1MHash)"
          "asset`tpenguin-win32-x64.zip`t16777216`t$((Get-FileHash -Algorithm SHA256 -LiteralPath $f.GoodBundle).Hash.ToLowerInvariant())"
        ) | Set-Content -LiteralPath $OutFile -Encoding ascii
      } else {
        throw "unexpected manifest request: $Uri"
      }
    }
    "*/probe-64k.bin" {
      Copy-Item -LiteralPath $f.Probe64 -Destination $OutFile
    }
    "*/probe-1m.bin" {
      Copy-Item -LiteralPath $f.Probe1M -Destination $OutFile
    }
    "*/install.ps1" {
      Copy-Item -LiteralPath $f.Installer -Destination $OutFile
    }
    "*/penguin-win32-x64.zip.sha256" {
      switch ($f.Mode) {
        "outer-sha-mismatch" {
          ("0" * 64) + "  penguin-win32-x64.zip" | Set-Content -LiteralPath $OutFile -Encoding ascii
        }
        "inner-sha-mismatch" { Copy-Item -LiteralPath "$($f.BadInnerBundle).sha256" -Destination $OutFile }
        "legacy" { Copy-Item -LiteralPath "$($f.LegacyArchive).sha256" -Destination $OutFile }
        default { Copy-Item -LiteralPath "$($f.GoodBundle).sha256" -Destination $OutFile }
      }
    }
    "*/penguin-win32-x64.zip" {
      switch ($f.Mode) {
        "inner-sha-mismatch" { Copy-Item -LiteralPath $f.BadInnerBundle -Destination $OutFile }
        "legacy" { Copy-Item -LiteralPath $f.LegacyArchive -Destination $OutFile }
        default { Copy-Item -LiteralPath $f.GoodBundle -Destination $OutFile }
      }
    }
    default { throw "unexpected fixture request: $Uri" }
  }
}

function Invoke-OnlineCase(
  [string]$Name,
  [string]$Mode,
  [string]$Version,
  [bool]$ShouldSucceed,
  [int]$ExpectedRequests,
  [string]$InstallerPath = "",
  [string]$Benchmark = "0"
) {
  $Fixture.Mode = $Mode
  $Fixture.Requests.Clear()
  $InstallDir = Join-Path $WorkDir "$Name-install"
  $Arguments = @{ InstallDir = $InstallDir }
  if ($Version) { $Arguments.Version = $Version }
  if (-not $InstallerPath) { $InstallerPath = $Installer }
  $env:PENGUIN_DOWNLOAD_BENCHMARK = $Benchmark
  $Succeeded = $true
  $Output = @()
  try { $Output = @(& $InstallerPath @Arguments *>&1) } catch { $Succeeded = $false; $Output += $_ }
  Assert-True ($Succeeded -eq $ShouldSucceed) "$Name returned an unexpected result: $(($Output | Out-String).Trim())"
  Assert-True ($Fixture.Requests.Count -eq $ExpectedRequests) `
    "$Name made $($Fixture.Requests.Count) requests, expected $ExpectedRequests"
  [PSCustomObject]@{ InstallDir = $InstallDir; Requests = @($Fixture.Requests); Output = @($Output) }
}

function Invoke-ForwarderCase(
  [string]$Name,
  [string]$Mode,
  [string]$Source,
  [int]$ExpectedRequests,
  [string]$Version = "",
  [bool]$ShouldSucceed = $true
) {
  $Fixture.Mode = $Mode
  $Fixture.Requests.Clear()
  $InstallDir = Join-Path $WorkDir "$Name-install"
  if ($Version) {
    Remove-Item Env:\PENGUIN_ARCHIVE -ErrorAction SilentlyContinue
    $env:PENGUIN_VERSION = $Version
  } else {
    $env:PENGUIN_ARCHIVE = $Fixture.GoodBundle
    Remove-Item Env:\PENGUIN_VERSION -ErrorAction SilentlyContinue
  }
  $env:PENGUIN_INSTALL_DIR = $InstallDir
  $env:PENGUIN_DOWNLOAD_SOURCE = $Source
  Remove-Item Env:\PENGUIN_DOWNLOAD_BASE_URL, Env:\PENGUIN_DOWNLOAD_FALLBACK_BASE_URL -ErrorAction SilentlyContinue
  $Forwarder = Join-Path $RepoRoot "packages\landing\public\install.ps1"
  $Output = @()
  $Succeeded = $true
  try { $Output = @(& $Forwarder *>&1) } catch { $Succeeded = $false }
  Assert-True ($Succeeded -eq $ShouldSucceed) "$Name returned an unexpected result"
  Assert-True ($Fixture.Requests.Count -eq $ExpectedRequests) `
    "$Name made $($Fixture.Requests.Count) requests, expected $ExpectedRequests"
  Assert-True (-not (($Output | Out-String) -match 'aliyuncs\.com')) `
    "$Name exposed the OSS URL in normal output"
  [PSCustomObject]@{ InstallDir = $InstallDir; Requests = @($Fixture.Requests); Output = @($Output) }
}

try {
  New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
  # Keep the fixture tests away from the runner's user registry Path.
  $env:OS = "PenguinInstallerFixtureTest"
  Remove-Item Env:\PENGUIN_DOWNLOAD_BASE_URL, Env:\PENGUIN_DOWNLOAD_FALLBACK_BASE_URL, `
    Env:\PENGUIN_DOWNLOAD_SOURCE, Env:\PENGUIN_DOWNLOAD_BENCHMARK, Env:\PENGUIN_ARCHIVE, Env:\PENGUIN_INSTALL_DIR, `
    Env:\PENGUIN_VERSION -ErrorAction SilentlyContinue

  # --- Offline program archive: good install, then a failing upgrade must roll back. ---
  $InstallDir = Join-Path $WorkDir "offline-installed"
  $GoodArchive = New-FixtureArchive "valid"
  & $Installer -InstallDir $InstallDir -ArchivePath $GoodArchive *>&1 | Out-Null

  $FailedArchive = New-FixtureArchive "failure" $true
  $Failed = $false
  try {
    & $Installer -InstallDir $InstallDir -ArchivePath $FailedArchive *>&1 | Out-Null
  } catch {
    $Failed = $true
  }
  Assert-True $Failed "failing Windows upgrade unexpectedly succeeded"
  $Version = & (Join-Path $InstallDir "bin\penguin.cmd") --version
  Assert-True ($Version -eq "fixture-old") "previous Windows installation was not restored"

  # --- Canonical bundle fixtures: flat outer layer sealing payload.zip + checksum + installers. ---
  $BundleDir = Join-Path $WorkDir "bundle"
  New-Item -ItemType Directory -Path $BundleDir | Out-Null
  Copy-Item $GoodArchive (Join-Path $BundleDir "payload.zip")
  $PayloadHash = (Get-FileHash -LiteralPath (Join-Path $BundleDir "payload.zip") -Algorithm SHA256).Hash
  "$PayloadHash  payload.zip" |
    Set-Content -LiteralPath (Join-Path $BundleDir "payload.zip.sha256") -Encoding ascii
  Copy-Item (Join-Path $RepoRoot "install.ps1"), (Join-Path $RepoRoot "install.cmd") $BundleDir
  $Fixture.GoodBundle = Join-Path $WorkDir "penguin-win32-x64.zip"
  Compress-Archive -Path (Join-Path $BundleDir "*") -DestinationPath $Fixture.GoodBundle -CompressionLevel Fastest
  $GoodHash = (Get-FileHash $Fixture.GoodBundle -Algorithm SHA256).Hash
  "$GoodHash  penguin-win32-x64.zip" |
    Set-Content -LiteralPath "$($Fixture.GoodBundle).sha256" -Encoding ascii

  $BadBundleDir = Join-Path $WorkDir "bad-bundle"
  Copy-Item $BundleDir $BadBundleDir -Recurse
  (("0" * 64) + "  payload.zip") |
    Set-Content (Join-Path $BadBundleDir "payload.zip.sha256") -Encoding ascii
  $Fixture.BadInnerBundle = Join-Path $WorkDir "bad-inner.zip"
  Compress-Archive -Path (Join-Path $BadBundleDir "*") -DestinationPath $Fixture.BadInnerBundle
  $BadHash = (Get-FileHash $Fixture.BadInnerBundle -Algorithm SHA256).Hash
  "$BadHash  penguin-win32-x64.zip" |
    Set-Content -LiteralPath "$($Fixture.BadInnerBundle).sha256" -Encoding ascii

  $Fixture.LegacyArchive = $GoodArchive
  $Fixture.Probe64 = Join-Path $WorkDir "probe-64k.bin"
  $Fixture.Probe1M = Join-Path $WorkDir "probe-1m.bin"
  [IO.File]::WriteAllBytes($Fixture.Probe64, [byte[]]::new(65536))
  [IO.File]::WriteAllBytes($Fixture.Probe1M, [byte[]]::new(1048576))
  $Fixture.Probe64Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Fixture.Probe64).Hash.ToLowerInvariant()
  $Fixture.Probe1MHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Fixture.Probe1M).Hash.ToLowerInvariant()

  # Model the release workflow's installer stamping without changing the source installer.
  $StampedInstaller = Join-Path $WorkDir "install-v0.0.0-test.ps1"
  $InstallerText = [IO.File]::ReadAllText($Installer, [Text.UTF8Encoding]::new($false))
  Assert-True ($InstallerText.Contains('__PENGUIN_RELEASE_VERSION__')) `
    "Windows installer release-version token is missing"
  $InstallerText = $InstallerText.Replace('__PENGUIN_RELEASE_VERSION__', 'v0.0.0-test')
  [IO.File]::WriteAllText($StampedInstaller, $InstallerText, [Text.UTF8Encoding]::new($false))

  # --- Local bundle via -ArchivePath: opened flat, sealed payload checksum verified. ---
  $BundleInstall = Join-Path $WorkDir "bundle-install"
  & $Installer -InstallDir $BundleInstall -ArchivePath $Fixture.GoodBundle *>&1 | Out-Null
  $Version = & (Join-Path $BundleInstall "bin\penguin.cmd") --version
  Assert-True ($Version -eq "fixture-old") "local bundle install did not produce a working command"

  # --- Extracted bundle: install.ps1 next to payload.zip installs it with no network. ---
  $SiblingDir = Join-Path $WorkDir "sibling"
  New-Item -ItemType Directory -Path $SiblingDir | Out-Null
  Expand-Archive -LiteralPath $Fixture.GoodBundle -DestinationPath $SiblingDir
  $SiblingInstall = Join-Path $WorkDir "sibling-install"
  $Fixture.Requests.Clear()
  & (Join-Path $SiblingDir "install.ps1") -InstallDir $SiblingInstall *>&1 | Out-Null
  Assert-True ($Fixture.Requests.Count -eq 0) "sibling install unexpectedly touched the network"
  $Version = & (Join-Path $SiblingInstall "bin\penguin.cmd") --version
  Assert-True ($Version -eq "fixture-old") "sibling install did not produce a working command"

  # --- Online cases. ---
  $canonical = Invoke-OnlineCase "canonical" "canonical" "" $true 3
  Assert-True ($canonical.Requests[0] -like "*/latest.json") `
    "unstamped installer did not resolve the OSS latest metadata"
  Assert-True ($canonical.Requests[1] -like "*/releases/v0.0.0-test/penguin-win32-x64.zip") `
    "unstamped installer did not lock the resolved OSS release"
  $Version = & (Join-Path $canonical.InstallDir "bin\penguin.cmd") --version
  Assert-True ($Version -eq "fixture-old") "canonical bundle was not installed"

  $stamped = Invoke-OnlineCase "stamped" "canonical" "" $true 2 $StampedInstaller
  Assert-True ($stamped.Requests[0] -eq "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/releases/v0.0.0-test/penguin-win32-x64.zip") `
    "stamped installer did not select its own immutable OSS release"
  Assert-True (-not (($stamped.Requests | Out-String) -match 'latest\.json')) `
    "stamped installer unexpectedly resolved latest metadata"

  $stampedFallback = Invoke-OnlineCase "stamped-fallback" "primary-network" "" $true 3 $StampedInstaller
  Assert-True ($stampedFallback.Requests[0] -like "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/releases/v0.0.0-test/*") `
    "stamped installer did not try its own OSS release first"
  Assert-True ($stampedFallback.Requests[1] -like "https://github.com/*/releases/download/v0.0.0-test/penguin-win32-x64.zip") `
    "stamped installer did not fall back to the same GitHub version"

  $benchmarkSmall = Invoke-OnlineCase "benchmark-small" "benchmark-small" "" $true 5 $StampedInstaller "1"
  Assert-True (($benchmarkSmall.Requests | Out-String) -match 'release-download-manifest\.tsv') `
    "benchmark did not request the release download manifest"
  Assert-True (($benchmarkSmall.Requests | Out-String) -match 'probe-64k\.bin') `
    "benchmark did not request the small probe"
  Assert-True ($benchmarkSmall.Requests[-2] -like "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/*/penguin-win32-x64.zip") `
    "small benchmark path did not keep the default OSS source"

  $benchmarkMissing = Invoke-OnlineCase "benchmark-missing-manifest" "benchmark-missing-manifest" "" $true 4 $StampedInstaller "1"
  Assert-True (($benchmarkMissing.Output | Out-String) -match 'Download source test was inconclusive') `
    "missing benchmark manifest did not fall back to the compatible source policy"

  $env:PENGUIN_DOWNLOAD_SOURCE = "github"
  $stampedGitHub = Invoke-OnlineCase "stamped-github" "canonical" "" $true 2 $StampedInstaller
  Assert-True ($stampedGitHub.Requests[0] -like "https://github.com/*/releases/download/v0.0.0-test/penguin-win32-x64.zip") `
    "stamped installer did not honor forced GitHub mode"
  Remove-Item Env:\PENGUIN_DOWNLOAD_SOURCE

  $env:PENGUIN_DOWNLOAD_BASE_URL = "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/releases/v0.0.0-test"
  $override = Invoke-OnlineCase "download-base-override" "canonical" "" $true 2
  Assert-True ($override.Requests[0] -eq "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/releases/v0.0.0-test/penguin-win32-x64.zip") `
    "download base override did not request the configured asset directory"
  Assert-True (($override.Output | Out-String) -match 'OSS mirror') `
    "download base override did not identify the OSS mirror"
  Assert-True (-not (($override.Output | Out-String) -match 'aliyuncs\.com')) `
    "download base override exposed the OSS URL in normal output"

  $env:PENGUIN_DOWNLOAD_FALLBACK_BASE_URL = "https://github.com/Prism-Shadow/penguin-harness/releases/download/v0.0.0-test"
  $fallback = Invoke-OnlineCase "download-fallback" "primary-network" "" $true 3
  Assert-True ($fallback.Requests[0] -like "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/*") `
    "download fallback did not try the primary source first"
  Assert-True ($fallback.Requests[1] -like "https://github.com/*/penguin-win32-x64.zip") `
    "download fallback did not use the same-version GitHub source"
  Assert-True (-not (($fallback.Output | Out-String) -match 'aliyuncs\.com')) `
    "download fallback exposed the OSS URL in normal output"
  Remove-Item Env:\PENGUIN_DOWNLOAD_FALLBACK_BASE_URL
  Remove-Item Env:\PENGUIN_DOWNLOAD_BASE_URL

  $env:PENGUIN_DOWNLOAD_FALLBACK_BASE_URL = "https://example.invalid/releases/v0.0.0-test"
  $fallbackWithoutBase = Invoke-OnlineCase "fallback-without-base" "primary-network" "" $true 3 $StampedInstaller
  Assert-True (-not (($fallbackWithoutBase.Requests | Out-String) -match 'example\.invalid')) `
    "fallback without base should not override auto/source fallback"
  Assert-True (($fallbackWithoutBase.Requests | Out-String) -match 'github\.com/.*/releases/download/v0\.0\.0-test/penguin-win32-x64\.zip') `
    "fallback without base did not keep the internal same-version GitHub fallback"
  Remove-Item Env:\PENGUIN_DOWNLOAD_FALLBACK_BASE_URL

  $forwarderOss = Invoke-ForwarderCase "forwarder-oss" "forwarder-oss" "auto" 2
  Assert-True ($forwarderOss.Requests[0] -like "*/latest.json") `
    "OSS forwarder did not request release metadata first"
  Assert-True ($forwarderOss.Requests[1] -like "*/releases/v0.0.0-test/install.ps1") `
    "OSS forwarder did not request the versioned installer"

  $forwarderGitHub = Invoke-ForwarderCase "forwarder-auto-github" "forwarder-auto-github" "auto" 2
  Assert-True ($forwarderGitHub.Requests[1] -like "https://github.com/*/releases/latest/download/install.ps1") `
    "forwarder did not fall back to the GitHub installer"

  $invalidMetadata = Invoke-ForwarderCase "forwarder-invalid-metadata" "forwarder-invalid-metadata" "auto" 2
  Assert-True ($invalidMetadata.Requests[1] -like "https://github.com/*/releases/latest/download/install.ps1") `
    "invalid OSS metadata did not fall back to the GitHub installer"

  $forcedGitHub = Invoke-ForwarderCase "forwarder-github" "canonical" "github" 1
  Assert-True ($forcedGitHub.Requests[0] -like "https://github.com/*/releases/latest/download/install.ps1") `
    "forced GitHub mode did not request the GitHub installer"

  $forcedOss = Invoke-ForwarderCase "forwarder-forced-oss-no-fallback" `
    "forced-oss-payload" "oss" 2 "v0.0.0-test" $false
  Assert-True (-not (($forcedOss.Requests | Out-String) -match 'github\.com')) `
    "forced OSS mode unexpectedly fell back to GitHub"

  $pinnedForwarder = Invoke-ForwarderCase "forwarder-pinned" "canonical" "auto" 3 "v0.0.0-test"
  Assert-True ($pinnedForwarder.Requests[0] -like "*/releases/v0.0.0-test/install.ps1") `
    "pinned forwarder did not request the versioned installer"
  Assert-True ($pinnedForwarder.Requests[1] -like "*/releases/v0.0.0-test/penguin-win32-x64.zip") `
    "pinned installer did not keep the selected release version"
  Remove-Item Env:\PENGUIN_ARCHIVE, Env:\PENGUIN_INSTALL_DIR, Env:\PENGUIN_DOWNLOAD_SOURCE, Env:\PENGUIN_DOWNLOAD_BENCHMARK, Env:\PENGUIN_VERSION -ErrorAction SilentlyContinue

  Invoke-OnlineCase "outer-mismatch" "outer-sha-mismatch" "" $false 3 | Out-Null
  Invoke-OnlineCase "inner-mismatch" "inner-sha-mismatch" "" $false 3 | Out-Null
  Invoke-OnlineCase "latest-404" "404" "" $false 2 | Out-Null
  Invoke-OnlineCase "pinned-network" "network" "v0.1.4" $false 2 | Out-Null
  $pinned = Invoke-OnlineCase "pinned-legacy" "legacy" "v0.1.4" $true 2
  Assert-True ($pinned.Requests[0] -like "*/releases/v0.1.4/penguin-win32-x64.zip") `
    "pinned legacy did not prefer the pinned OSS asset"

  Write-Host "Windows installer bundle, offline, rollback and online tests passed."
} finally {
  $env:Path = $OriginalPath
  $env:OS = $OriginalOs
  if ($null -eq $OriginalDownloadBaseUrl) {
    Remove-Item Env:\PENGUIN_DOWNLOAD_BASE_URL -ErrorAction SilentlyContinue
  } else {
    $env:PENGUIN_DOWNLOAD_BASE_URL = $OriginalDownloadBaseUrl
  }
  if ($null -eq $OriginalDownloadFallbackBaseUrl) {
    Remove-Item Env:\PENGUIN_DOWNLOAD_FALLBACK_BASE_URL -ErrorAction SilentlyContinue
  } else {
    $env:PENGUIN_DOWNLOAD_FALLBACK_BASE_URL = $OriginalDownloadFallbackBaseUrl
  }
  if ($null -eq $OriginalDownloadSource) {
    Remove-Item Env:\PENGUIN_DOWNLOAD_SOURCE -ErrorAction SilentlyContinue
  } else {
    $env:PENGUIN_DOWNLOAD_SOURCE = $OriginalDownloadSource
  }
  if ($null -eq $OriginalDownloadBenchmark) {
    Remove-Item Env:\PENGUIN_DOWNLOAD_BENCHMARK -ErrorAction SilentlyContinue
  } else {
    $env:PENGUIN_DOWNLOAD_BENCHMARK = $OriginalDownloadBenchmark
  }
  if ($null -eq $OriginalArchive) {
    Remove-Item Env:\PENGUIN_ARCHIVE -ErrorAction SilentlyContinue
  } else {
    $env:PENGUIN_ARCHIVE = $OriginalArchive
  }
  if ($null -eq $OriginalInstallDir) {
    Remove-Item Env:\PENGUIN_INSTALL_DIR -ErrorAction SilentlyContinue
  } else {
    $env:PENGUIN_INSTALL_DIR = $OriginalInstallDir
  }
  if ($null -eq $OriginalVersion) {
    Remove-Item Env:\PENGUIN_VERSION -ErrorAction SilentlyContinue
  } else {
    $env:PENGUIN_VERSION = $OriginalVersion
  }
  Remove-Item Function:\Invoke-WebRequest -ErrorAction SilentlyContinue
  Remove-Variable PenguinInstallerFixture -Scope Global -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $WorkDir) { Remove-Item -LiteralPath $WorkDir -Recurse -Force }
}

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
$Fixture = @{
  Requests = [Collections.Generic.List[string]]::new()
  Mode = "canonical"
  GoodBundle = $null
  BadInnerBundle = $null
  LegacyArchive = $null
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
    [switch]$UseBasicParsing
  )
  $f = $global:PenguinInstallerFixture
  $f.Requests.Add($Uri)
  if ($f.Mode -eq "404") { throw "fixture 404: $Uri" }
  if ($f.Mode -eq "network") { throw "fixture network failure: $Uri" }
  switch -Wildcard ($Uri) {
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
  [int]$ExpectedRequests
) {
  $Fixture.Mode = $Mode
  $Fixture.Requests.Clear()
  $InstallDir = Join-Path $WorkDir "$Name-install"
  $Arguments = @{ InstallDir = $InstallDir }
  if ($Version) { $Arguments.Version = $Version }
  $Succeeded = $true
  try { & $Installer @Arguments *>&1 | Out-Null } catch { $Succeeded = $false }
  Assert-True ($Succeeded -eq $ShouldSucceed) "$Name returned an unexpected result"
  Assert-True ($Fixture.Requests.Count -eq $ExpectedRequests) `
    "$Name made $($Fixture.Requests.Count) requests, expected $ExpectedRequests"
  [PSCustomObject]@{ InstallDir = $InstallDir; Requests = @($Fixture.Requests) }
}

try {
  New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
  # Keep the fixture tests away from the runner's user registry Path.
  $env:OS = "PenguinInstallerFixtureTest"

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
  $canonical = Invoke-OnlineCase "canonical" "canonical" "" $true 2
  Assert-True ($canonical.Requests[0] -like "*/releases/latest/download/penguin-win32-x64.zip") `
    "canonical did not request the canonical bundle"
  $Version = & (Join-Path $canonical.InstallDir "bin\penguin.cmd") --version
  Assert-True ($Version -eq "fixture-old") "canonical bundle was not installed"
  Invoke-OnlineCase "outer-mismatch" "outer-sha-mismatch" "" $false 2 | Out-Null
  Invoke-OnlineCase "inner-mismatch" "inner-sha-mismatch" "" $false 2 | Out-Null
  Invoke-OnlineCase "latest-404" "404" "" $false 1 | Out-Null
  Invoke-OnlineCase "pinned-network" "network" "v0.1.4" $false 1 | Out-Null
  $pinned = Invoke-OnlineCase "pinned-legacy" "legacy" "v0.1.4" $true 2
  Assert-True ($pinned.Requests[0] -like "*/releases/download/v0.1.4/penguin-win32-x64.zip") `
    "pinned legacy did not request the pinned asset"

  Write-Host "Windows installer bundle, offline, rollback and online tests passed."
} finally {
  $env:Path = $OriginalPath
  $env:OS = $OriginalOs
  Remove-Item Function:\Invoke-WebRequest -ErrorAction SilentlyContinue
  Remove-Variable PenguinInstallerFixture -Scope Global -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $WorkDir) { Remove-Item -LiteralPath $WorkDir -Recurse -Force }
}

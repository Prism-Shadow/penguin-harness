# Smoke-test Windows offline upgrade rollback with tiny local archives.
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Installer = Join-Path $RepoRoot "install.ps1"
$WorkDir = Join-Path ([IO.Path]::GetTempPath()) "penguin-offline-install-tests-$PID"
$OriginalPath = $env:Path
$OriginalOs = $env:OS

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

try {
  New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
  # Keep the fixture test away from the runner's user registry Path.
  $env:OS = "PenguinInstallerFixtureTest"
  $InstallDir = Join-Path $WorkDir "installed"
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
  Write-Host "Windows offline rollback smoke test passed."
} finally {
  $env:Path = $OriginalPath
  $env:OS = $OriginalOs
  if (Test-Path -LiteralPath $WorkDir) {
    Remove-Item -LiteralPath $WorkDir -Recurse -Force
  }
}

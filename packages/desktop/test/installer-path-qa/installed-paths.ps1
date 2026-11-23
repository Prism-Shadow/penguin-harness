param([Parameter(Mandatory)] [string]$Installer, [Parameter(Mandatory)] [string]$OldInstaller)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:PH_DISPOSABLE_WINDOWS -ne 'yes') { throw 'This fixture requires a disposable hosted Windows runner.' }
$defaultData = Join-Path $env:USERPROFILE '.penguin\data'
$defaultProfile = Join-Path $env:APPDATA 'PenguinHarness'
$pointer = Join-Path $env:USERPROFILE '.penguin\windows-data-location'
foreach ($path in @($defaultData,$defaultProfile,$pointer)) {
  if (Test-Path -LiteralPath $path) { throw 'This account already contains product data; refusing to run.' }
}
if ($env:PENGUIN_HOME -or $env:PENGUIN_WEB_DB) { throw 'Unexpected inherited data override.' }
$root = Join-Path $env:RUNNER_TEMP ('installer-sandbox-' + [guid]::NewGuid())
[void](New-Item -ItemType Directory -Path $root)
$letters = @([char[]]'WVUTSRQ' | Where-Object { -not (Get-PSDrive -Name "$_" -ErrorAction SilentlyContinue) -and -not [IO.Directory]::Exists("${_}:\") } | Select-Object -First 2)
if ($letters.Count -ne 2) { throw 'Two unused synthetic drive letters are required.' }
$roots = @()
function Check([bool]$Condition,[string]$Name) { if (!$Condition) { throw $Name }; Write-Output "Verified: $Name" }
function Run-Installer([string]$Exe,[string]$Arguments,[bool]$Success) {
  $q = Start-Process -FilePath $Exe -ArgumentList $Arguments -PassThru
  if (!$q.WaitForExit(240000)) { throw 'Executable did not exit within four minutes.' }
  $q.Refresh()
  Check (($q.ExitCode -eq 0) -eq $Success) "installer outcome $($q.ExitCode), expected success=$Success"
}
function Run-Profile([string]$Mode,[string]$Program,[string]$Profile,[string]$Data) {
  node packages/desktop/test/installer-path-qa/installed-profile.cjs $Mode $Program (Join-Path $root 'case.json') $Profile $Data
  if ($LASTEXITCODE -ne 0) { throw "Installed application phase failed: $Mode" }
}
try {
  foreach ($letter in $letters) {
    $physical = Join-Path $root "volume-$letter"
    [void](New-Item -ItemType Directory -Path $physical)
    subst "${letter}:" "$physical"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot mount disposable subst drive.' }
    $roots += "${letter}:\"
  }
  $drive = $roots[0]
  $other = $roots[1]
  $apps = Join-Path $drive 'Apps'
  $sameName = Join-Path $apps 'PenguinHarness'
  $program = Join-Path $apps 'InstalledProduct'
  $target = Join-Path $other 'Relocated Data'
  [void](New-Item -ItemType Directory -Path $sameName -Force)
  $sentinels = @((Join-Path $drive 'unrelated-root.txt'),(Join-Path $apps 'neighbour.txt'),(Join-Path $other 'unrelated-data-volume.txt'))
  foreach ($sentinel in $sentinels) { [IO.File]::WriteAllText($sentinel, 'preserve me') }
  & "$PSScriptRoot\wizard.ps1" -Installer $Installer -Drive $drive -Apps $apps -MatchingFolder $sameName
  Run-Installer $OldInstaller "/S /currentuser /D=$program" $true
  Check ([IO.File]::Exists((Join-Path $program 'PenguinHarness.exe'))) 'real release installed at the explicit program location'
  Run-Profile 'seed' $program $defaultProfile $defaultData
  $db = Join-Path $defaultData 'web.db'
  Check ([IO.File]::Exists($db)) 'old installation produced a real database'
  $unrelated = Join-Path $other 'Occupied'
  [void](New-Item -ItemType Directory -Path $unrelated)
  $occupiedFile = Join-Path $unrelated 'belongs-to-someone-else'
  [IO.File]::WriteAllText($occupiedFile, 'keep')
  Run-Installer $Installer "/S /currentuser /DATADIR=$unrelated /D=$program" $false
  Check (!(Test-Path -LiteralPath $pointer) -and ([IO.File]::ReadAllText($occupiedFile) -ceq 'keep')) 'rejected target leaves previous root and unrelated file intact'
  Run-Profile 'old' $program $defaultProfile $defaultData
  Run-Installer $Installer "/S /currentuser /DATADIR=`"$target`" /D=$program" $true
  Check ([IO.File]::ReadAllText($pointer).Trim() -eq $target) 'verified data location published'
  $copyData = Join-Path $target 'data'
  $copyProfile = Join-Path $target 'desktop'
  Check ([IO.File]::Exists((Join-Path $copyData 'web.db')) -and [IO.File]::Exists($db)) 'original and relocated databases exist'
  Run-Profile 'moved' $program $copyProfile $copyData
  Run-Installer $Installer "/S /currentuser /D=$program" $true
  Run-Profile 'moved' $program $copyProfile $copyData
  $inside = Join-Path $program 'unrelated.txt'
  [IO.File]::WriteAllText($inside,'preserve me')
  $uninstaller = @(Get-ChildItem -LiteralPath $program -File -Filter '*uninstall*.exe')
  Check ($uninstaller.Count -eq 1) 'uninstaller belongs to this installed program'
  Run-Installer $uninstaller[0].FullName '/S' $true
  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  while ((Test-Path -LiteralPath (Join-Path $program 'PenguinHarness.exe')) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
  Check (!(Test-Path -LiteralPath (Join-Path $program 'PenguinHarness.exe'))) 'uninstaller removed program executable'
  foreach ($sentinel in ($sentinels + $inside)) { Check ([IO.File]::ReadAllText($sentinel) -ceq 'preserve me') 'unrelated sentinel retained' }
  Check ((Test-Path -LiteralPath $db) -and (Test-Path -LiteralPath (Join-Path $copyData 'web.db')) -and (Test-Path -LiteralPath $copyProfile)) 'uninstall leaves both user-data locations'
} finally {
  # The hosted runner discards its own profile, test files and volume backing directories.
  foreach ($mounted in $roots) { subst $mounted.Substring(0,2) /d | Out-Null }
}

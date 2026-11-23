$ErrorActionPreference = 'Stop'
$base = Join-Path ([IO.Path]::GetTempPath()) ("penguin-storage-" + [Guid]::NewGuid())
$setup = Join-Path $PSScriptRoot '../build/windows-data/Setup.ps1'
$userRoot = Join-Path $base 'User'
$old = Join-Path $userRoot '.penguin\data'
$desktop = Join-Path $userRoot 'Roaming\PenguinHarness'
$program = Join-Path $base 'Programs\PenguinHarness'
$destination = Join-Path $base ('Volume ' + [char]0x96ea)
$pointer = Join-Path $userRoot '.penguin\windows-data-location'

function Run([string]$to,[bool]$success) {
  $env:PH_SETUP_DATA = $to
  $ErrorActionPreference = "Continue"
  $log = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $setup -Action Apply -UserProfile $userRoot -DefaultDesktop $desktop -ProgramDirectory $program 2>&1
  if (($LASTEXITCODE -eq 0) -ne $success) { throw "Unexpected installer result $LASTEXITCODE for $to. $log" }
}

try {
  foreach ($dir in @($old,$desktop,$program)) { [void][IO.Directory]::CreateDirectory($dir) }
  $state = Join-Path $old 'workspace.txt'
  [IO.File]::WriteAllText($state,'persistent session')
  [IO.File]::WriteAllText((Join-Path $desktop 'Cookies'),'synthetic profile')
  [void](New-Item -ItemType Directory -Path (Join-Path $old 'projects\original'))
  [void](New-Item -ItemType Junction -Path (Join-Path $old 'previous-project') -Target (Join-Path $old 'projects\original'))
  $env:PENGUIN_HOME = $null
  Run '' $true
  if (Test-Path -LiteralPath $pointer) { throw 'Default setup wrote a pointer.' }
  [void][IO.Directory]::CreateDirectory($destination)
  $unrelated = Join-Path $destination 'unrelated.txt'
  [IO.File]::WriteAllText($unrelated,'other files')
  Run $destination $false
  if (![IO.File]::Exists($unrelated)) { throw 'A nonempty destination was changed.' }
  [IO.File]::Delete($unrelated)
  $held = [IO.File]::Open($state,'Open','ReadWrite','None')
  try { Run $destination $false } finally { $held.Dispose() }
  if (Test-Path -LiteralPath $pointer) { throw 'Failure changed the selected root.' }
  Run (Join-Path $old 'nested') $false
  $outside = Join-Path $base 'outside'
  [void][IO.Directory]::CreateDirectory($outside)
  $junction = Join-Path $old 'outside'
  [void](New-Item -ItemType Junction -Path $junction -Target $outside)
  try { Run $destination $false } finally { [IO.Directory]::Delete($junction) }
  Run $destination $true
  if ([IO.File]::ReadAllText($pointer) -ne $destination) { throw 'The verified location was not published.' }
  foreach ($copy in @($state,(Join-Path $destination 'data\workspace.txt'))) {
    if ([IO.File]::ReadAllText($copy) -cne 'persistent session') { throw 'Session content changed.' }
  }
  if ([IO.File]::ReadAllText((Join-Path $destination 'desktop\Cookies')) -cne 'synthetic profile') { throw 'Profile content changed.' }
  if ((Get-Item -LiteralPath (Join-Path $destination 'data\previous-project')).Target -notcontains (Join-Path $destination 'data\projects\original')) { throw 'The internal junction still uses the old root.' }
  Run '' $true
  $next = Join-Path $base 'Second disk'
  Run $next $true
  if (![IO.File]::Exists((Join-Path $destination 'data\workspace.txt')) -or [IO.File]::ReadAllText($pointer) -ne $next) { throw 'Repeated moves did not preserve their source.' }
  Write-Output 'Windows data selection, relocation, recovery and profile verification passed.'
} finally {
  # Never recurse through even a synthetic junction during cleanup.
  foreach ($folder in @($old,(Join-Path $destination 'data'),(Join-Path $base 'Second disk\data'))) {
    $link = Join-Path $folder 'previous-project'
    if ([IO.Directory]::Exists($link)) { [IO.Directory]::Delete($link) }
  }
  if (Test-Path -LiteralPath $base) { Remove-Item -LiteralPath $base -Recurse -Force }
}

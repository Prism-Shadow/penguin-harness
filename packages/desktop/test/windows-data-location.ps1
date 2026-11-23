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
  # Interrupt the real helper with its staging marker visible. At this point the sole
  # discoverable library must still be the original, and the process-owned lease must release.
  $fixture = Join-Path $old 'interrupt-fixture'
  [void][IO.Directory]::CreateDirectory($fixture)
  $bytes = New-Object byte[] 262144
  for ($n=0; $n -lt 60; $n++) { [IO.File]::WriteAllBytes((Join-Path $fixture "$n.bin"),$bytes) }
  $env:PH_SETUP_PROGRAM = $program
  $env:PH_SETUP_DATA = $destination
  $arg = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$setup`" -Action Apply -UserProfile `"$userRoot`" -DefaultDesktop `"$desktop`""
  $child = Start-Process powershell.exe -PassThru -ArgumentList $arg -WindowStyle Hidden
  try {
    $journal = Join-Path $userRoot '.penguin\windows-data-transfer.json'
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
      if ($child.HasExited) { throw 'Setup finished before an interruption could be exercised.' }
      if ([IO.File]::Exists($journal)) {
        $record = [IO.File]::ReadAllText($journal) | ConvertFrom-Json
        $stage = $destination + '.penguin-setup-' + $record.id
        if ([IO.File]::Exists((Join-Path $stage '.penguin-setup-transfer'))) { break }
      }
      Start-Sleep -Milliseconds 10
    } while ([DateTime]::UtcNow -lt $deadline)
    if (!$stage -or ![IO.Directory]::Exists($stage)) { throw 'No real staging folder was observed.' }
  } finally {
    if (!$child.HasExited) { $child.Kill() }
    $child.WaitForExit()
  }
  if ([IO.File]::Exists($pointer) -or [IO.File]::Exists((Join-Path $old 'server.lock'))) { throw 'Interrupted setup published a root or left a source reservation.' }
  Set-Content -LiteralPath $state -Stream 'Marker' -Value 'named user stream' -NoNewline
  Run $destination $true
  if ((Get-Content -LiteralPath (Join-Path $destination 'data\workspace.txt') -Stream 'Marker' -Raw) -cne 'named user stream') { throw 'The verified copy lost a named stream.' }
  if ([IO.Directory]::Exists($stage)) { throw 'Retry left behind interrupted staging files.' }
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
  $history = [IO.File]::ReadAllText((Join-Path $next 'windows-data-roots.json')) | ConvertFrom-Json
  if ($history.to -ne (Join-Path $next 'data') -or $history.from.Count -ne 2 -or $history.from -notcontains $old -or $history.from -notcontains (Join-Path $destination 'data')) { throw 'Repeated moves lost the path needed to reopen an older Session.' }
  Write-Output 'Windows data selection, relocation, recovery and profile verification passed.'
} finally {
  # Never recurse through even a synthetic junction during cleanup.
  foreach ($folder in @($old,(Join-Path $destination 'data'),(Join-Path $base 'Second disk\data'))) {
    $link = Join-Path $folder 'previous-project'
    if ([IO.Directory]::Exists($link)) { [IO.Directory]::Delete($link) }
  }
  if (Test-Path -LiteralPath $base) { Remove-Item -LiteralPath $base -Recurse -Force }
}

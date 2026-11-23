[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('Check','Apply')][string]$Action,
  [string]$ProgramDirectory = $env:PH_SETUP_PROGRAM,
  [string]$Destination = $env:PH_SETUP_DATA,
  [string]$UserProfile = [Environment]::GetFolderPath('UserProfile'),
  [string]$DefaultDesktop = (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'PenguinHarness')
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Paths.ps1')
. (Join-Path $PSScriptRoot 'Copy.ps1')

$control = Join-Path $UserProfile '.penguin'
$pointer = Join-Path $control 'windows-data-location'
$journal = Join-Path $control 'windows-data-transfer.json'
$utf8 = New-Object Text.UTF8Encoding($false)

function Current-Location {
  if (![IO.File]::Exists($pointer)) { return '' }
  $value = [IO.File]::ReadAllText($pointer,[Text.Encoding]::Unicode).TrimEnd([char[]]"$([char]13)$([char]10)")
  return Full-Directory $value
}

function Check-Paths([string]$Old) {
  $program = Full-Directory $ProgramDirectory
  $script:sourceData = if ($Old) { Join-Path $Old 'data' } else { Join-Path $control 'data' }
  $script:sourceDesktop = if ($Old) { Join-Path $Old 'desktop' } else { $DefaultDesktop }
  # Do not allow an installer or its recursive uninstaller to own the pointer or a library.
  if (Contains-Directory (Physical-Directory $program) (Physical-Directory $control)) { throw "The program directory cannot contain $control" }
  foreach ($root in @($sourceData,$sourceDesktop,$Old,$env:PENGUIN_HOME)) {
    if ($root -and $root -match '^[A-Za-z]:[\\/]' -and [IO.Directory]::Exists([IO.Path]::GetPathRoot($root))) {
      Assert-Separate $program $root
    }
  }
  if (!$Destination) { return '' } # Silent updates and Keep current require no mounted data disk.
  $target = Full-Directory $Destination
  if ($target.Length -eq 3) { $target = Join-Path $target 'PenguinHarnessData' }
  Assert-NoRedirect $target
  Assert-Separate $program $target
  Assert-Separate $control $target
  foreach ($system in @($env:SystemRoot,$env:ProgramFiles,${env:ProgramFiles(x86)},$env:ProgramData)) {
    if ($system -and (Contains-Directory (Physical-Directory $system) (Physical-Directory $target))) {
      throw "Select a user data folder outside Windows and program directories: $target"
    }
  }
  if ($Old -and (Physical-Directory $target) -eq (Physical-Directory $Old)) { return '' }
  if ($env:PENGUIN_HOME -and (Physical-Directory $env:PENGUIN_HOME) -ne (Physical-Directory $sourceData)) {
    throw "PENGUIN_HOME selects $env:PENGUIN_HOME. Keep the existing location or clear that override before moving data."
  }
  foreach ($source in @($sourceData,$sourceDesktop)) {
    Assert-NoRedirect $source
    Assert-Separate $source $target
    if ($Old -and ![IO.Directory]::Exists($source)) { throw "Reconnect the existing data drive: $source" }
  }
  return $target
}

function Owns-Stage([string]$Directory,[string]$Id) {
  if (![IO.Directory]::Exists($Directory)) { return $false }
  Assert-NoRedirect $Directory
  $marker = Join-Path $Directory '.penguin-setup-transfer'
  if (![IO.File]::Exists($marker)) { return $false }
  if ([IO.File]::GetAttributes($marker) -band [IO.FileAttributes]::ReparsePoint) { return $false }
  return [IO.File]::ReadAllText($marker) -ceq $Id
}

function Recover-Transfer([string]$Old) {
  if (![IO.File]::Exists($journal)) { return }
  $record = [IO.File]::ReadAllText($journal) | ConvertFrom-Json
  $id = [Guid]::ParseExact($record.id,'N').ToString('N')
  $target = Full-Directory $record.to
  # An interrupted copy on a disconnected drive is still recoverable at its old name.
  if (![IO.Directory]::Exists([IO.Path]::GetPathRoot($target))) { throw "Reconnect the incomplete transfer drive: $target" }
  $stage = "$target.penguin-setup-$id"
  if ($Old -and $Old -eq $target) {
    # A previous run completed the pointer replacement before setup exited.
    if (Owns-Stage $target $id) { [IO.File]::Delete((Join-Path $target '.penguin-setup-transfer')) }
  } else {
    # Only the random marker written in the private staging directory authorizes removal.
    if (Owns-Stage $stage $id) { Remove-StagingTree $stage }
    if (Owns-Stage $target $id) {
      # This name was already visible when the transaction was interrupted. Preserve
      # anything a person placed there before retrying; only scratch space is deleted.
      $recovered = "$target.incomplete-$id"
      [IO.Directory]::Move($target,$recovered)
      Write-Warning "The incomplete copy is retained at $recovered."
    }
  }
  [IO.File]::Delete($journal)
}

function Reserve-Source {
  if (![IO.Directory]::Exists($sourceData)) { return $null }
  $path = Join-Path $sourceData 'server.lock'
  $existed = [IO.File]::Exists($path)
  if ($existed) {
    $handle = [IO.File]::Open($path,'Open','ReadWrite','Read')
  } else {
    # The OS removes this reservation even if setup is killed mid-transfer.
    $handle = New-Object IO.FileStream($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read,4096,[IO.FileOptions]::DeleteOnClose)
  }
  try {
    if ($handle.Length) {
      $reader = New-Object IO.StreamReader($handle,[Text.Encoding]::UTF8,$true,1024,$true)
      try { $raw = $reader.ReadToEnd() } finally { $reader.Dispose() }
      try { $entry = $raw | ConvertFrom-Json } catch { $entry = $null }
      if ($entry -and $entry.pid -and (Get-Process -Id ([int]$entry.pid) -ErrorAction SilentlyContinue)) {
        throw "Stop the PenguinHarness server using $sourceData and retry."
      }
    }
    return $handle
  } catch {
    $handle.Dispose()
    throw
  }
}

function Install-Location {
  $old = Current-Location
  $target = Check-Paths $old
  if (!$target) { return }
  if ([IO.Directory]::Exists($target) -and [IO.Directory]::GetFileSystemEntries($target).Count -gt 0) {
    # Allow a verified setup transaction to be resumed. Unrelated nonempty folders are never replaced.
    $resume = $false
    if ([IO.File]::Exists($journal)) {
      $record = [IO.File]::ReadAllText($journal) | ConvertFrom-Json
      $resume = $record.to -eq $target -and (Owns-Stage $target $record.id)
    }
    if (!$resume) { throw "The destination is not empty. Choose an empty data directory: $target" }
  }
  if ($Action -eq 'Check') { return }
  $running = Get-Process -Name PenguinHarness -ErrorAction SilentlyContinue |
    Where-Object SessionId -eq ([Diagnostics.Process]::GetCurrentProcess().SessionId)
  if ($running) { throw "Quit PenguinHarness before moving its desktop data, then retry setup." }
  [void][IO.Directory]::CreateDirectory($control)
  $lease = [IO.File]::Open((Join-Path $control 'windows-data-migration.lock'),'OpenOrCreate','ReadWrite','None')
  $reservation = $null
  try {
    if ((Current-Location) -ne $old) { throw "The data location changed. Reopen setup." }
    Recover-Transfer $old
    $reservation = Reserve-Source
    $id = [Guid]::NewGuid().ToString('N')
    $stage = "$target.penguin-setup-$id"
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
    if (Test-Path -LiteralPath $stage) { throw "Staging directory already exists: $stage" }
    Write-AtomicText $journal (@{id=$id;to=$target} | ConvertTo-Json -Compress) $utf8
    New-PrivateDirectory $stage
    [IO.File]::WriteAllText((Join-Path $stage '.penguin-setup-transfer'),$id,$utf8)
    $data = Tree-Map $sourceData
    $desktop = Tree-Map $sourceDesktop
    Copy-Tree $sourceData (Join-Path $stage 'data') $data
    Copy-Tree $sourceDesktop (Join-Path $stage 'desktop') $desktop
    if ([IO.Directory]::Exists($target)) { [IO.Directory]::Delete($target,$false) } # must still be empty
    [IO.Directory]::Move($stage,$target)
    Complete-Tree $sourceData (Join-Path $target 'data') $data
    Complete-Tree $sourceDesktop (Join-Path $target 'desktop') $desktop
    # Keep the chain next to this verified copy, separate from the immutable originals.
    # An old Trace may name the original drive even after a second relocation.
    $previous = @()
    if ($old) {
      $prior = Join-Path $old 'windows-data-roots.json'
      if ([IO.File]::Exists($prior)) {
        $history = [IO.File]::ReadAllText($prior) | ConvertFrom-Json
        if ($history.to -ne $sourceData) { throw "Invalid previous location record: $prior" }
        $previous = @($history.from)
      }
    }
    if ($previous -notcontains $sourceData) { $previous += $sourceData }
    $dataRoot = Join-Path $target 'data'
    Write-AtomicText (Join-Path $target 'windows-data-roots.json') (@{from=$previous;to=$dataRoot} | ConvertTo-Json -Compress) $utf8
    Write-AtomicText $pointer $target ([Text.Encoding]::Unicode)
    # The pointer is the commit. No failure during later cleanup can revert it.
    try { Recover-Transfer $target } catch { Write-Warning $_.Exception.Message }
  } catch {
    $problem = $_
    try { Recover-Transfer (Current-Location) } catch { Write-Warning $_.Exception.Message }
    throw $problem
  } finally {
    if ($reservation) { $reservation.Dispose() }
    $lease.Dispose()
  }
}

try { Install-Location } catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}

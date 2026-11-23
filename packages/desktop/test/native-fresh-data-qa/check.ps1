$ErrorActionPreference='Stop'
if ($env:PH_DISPOSABLE_WINDOWS -ne 'yes' -or $env:GITHUB_ACTIONS -ne 'true') {throw 'Use a new hosted Windows test account.'}
$defaultData=Join-Path $env:USERPROFILE '.penguin\data'
$defaultProfile=Join-Path $env:APPDATA 'PenguinHarness'
$pointer=Join-Path $env:USERPROFILE '.penguin\windows-data-location'
foreach ($path in @($defaultData,$defaultProfile,$pointer)) {if (Test-Path $path) {throw 'A data directory already exists.'}}
if ($env:PENGUIN_HOME -or $env:PENGUIN_WEB_DB) {throw 'Unexpected path override.'}
$root=Join-Path $env:RUNNER_TEMP 'fresh-data-vol'
$volName=@('R:','T:','V:','Y:','W:') | Where-Object {![IO.Directory]::Exists($_+'\')} | Select-Object -First 1
if (!$volName) {throw 'No unused drive letter.'}
$underlying=Join-Path $root 'volume'
[void](New-Item -ItemType Directory -Path $underlying -Force)
$target=$volName+'\Character and Session data'
$program=Join-Path $root 'Fresh installed program'
$record=Join-Path $root 'case.json'
$installer=Join-Path $env:RUNNER_TEMP 'installer\penguin-desktop-win32-x64.exe'
function Default-Unused {
  if (Test-Path (Join-Path $defaultData 'web.db')) {throw 'Created an unexpected default database.'}
  if (Test-Path (Join-Path $defaultProfile 'Network\Cookies')) {throw 'Created an unexpected default login profile.'}
}
function Start-Profile($mode) {
  node "$PSScriptRoot\profile.cjs" $mode $program $record (Join-Path $target 'desktop') (Join-Path $target 'data')
  if ($LASTEXITCODE) {throw "Installed desktop/CLI assertion failed in $mode."}
}
try {
  subst $volName $underlying
  if ($LASTEXITCODE) {throw 'Could not mount the spare test volume.'}
  $process=Start-Process -FilePath $installer -ArgumentList "/S /currentuser /DATADIR=`"$target`" /D=$program" -Wait -PassThru
  if ($process.ExitCode -ne 0) {throw "First installation failed: $($process.ExitCode)"}
  if ([IO.File]::ReadAllText($pointer).Trim() -ine $target) {throw 'Unexpected initial data location.'}
  Default-Unused
  Start-Profile 'seed'
  Default-Unused
  $digest=(Get-FileHash $pointer).Hash
  subst $volName /D
  if ((Test-Path $target) -or $LASTEXITCODE) {throw 'The simulated volume is still online.'}
  $cli=Join-Path $program 'resources\app\bin\penguin.cmd'
  $cliProc=Start-Process -FilePath $env:ComSpec -ArgumentList ('/d /s /c ""'+$cli+'" server status"') -Wait -PassThru -RedirectStandardOutput "$root\out" -RedirectStandardError "$root\err"
  $diagnostic=[IO.File]::ReadAllText("$root\err")+[IO.File]::ReadAllText("$root\out")
  if ($cliProc.ExitCode -eq 0 -or $diagnostic -notmatch '(?i)reconnect the drive|unavailable at') {
    throw "Installed CLI failed to describe the missing volume: $($cliProc.ExitCode) $diagnostic"
  }
  $exe=Join-Path $program 'PenguinHarness.exe'
  $app=Start-Process -FilePath $exe -PassThru
  Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
  $tree=[Windows.Automation.TreeScope]
  $everything=[Windows.Automation.Condition]::TrueCondition
  $deadline=[DateTime]::UtcNow.AddSeconds(40)
  $message=$null
  while (!$message -and [DateTime]::UtcNow -lt $deadline) {
    foreach ($window in [Windows.Automation.AutomationElement]::RootElement.FindAll($tree::Children,$everything)) {
      if ($window.Current.ProcessId -ne $app.Id) {continue}
      $contents=$window.FindAll($tree::Descendants,$everything)
      $message=$contents | Where-Object {$_.Current.Name -match '(?i)reconnect the drive|unavailable at'} | Select-Object -First 1
      if ($message) {
        Write-Output ('Desktop: '+$message.Current.Name)
        $ok=$contents | Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::Button} | Select-Object -First 1
        if ($ok) {$ok.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()}
        break
      }
    }
    if (!$message) {Start-Sleep -Milliseconds 250}
  }
  if (!$message -or !$app.WaitForExit(20000)) {throw 'Missing-volume desktop error was not presented and dismissed.'}
  Default-Unused
  if ((Get-FileHash $pointer).Hash -cne $digest) {throw 'The saved location changed while the disk was offline.'}
  subst $volName $underlying
  if ($LASTEXITCODE) {throw 'Failed to reconnect the original volume.'}
  Start-Profile 'reconnected'
  Default-Unused
  Write-Output 'Fresh installation, original Session, attachment, Chromium login, live CLI machine, offline error and restored disk verified.'
} finally {
  subst $volName /D | Out-Null
}

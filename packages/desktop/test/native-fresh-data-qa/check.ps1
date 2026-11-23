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
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class FreshFixture {
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr w, IntPtr l);
 [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr window, int id);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
}
'@
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
        $handle=[IntPtr]$window.Current.NativeWindowHandle
        $ok=[FreshFixture]::GetDlgItem($handle,1)
        Write-Output ("Error dialog: " + $window.Current.ClassName + ", handle=" + $handle + ", default OK=" + $ok)
        if ($ok -ne [IntPtr]::Zero) { [void][FreshFixture]::PostMessage($ok,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero) }
        else { [void][FreshFixture]::PostMessage($handle,0x0111,[IntPtr]1,[IntPtr]::Zero) }
        break
      }
    }
    if (!$message) {Start-Sleep -Milliseconds 250}
  }
  if (!$message) {throw 'Desktop did not display the missing data location.'}
  Start-Sleep -Milliseconds 750
  if ([FreshFixture]::IsWindow($handle)) {
    [void][FreshFixture]::PostMessage($handle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)
  }
  if (!$app.WaitForExit(12000)) {
    $remaining=@([Windows.Automation.AutomationElement]::RootElement.FindAll($tree::Children,$everything) | Where-Object { $_.Current.ProcessId -eq $app.Id } | ForEach-Object { $_.Current.ClassName + ":" + $_.Current.Name })
    Write-Output ("Process remained after native dialog dismissal; original dialog exists=" + [FreshFixture]::IsWindow($handle) + "; remaining windows=" + ($remaining -join ","))
    if ([FreshFixture]::IsWindow($handle)) {throw 'The native error could not be dismissed.'}
    $orphan=$true
  } else {$orphan=$false}
  Default-Unused
  if ((Get-FileHash $pointer).Hash -cne $digest) {throw 'The saved location changed while the disk was offline.'}
  subst $volName $underlying
  if ($LASTEXITCODE) {throw 'Failed to reconnect the original volume.'}
  Start-Profile 'reconnected'
  Default-Unused
  if ($orphan) {throw 'Data and login recovered, but the disconnected desktop process survived dismissal of its error.'}
  Write-Output 'Fresh installation, original Session, attachment, Chromium login, live CLI machine, offline error and restored disk verified.'
} finally {
  subst $volName /D | Out-Null
}

param([Parameter(Mandatory)][string]$Installer,[Parameter(Mandatory)][string]$Drive,[Parameter(Mandatory)][string]$Apps,[Parameter(Mandatory)][string]$MatchingFolder,[Parameter(Mandatory)][string]$DataDrive)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class FixtureNativeButton {
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr h, StringBuilder text, int max);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern IntPtr SendMessage(IntPtr h, uint message, IntPtr w, StringBuilder value);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern IntPtr SendMessage(IntPtr h, uint message, IntPtr w, string value);
 public static string Class(int h) { var text = new StringBuilder(256); GetClassName((IntPtr)h,text,text.Capacity); return text.ToString(); }
 public static string Read(int h) { var text = new StringBuilder(4096); SendMessage((IntPtr)h,13,(IntPtr)text.Capacity,text); return text.ToString(); }
 public static void Write(int h,string value) { if(SendMessage((IntPtr)h,12,IntPtr.Zero,value)==IntPtr.Zero) throw new InvalidOperationException("The native field rejected its value."); }
}
'@
$top=[Windows.Automation.AutomationElement]::RootElement
$children=[Windows.Automation.TreeScope]::Children
$deep=[Windows.Automation.TreeScope]::Descendants
$any=[Windows.Automation.Condition]::TrueCondition
function Items($root,$scope) { $root.FindAll($scope,$any) }
function Spin([scriptblock]$read,[string]$description) {
  $until=[DateTime]::UtcNow.AddSeconds(28)
  do {
    try { $result=& $read; if ($null -ne $result) {return $result} } catch [System.Windows.Automation.ElementNotAvailableException] {}
    Start-Sleep -Milliseconds 150
  } while ([DateTime]::UtcNow -lt $until)
  foreach ($w in @(Items $top $children | Where-Object {$_.Current.Name -like '*PenguinHarness*'})) {
    Write-Host "Setup dialog '$($w.Current.Name)' class=$($w.Current.ClassName)"
    foreach ($control in @(Items $w $deep | Where-Object {$_.Current.Name} | Select-Object -First 32)) {
      Write-Host "$($control.Current.ControlType.ProgrammaticName) '$($control.Current.Name)' ID=$($control.Current.AutomationId) win32=$([FixtureNativeButton]::Class($control.Current.NativeWindowHandle)) enabled=$($control.Current.IsEnabled) offscreen=$($control.Current.IsOffscreen)"
    }
  }
  throw "Could not locate $description"
}
function Match-Node($window,[string]$kind,[string]$pattern) {
  $nativeClass=@{Text='Static';Edit='Edit';Button='Button';RadioButton='Button'}[$kind]
  Items $window $deep | Where-Object {
    ($_.Current.ControlType.ProgrammaticName -eq "ControlType.$kind" -or [FixtureNativeButton]::Class($_.Current.NativeWindowHandle) -eq $nativeClass) -and
    ($_.Current.Name -replace '&','') -match $pattern -and !$_.Current.IsOffscreen
  } | Select-Object -First 1
}
function Click($node) {
  if (!$node -or !$node.Current.IsEnabled) { throw 'A requested native control is disabled or missing.' }
  $h = $node.Current.NativeWindowHandle
  if ($h -ne 0) { [void][FixtureNativeButton]::PostMessage([IntPtr]$h,0x00f5,[IntPtr]::Zero,[IntPtr]::Zero) }
  else {$node.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()}
}
$q=Start-Process $Installer -ArgumentList '/currentuser' -PassThru
function Accept-Folder($dialog) {
  $handle=[IntPtr]$dialog.Current.NativeWindowHandle
  $button=Spin {
    $child=Match-Node $dialog 'Button' '^OK$'
    if ($child -and $child.Current.IsEnabled) {$child}
  } 'enabled folder picker OK button'
  $ok=[IntPtr]$button.Current.NativeWindowHandle
  # A shell folder picker can expose the UIA tree through a proxy on the hosted desktop.
  # Click the real Win32 OK control at its client coordinates, then observe its closure.
  $point=[IntPtr]((6 -shl 16) -bor 6)
  [void][FixtureNativeButton]::PostMessage($ok,0x0201,[IntPtr]1,$point)
  [void][FixtureNativeButton]::PostMessage($ok,0x0202,[IntPtr]::Zero,$point)
  $until=[DateTime]::UtcNow.AddSeconds(4)
  while ([FixtureNativeButton]::IsWindow($handle) -and [DateTime]::UtcNow -lt $until) {
    Start-Sleep -Milliseconds 100
  }
  if ([FixtureNativeButton]::IsWindow($handle)) {
    if (![FixtureNativeButton]::PostMessage($handle,0x0111,[IntPtr]1,$ok)) {throw 'Could not activate the native folder picker OK button.'}
  }
  Spin {if (![FixtureNativeButton]::IsWindow($handle)) {$true}} 'accepted folder picker' | Out-Null
}
function Ready-SetupDialog {
  foreach ($candidate in @(Items $top $children | Where-Object {$_.Current.Name -like '*PenguinHarness*Setup*'})) {
    if ((Match-Node $candidate 'Text' '^Program folder$') -or (Match-Node $candidate 'Button' '^(Next|I Agree|Continue)\b')) { return $candidate }
  }
}
for ($step=0;$step -lt 6;$step++) {
  $wizard=Spin {Ready-SetupDialog} 'interactive setup page with a program folder or next control'
  if (Match-Node $wizard 'Text' '^Program folder$') {break}
  $next=Match-Node $wizard 'Button' '^(Next|I Agree|Continue)\b'
  Click $next
  Start-Sleep -Milliseconds 350
}
$edit=Spin {Match-Node $wizard 'Edit' '.*'} 'Program folder edit'
foreach ($selected in @($Drive,$Apps,$MatchingFolder)) {
  [FixtureNativeButton]::Write($edit.Current.NativeWindowHandle,$selected)
  $browse=Spin {Match-Node $wizard 'Button' '^Browse'} 'program Browse button'
  Click $browse
  $dialog=Spin {
    $options=@(Items $top $children) + @(Items $wizard $children)
    $options | Where-Object {$_.Current.ClassName -eq '#32770' -and $_.Current.NativeWindowHandle -ne $wizard.Current.NativeWindowHandle -and (Match-Node $_ 'Button' '^OK$')} | Select-Object -First 1
  } 'native folder picker'
  # Browse opens at the typed path. Accept the actual selection with the shell dialog button.
  Accept-Folder $dialog
  $want=if ([IO.Path]::GetFileName($selected.TrimEnd('\')) -ieq 'penguinharness') {$selected} else {Join-Path $selected 'penguinharness'}
  Spin { if ([FixtureNativeButton]::Read($edit.Current.NativeWindowHandle).TrimEnd('\') -ieq $want.TrimEnd('\') -and (Match-Node $wizard 'Text' ([regex]::Escape($want)))) {$true} } 'computed install target' | Out-Null
  Write-Output "Verified Browse selection $selected -> $want"
}
Click (Match-Node $wizard 'Button' '^Next')
$another=Spin { Match-Node $wizard 'RadioButton' '^Use another data directory$' } 'independent data location page'
Click $another
$dataEdit=Spin { Match-Node $wizard 'Edit' '.*' } 'data directory edit'
[FixtureNativeButton]::Write($dataEdit.Current.NativeWindowHandle,$DataDrive)
Click (Match-Node $wizard 'Button' '^Browse')
$picker=Spin {
  $choices=@(Items $top $children) + @(Items $wizard $children)
  $choices | Where-Object {$_.Current.ClassName -eq '#32770' -and $_.Current.NativeWindowHandle -ne $wizard.Current.NativeWindowHandle -and (Match-Node $_ 'Button' '^OK$')} | Select-Object -First 1
} 'native data directory picker'
Accept-Folder $picker
Spin { if ([FixtureNativeButton]::Read($dataEdit.Current.NativeWindowHandle) -ieq (Join-Path $DataDrive 'PenguinHarnessData')) {$true} } 'safe folder for data on a different volume' | Out-Null
Click (Match-Node $wizard 'Button' '^Cancel$')
Start-Sleep -Milliseconds 300
$confirm=@(Items $top $children) + @(Items $wizard $children) | Where-Object { $_.Current.ClassName -eq '#32770' -and (Match-Node $_ 'Button' '^Yes$') } | Select-Object -First 1
if ($confirm) {Click (Match-Node $confirm 'Button' '^Yes$')}
if (!$q.WaitForExit(15000)) {throw 'Cancelling the native wizard did not finish setup.'}

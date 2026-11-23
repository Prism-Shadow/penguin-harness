param([Parameter(Mandatory)][string]$Installer,[Parameter(Mandatory)][string]$Drive,[Parameter(Mandatory)][string]$Apps,[Parameter(Mandatory)][string]$MatchingFolder,[Parameter(Mandatory)][string]$DataDrive)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class FixtureNativeButton {
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
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
  throw "Could not locate $description"
}
function Match-Node($window,[string]$kind,[string]$pattern) {
  Items $window $deep | Where-Object { $_.Current.ControlType.ProgrammaticName -eq "ControlType.$kind" -and $_.Current.Name -match $pattern -and !$_.Current.IsOffscreen } | Select-Object -First 1
}
function Click($node) {
  if (!$node -or !$node.Current.IsEnabled) { throw 'A requested native control is disabled or missing.' }
  $h = $node.Current.NativeWindowHandle
  if ($h -ne 0) { [void][FixtureNativeButton]::PostMessage([IntPtr]$h,0x00f5,[IntPtr]::Zero,[IntPtr]::Zero) }
  else {$node.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()}
}
$q=Start-Process $Installer -ArgumentList '/currentuser' -PassThru
$wizard=Spin { Items $top $children | Where-Object {$_.Current.Name -like '*PenguinHarness*Setup*' -and !$_.Current.IsOffscreen} | Select-Object -First 1 } 'installer wizard'
for ($step=0;$step -lt 6;$step++) {
  if (Match-Node $wizard 'Text' '^Program folder$') {break}
  $next=Spin { Match-Node $wizard 'Button' '^(Next|I Agree|Continue)\b' } 'next wizard page'
  Click $next
  Start-Sleep -Milliseconds 350
}
$edit=Spin {Match-Node $wizard 'Edit' '.*'} 'Program folder edit'
$value=$edit.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
foreach ($selected in @($Drive,$Apps,$MatchingFolder)) {
  $value.SetValue($selected)
  $browse=Spin {Match-Node $wizard 'Button' '^Browse'} 'program Browse button'
  Click $browse
  $dialog=Spin {
    $options=@(Items $top $children) + @(Items $wizard $children)
    $options | Where-Object {$_.Current.ClassName -eq '#32770' -and $_.Current.NativeWindowHandle -ne $wizard.Current.NativeWindowHandle -and (Match-Node $_ 'Button' '^OK$')} | Select-Object -First 1
  } 'native folder picker'
  # Browse opens at the typed path. Accept the actual selection with the shell dialog button.
  Click (Match-Node $dialog 'Button' '^OK$')
  $want=if ([IO.Path]::GetFileName($selected.TrimEnd('\')) -ieq 'penguinharness') {$selected} else {Join-Path $selected 'penguinharness'}
  Spin { if ($value.Current.Value.TrimEnd('\') -ieq $want.TrimEnd('\') -and (Match-Node $wizard 'Text' ([regex]::Escape($want)))) {$true} } 'computed install target' | Out-Null
  Write-Output "Verified Browse selection $selected -> $want"
}
Click (Match-Node $wizard 'Button' '^Next')
$another=Spin { Match-Node $wizard 'RadioButton' '^Use another data directory$' } 'independent data location page'
Click $another
$dataEdit=Spin { Match-Node $wizard 'Edit' '.*' } 'data directory edit'
$dataValue=$dataEdit.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
$dataValue.SetValue($DataDrive)
Click (Match-Node $wizard 'Button' '^Browse')
$picker=Spin {
  $choices=@(Items $top $children) + @(Items $wizard $children)
  $choices | Where-Object {$_.Current.ClassName -eq '#32770' -and $_.Current.NativeWindowHandle -ne $wizard.Current.NativeWindowHandle -and (Match-Node $_ 'Button' '^OK$')} | Select-Object -First 1
} 'native data directory picker'
Click (Match-Node $picker 'Button' '^OK$')
Spin { if ($dataValue.Current.Value -ieq (Join-Path $DataDrive 'PenguinHarnessData')) {$true} } 'safe folder for data on a different volume' | Out-Null
Click (Match-Node $wizard 'Button' '^Cancel$')
Start-Sleep -Milliseconds 300
$confirm=@(Items $top $children) + @(Items $wizard $children) | Where-Object { $_.Current.ClassName -eq '#32770' -and (Match-Node $_ 'Button' '^Yes$') } | Select-Object -First 1
if ($confirm) {Click (Match-Node $confirm 'Button' '^Yes$')}
if (!$q.WaitForExit(15000)) {throw 'Cancelling the native wizard did not finish setup.'}

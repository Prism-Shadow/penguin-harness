<#
.SYNOPSIS
  Creates the local accounts the penguin-winuser sandbox runs agent commands as.

.DESCRIPTION
  Run this ONCE, from an elevated PowerShell. It creates a local group and two accounts in it:
  one whose outbound traffic three firewall rules block, one with the network open. The harness
  then runs each confined command as whichever the policy asks for, and the command is confined
  by being someone else — it owns nothing, and reaches only what is granted to the group.

  Nothing here is a service, a driver or a reboot. What it leaves behind is: the group, the two
  accounts, three firewall rules, and one state file naming them. Pass -Remove to take all of it
  away again.

  The accounts' passwords are random, never displayed, and stored in the state file, whose
  permissions are their protection: Administrators, SYSTEM, and the account that runs the
  harness (-ServerUser, by default the user running this script).

.PARAMETER ServerUser
  The account the harness runs as, which must be able to read the state file. Default: you.

.PARAMETER Remove
  Delete the accounts, the group, the firewall rules and the state file.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\penguin-sandbox-setup.ps1
#>
[CmdletBinding()]
param(
  [string] $GroupName = 'PenguinSandboxUsers',
  [string] $OfflineUser = 'PenguinSandboxOffline',
  [string] $OnlineUser = 'PenguinSandboxOnline',
  [string] $ServerUser = "$env:USERDOMAIN\$env:USERNAME",
  [switch] $Remove
)

$ErrorActionPreference = 'Stop'

$stateDir = Join-Path $env:ProgramData 'penguin'
$stateFile = Join-Path $stateDir 'sandbox-winuser.json'
$homeDir = Join-Path $stateDir 'sandbox-home'
$ruleNames = @(
  'penguin_sandbox_offline_block_outbound',
  'penguin_sandbox_offline_block_loopback_tcp',
  'penguin_sandbox_offline_block_loopback_udp'
)

function Assert-Elevated {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this from an elevated PowerShell: it creates local accounts and firewall rules.'
  }
}

function New-RandomPassword {
  # 30 characters from a set every Windows password policy accepts.
  $bytes = New-Object 'System.Byte[]' 30
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_=+'
  -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
}

function Remove-Everything {
  foreach ($rule in $ruleNames) {
    if (Get-NetFirewallRule -Name $rule -ErrorAction SilentlyContinue) {
      Remove-NetFirewallRule -Name $rule
      Write-Host "removed firewall rule $rule"
    }
  }
  foreach ($user in @($OfflineUser, $OnlineUser)) {
    if (Get-LocalUser -Name $user -ErrorAction SilentlyContinue) {
      Remove-LocalUser -Name $user
      Write-Host "removed account $user"
    }
  }
  if (Get-LocalGroup -Name $GroupName -ErrorAction SilentlyContinue) {
    Remove-LocalGroup -Name $GroupName
    Write-Host "removed group $GroupName"
  }
  if (Test-Path $stateFile) {
    Remove-Item $stateFile -Force
    Write-Host "removed $stateFile"
  }
  Write-Host 'penguin-winuser: removed. Grants this sandbox made on Workspaces are left alone;'
  Write-Host "they name $GroupName, which no longer exists."
}

function New-SandboxAccount([string] $Name) {
  $password = New-RandomPassword
  $secure = ConvertTo-SecureString $password -AsPlainText -Force
  if (Get-LocalUser -Name $Name -ErrorAction SilentlyContinue) {
    Set-LocalUser -Name $Name -Password $secure -PasswordNeverExpires $true
    Write-Host "account $Name: password reset"
  } else {
    New-LocalUser -Name $Name -Password $secure -PasswordNeverExpires -AccountNeverExpires `
      -Description 'PenguinHarness sandbox: agent commands run as this account.' | Out-Null
    Write-Host "account $Name: created"
  }
  if (-not (Get-LocalGroupMember -Group $GroupName -Member $Name -ErrorAction SilentlyContinue)) {
    Add-LocalGroupMember -Group $GroupName -Member $Name
  }
  return $password
}

function Set-OfflineFirewall([string] $Sid) {
  # Scoped to the offline account's SID: the online account is untouched by these rules.
  $filter = "O:LSD:(A;;CC;;;$Sid)"
  $rules = @(
    @{ Name = $ruleNames[0]; Display = 'Penguin sandbox (offline): block outbound'; Protocol = 'Any'; Address = 'Any' },
    @{ Name = $ruleNames[1]; Display = 'Penguin sandbox (offline): block loopback TCP'; Protocol = 'TCP'; Address = '127.0.0.1' },
    @{ Name = $ruleNames[2]; Display = 'Penguin sandbox (offline): block loopback UDP'; Protocol = 'UDP'; Address = '127.0.0.1' }
  )
  foreach ($rule in $rules) {
    if (Get-NetFirewallRule -Name $rule.Name -ErrorAction SilentlyContinue) {
      Remove-NetFirewallRule -Name $rule.Name
    }
    New-NetFirewallRule -Name $rule.Name -DisplayName $rule.Display -Direction Outbound `
      -Action Block -Enabled True -Profile Any -Protocol $rule.Protocol `
      -RemoteAddress $rule.Address -LocalUser $filter | Out-Null
    Write-Host "firewall rule $($rule.Name): set"
  }
}

function Protect-StateFile([string] $Path) {
  # The passwords' protection is this ACL: the harness's account, administrators, SYSTEM.
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($who in @($ServerUser, 'BUILTIN\Administrators', 'NT AUTHORITY\SYSTEM')) {
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($who, 'FullControl', 'Allow')
    $acl.AddAccessRule($rule)
  }
  Set-Acl -Path $Path -AclObject $acl
}

Assert-Elevated

# Elevation goes through ShellExecute, which cannot hand a stream back to whoever asked for it,
# so this run keeps its own transcript — that is what the Plugins page reads when it has to
# explain a failure it could not see.
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
try { Start-Transcript -Path (Join-Path $stateDir 'sandbox-setup.log') -Force | Out-Null } catch { }

if ($Remove) {
  Remove-Everything
  return
}

if (-not (Get-LocalGroup -Name $GroupName -ErrorAction SilentlyContinue)) {
  New-LocalGroup -Name $GroupName -Description 'PenguinHarness sandbox accounts.' | Out-Null
  Write-Host "group ${GroupName}: created"
}

$offlinePassword = New-SandboxAccount $OfflineUser
$onlinePassword = New-SandboxAccount $OnlineUser

$offlineSid = (Get-LocalUser -Name $OfflineUser).SID.Value
Set-OfflineFirewall $offlineSid

New-Item -ItemType Directory -Force -Path $stateDir, $homeDir | Out-Null
# The accounts' own home: they have no profile, and a shell needs somewhere to write.
& icacls $homeDir /grant "${GroupName}:(OI)(CI)(M)" | Out-Null

$state = [ordered]@{
  group   = $GroupName
  offline = [ordered]@{ user = $OfflineUser; password = $offlinePassword }
  online  = [ordered]@{ user = $OnlineUser; password = $onlinePassword }
  createdAt = (Get-Date).ToString('o')
}
$state | ConvertTo-Json -Depth 4 | Set-Content -Path $stateFile -Encoding UTF8
Protect-StateFile $stateFile

Write-Host ''
Write-Host "penguin-winuser is set up. State: $stateFile (readable by $ServerUser)."
Write-Host 'Install the sandbox-winuser plugin on the Project, then pick a mode on'
Write-Host 'Settings -> Plugins -> Sandbox. No restart is needed.'
try { Stop-Transcript | Out-Null } catch { }

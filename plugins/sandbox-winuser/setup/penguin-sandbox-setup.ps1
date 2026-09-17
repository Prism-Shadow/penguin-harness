<#
.SYNOPSIS
  Creates the local accounts the penguin-winuser sandbox runs agent commands as.

.DESCRIPTION
  Run this ONCE, from an elevated PowerShell. It creates a local group and four accounts in it,
  and each confined command runs as whichever the policy asks for — confined by being someone
  else: it owns nothing, and reaches only what is granted.

  The four accounts are the two axes crossed. Network: two of them are blocked outbound by
  firewall rules, two have the network open. Filesystem: two are granted READ on your profile
  (read-only and workspace-write commands, which never write your home), two are granted MODIFY
  on it (full-access commands, which may). The grant is standing, made here once, so no command
  ever has to re-permission your profile — which on a large profile would take minutes.

  Your home is NOT remapped: a confined command sees the real HOME/USERPROFILE, readable (and,
  under full access, writable) through that grant — the same shape the Linux and macOS sandboxes
  give. The one thing redirected is the temp directory, to a sandbox-owned folder every account
  may write, which is where a shell keeps its scratch files.

  Nothing here is a service, a driver or a reboot. What it leaves behind is: the group, the four
  accounts, their firewall rules, two grants on your profile, one writable temp folder, and one
  state file naming them. Pass -Remove to take all of it away again.

  The accounts' passwords are random, never displayed, and stored in the state file, whose
  permissions are their protection: Administrators, SYSTEM, and the account that runs the
  harness (-ServerUser, by default the user running this script).

.PARAMETER ServerUser
  The account the harness runs as, which must be able to read the state file. Default: you.

.PARAMETER UserProfile
  The home directory the sandbox accounts are granted access to (the harness user's profile).
  Default: this session's own profile.

.PARAMETER Remove
  Delete the accounts, the group, the firewall rules, the profile grants, the temp folder and
  the state file.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\penguin-sandbox-setup.ps1
#>
[CmdletBinding()]
param(
  [string] $GroupName = 'PenguinSbxUsers',
  # Windows caps a local account name at 20 characters, which is why these are abbreviated.
  [string] $OnlineUser = 'PenguinSbxNet',
  [string] $OfflineUser = 'PenguinSbxNoNet',
  [string] $FullOnlineUser = 'PenguinSbxFullNet',
  [string] $FullOfflineUser = 'PenguinSbxFullNoNet',
  [string] $ServerUser = "$env:USERDOMAIN\$env:USERNAME",
  [string] $UserProfile = $env:USERPROFILE,
  [switch] $Remove
)

$ErrorActionPreference = 'Stop'

$stateDir = Join-Path $env:ProgramData 'penguin'
$stateFile = Join-Path $stateDir 'sandbox-winuser.json'
$tempDir = Join-Path $stateDir 'sandbox-temp'

# The two blocked accounts each get their own three rules, named after the account they scope.
$firewallRules = @{
  $OfflineUser     = @('penguin_sbx_nonet_block_outbound', 'penguin_sbx_nonet_block_loopback_tcp', 'penguin_sbx_nonet_block_loopback_udp')
  $FullOfflineUser = @('penguin_sbx_fullnonet_block_outbound', 'penguin_sbx_fullnonet_block_loopback_tcp', 'penguin_sbx_fullnonet_block_loopback_udp')
}

# What earlier versions of this script named, so -Remove takes their leavings too.
$legacyGroups = @('PenguinSandboxUsers')
$legacyUsers = @('PenguinSandboxNoNet', 'PenguinSandboxNet')
$legacyRules = @('penguin_sandbox_offline_block_outbound', 'penguin_sandbox_offline_block_loopback_tcp', 'penguin_sandbox_offline_block_loopback_udp')
$legacyHome = Join-Path $stateDir 'sandbox-home'

# What Windows refuses, said before it refuses: New-LocalUser names neither the value nor the
# rule, and its refusal reaches a page that can only repeat it. Both limits are its own.
$accountNameLimit = 20
$accountDescriptionLimit = 48
$accountDescription = 'PenguinHarness sandbox account.'
$allUsers = @($OnlineUser, $OfflineUser, $FullOnlineUser, $FullOfflineUser)

function Assert-AccountName([string] $Name) {
  if ($Name.Length -gt $accountNameLimit) {
    throw "Account name '$Name' is $($Name.Length) characters; Windows allows at most $accountNameLimit."
  }
}

function Assert-AccountDescription([string] $Text) {
  if ($Text.Length -gt $accountDescriptionLimit) {
    throw "The account description is $($Text.Length) characters; Windows allows at most $accountDescriptionLimit."
  }
}

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
  foreach ($rule in ($firewallRules.Values | ForEach-Object { $_ }) + $legacyRules) {
    if (Get-NetFirewallRule -Name $rule -ErrorAction SilentlyContinue) {
      Remove-NetFirewallRule -Name $rule
      Write-Host "removed firewall rule $rule"
    }
  }
  # The standing grants on the profile: named by the group and the two full accounts. icacls
  # /remove takes them out without disturbing the profile's own ACL.
  if (Test-Path $UserProfile) {
    foreach ($who in @($GroupName, $FullOnlineUser, $FullOfflineUser) + $legacyGroups) {
      & icacls $UserProfile /remove:g $who /T /C /Q 2>$null | Out-Null
    }
    Write-Host "removed profile grants on $UserProfile"
  }
  foreach ($user in $allUsers + $legacyUsers) {
    if (Get-LocalUser -Name $user -ErrorAction SilentlyContinue) {
      Remove-LocalUser -Name $user
      Write-Host "removed account $user"
    }
    # A profile directory, if some earlier version logged the account in with one. Removing the
    # account leaves it behind, and it belongs to nothing once the account is gone.
    $profileDir = Join-Path $env:SystemDrive "Users\$user"
    if (Test-Path $profileDir) {
      Remove-Item $profileDir -Recurse -Force -ErrorAction SilentlyContinue
      Write-Host "removed leftover profile $profileDir"
    }
  }
  foreach ($group in @($GroupName) + $legacyGroups) {
    if (Get-LocalGroup -Name $group -ErrorAction SilentlyContinue) {
      Remove-LocalGroup -Name $group
      Write-Host "removed group $group"
    }
  }
  foreach ($dir in @($tempDir, $legacyHome)) {
    if (Test-Path $dir) {
      Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
      Write-Host "removed $dir"
    }
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
    Write-Host "account ${Name}: password reset"
  } else {
    New-LocalUser -Name $Name -Password $secure -PasswordNeverExpires -AccountNeverExpires `
      -Description $accountDescription | Out-Null
    Write-Host "account ${Name}: created"
  }
  if (-not (Get-LocalGroupMember -Group $GroupName -Member $Name -ErrorAction SilentlyContinue)) {
    Add-LocalGroupMember -Group $GroupName -Member $Name
  }
  return $password
}

function Set-BlockFirewall([string] $User, [string[]] $Names) {
  # Scoped to the account's SID: the open accounts are untouched by these rules.
  $sid = (Get-LocalUser -Name $User).SID.Value
  $filter = "O:LSD:(A;;CC;;;$sid)"
  $rules = @(
    @{ Name = $Names[0]; Display = "Penguin sandbox ($User): block outbound"; Protocol = 'Any'; Address = 'Any' },
    @{ Name = $Names[1]; Display = "Penguin sandbox ($User): block loopback TCP"; Protocol = 'TCP'; Address = '127.0.0.1' },
    @{ Name = $Names[2]; Display = "Penguin sandbox ($User): block loopback UDP"; Protocol = 'UDP'; Address = '127.0.0.1' }
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
foreach ($u in $allUsers) { Assert-AccountName $u }
Assert-AccountDescription $accountDescription

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

$onlinePassword = New-SandboxAccount $OnlineUser
$offlinePassword = New-SandboxAccount $OfflineUser
$fullOnlinePassword = New-SandboxAccount $FullOnlineUser
$fullOfflinePassword = New-SandboxAccount $FullOfflineUser

Set-BlockFirewall $OfflineUser $firewallRules[$OfflineUser]
Set-BlockFirewall $FullOfflineUser $firewallRules[$FullOfflineUser]

# A writable temp every account shares (they are all in the group). The command's HOME is left
# real; this is the one directory redirected, so a shell has somewhere to write.
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
& icacls $tempDir /grant "${GroupName}:(OI)(CI)(M)" | Out-Null

# The standing grants on the real profile — the whole point of not remapping HOME. READ for the
# group (so every account can read ~), MODIFY for the two full accounts (so full-access can
# write it). ONE icacls call applies all three ACEs in a SINGLE tree walk: /T is slow on a
# large profile, so it is done once here, never three times and never per command.
if (Test-Path $UserProfile) {
  Write-Host "profile ${UserProfile}: granting access (one pass; slow on a large profile)..."
  & icacls $UserProfile `
    /grant "${GroupName}:(OI)(CI)(RX)" `
    /grant "${FullOnlineUser}:(OI)(CI)(M)" `
    /grant "${FullOfflineUser}:(OI)(CI)(M)" `
    /T /C /Q | Out-Null
  Write-Host "profile ${UserProfile}: read to $GroupName, modify to the full accounts"
} else {
  Write-Host "profile ${UserProfile}: not found; skipped (a confined command may not read ~)."
}

$state = [ordered]@{
  group       = $GroupName
  home        = $UserProfile
  temp        = $tempDir
  online      = [ordered]@{ user = $OnlineUser; password = $onlinePassword }
  offline     = [ordered]@{ user = $OfflineUser; password = $offlinePassword }
  fullOnline  = [ordered]@{ user = $FullOnlineUser; password = $fullOnlinePassword }
  fullOffline = [ordered]@{ user = $FullOfflineUser; password = $fullOfflinePassword }
  createdAt   = (Get-Date).ToString('o')
}
# Written without a byte-order mark: Set-Content -Encoding UTF8 adds one here, and a BOM is not
# valid JSON to most readers, this plugin's own included.
[System.IO.File]::WriteAllText($stateFile, ($state | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
Protect-StateFile $stateFile

Write-Host ''
Write-Host "penguin-winuser is set up. State: $stateFile (readable by $ServerUser)."
Write-Host 'Install the sandbox-winuser plugin on the Project, then pick a mode on'
Write-Host 'Settings -> Plugins -> Sandbox. No restart is needed.'
try { Stop-Transcript | Out-Null } catch { }

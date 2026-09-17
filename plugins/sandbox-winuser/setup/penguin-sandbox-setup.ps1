<#
.SYNOPSIS
  Creates the local accounts the penguin-winuser sandbox runs agent commands as.

.DESCRIPTION
  Run this ONCE, from an elevated PowerShell. It creates a local group and four accounts in it,
  and each confined command runs as whichever the policy asks for — confined by being someone
  else: it owns nothing, and reaches only what is granted.

  The four accounts are the two axes crossed. Network: two of them are blocked outbound by
  firewall rules, two have the network open. Filesystem: what a command may WRITE is granted per
  command on the Workspace alone (small, so it is fast); everywhere else the account is a
  stranger and is already denied. That is the whole write-confinement, and it costs nothing.

  Your home is NOT remapped: a confined command sees the real HOME/USERPROFILE. What it can read
  there is a CURATED set of config paths — the profile root, its own dotfiles, and a short list
  of config directories — granted once here. Deliberately NOT the whole profile: a developer's
  profile holds millions of files in caches, node_modules and AppData\Local, and stamping every
  one of them would take an age and hand the sandbox your browser data for nothing. The read
  group gets READ on that set; the two full-access accounts get MODIFY, so full access can write
  your config. The one thing redirected is the temp directory, to a sandbox-owned folder every
  account may write, which is where a shell keeps its scratch files.

  ~/.ssh is never in that set, and every run of this script (setup and -Remove alike) takes any
  sandbox account OFF it: OpenSSH refuses a config or a private key another account can read
  ("Bad permissions"), so a grant there breaks ssh for you, and a sandboxed ssh could not use
  those files anyway — they are not its own. NTUSER.DAT and its logs (the registry hive) are
  skipped among the root files for the same reason: nothing but you should appear on them.

  Every run also clears what an earlier build of this script left behind: an inheritable grant
  on the profile root (which every file below, ~/.ssh included, inherited), and that build's
  accounts, group, firewall rules and decoy home. Nothing of an earlier layout survives a run
  except entries stamped on individual files, which -RemoveLegacyProfileGrant walks for.

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
  # Config directories under the profile opened to the sandbox accounts (each small). Caches,
  # node_modules, AppData\Local and .penguin are deliberately absent: a command never needs them,
  # and they are where a developer's millions of files live. .ssh is absent on purpose, see
  # $PrivateDirs.
  [string[]] $ConfigDirs = @('.config', '.aws', '.gnupg', '.docker', '.kube', '.azure'),
  # Directories no sandbox account may appear on at all. Every run strips them of any grant an
  # earlier build left, inherited ones included (see Clear-PrivateDirs).
  [string[]] $PrivateDirs = @('.ssh'),
  [switch] $Remove,
  # Also walk the whole profile for grants an earlier build stamped on individual files (slow;
  # off by default). The inheritable root grant such a build made is withdrawn on every run.
  [switch] $RemoveLegacyProfileGrant
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

function Remove-Rules([string[]] $Names) {
  foreach ($rule in $Names) {
    if (Get-NetFirewallRule -Name $rule -ErrorAction SilentlyContinue) {
      Remove-NetFirewallRule -Name $rule
      Write-Host "removed firewall rule $rule"
    }
  }
}

function Remove-Accounts([string[]] $Names) {
  foreach ($user in $Names) {
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
}

function Remove-Groups([string[]] $Names) {
  foreach ($group in $Names) {
    if (Get-LocalGroup -Name $group -ErrorAction SilentlyContinue) {
      Remove-LocalGroup -Name $group
      Write-Host "removed group $group"
    }
  }
}

function Remove-Dirs([string[]] $Paths) {
  foreach ($dir in $Paths) {
    if (Test-Path $dir) {
      Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
      Write-Host "removed $dir"
    }
  }
}

<#
  Every sandbox principal off the profile ROOT — current names and earlier ones. An earlier
  build granted the root WITH inheritance, so every file under the profile inherited it,
  ~/.ssh included — the "Bad permissions" ssh then refuses with, and one that /remove on the
  file cannot touch, since the entry is not the file's own. Withdrawing the entry at the root
  makes Windows withdraw it from every descendant: that is the propagation an inheritable entry
  carries, it takes minutes on a large profile, and it is paid only when such an entry is found.
  Entries an earlier /T stamped on individual files are not inherited and are not reached this
  way; -RemoveLegacyProfileGrant walks the tree for those. Runs before the accounts are removed,
  while their names still resolve.
#>
function Clear-ProfileRootGrants {
  if (-not (Test-Path -LiteralPath $UserProfile)) { return }
  $principals = @($GroupName) + $allUsers + $legacyGroups + $legacyUsers
  $listing = (& icacls $UserProfile 2>$null) -join "`n"
  $present = @($principals | Where-Object { $listing -match [regex]::Escape("\${_}:") })
  if ($present.Count -eq 0) { return }
  $inheritable = @($present | Where-Object { $listing -match ([regex]::Escape("\${_}:") + '(\(\w+\))*\((OI|CI)\)') })
  if ($inheritable.Count -gt 0) {
    Write-Host "profile root: withdrawing an inheritable grant for $($inheritable -join ', ') — Windows withdraws it from every file below, which can take minutes on a large profile..."
  }
  foreach ($who in $present) {
    & icacls $UserProfile /remove:g $who /C /Q 2>$null | Out-Null
  }
  Write-Host "profile root: removed $($present -join ', ')"
}

<#
  What an earlier build left that this one does not use: its accounts (and the profile
  directories a login gave them), its group, its firewall rules and its decoy home. Setup
  retires them, since the new accounts replace them; -Remove takes them along with everything.
#>
function Remove-Legacy {
  Remove-Rules $legacyRules
  Remove-Accounts $legacyUsers
  Remove-Groups $legacyGroups
  Remove-Dirs @($legacyHome)
}

function Remove-Everything {
  # Grants first, while every account name still resolves; the root grant before the curated
  # set, since an inheritable root entry is what the set's entries would otherwise re-inherit.
  Clear-ProfileRootGrants
  Set-ConfigAccess -Revoke
  Clear-PrivateDirs
  # Entries an earlier build stamped on individual files with /T: the slow walk it always was,
  # so it is offered rather than assumed.
  if ($RemoveLegacyProfileGrant -and (Test-Path $UserProfile)) {
    Write-Host "removing per-file legacy grants (this walks the whole profile; slow)..."
    foreach ($who in @($GroupName) + $allUsers + $legacyGroups + $legacyUsers) {
      & icacls $UserProfile /remove:g $who /T /C /Q 2>$null | Out-Null
    }
    Write-Host "removed per-file legacy grants under $UserProfile"
  }
  Remove-Rules (@($firewallRules.Values | ForEach-Object { $_ }) + $legacyRules)
  Remove-Accounts ($allUsers + $legacyUsers)
  Remove-Groups (@($GroupName) + $legacyGroups)
  Remove-Dirs @($tempDir, $legacyHome)
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
  # ALSO the built-in Users group, and without it nothing runs at all: an account in no group
  # holds no logon right, so CreateProcessWithLogonW refuses it with ACCESS_DENIED (Win32 5),
  # and it could not read System32 or Program Files to start a shell even if it logged on.
  # Users is what makes it an ordinary local account — the floor every confined command needs.
  if (-not (Get-LocalGroupMember -Group 'Users' -Member $Name -ErrorAction SilentlyContinue)) {
    Add-LocalGroupMember -Group 'Users' -Member $Name -ErrorAction SilentlyContinue
    Write-Host "account ${Name}: added to Users"
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

<#
  The curated read set: the profile root (so a command can traverse and list it), every FILE
  directly in it (.gitconfig, .npmrc, .bashrc and friends), and the config directories above.
  Each target is tiny, so this finishes in seconds no matter how large the profile is — the
  opposite of `icacls $UserProfile /T`, which stamps every cache file a developer owns.

  The profile ROOT is granted WITHOUT inheritance flags, and that is the load-bearing detail.
  An inheritable ACE on the root makes Windows propagate it to every existing child — the whole
  million-file tree — even with no /T. Measured here: minutes of CPU and still going. Without the
  flags the ACE applies to the directory object alone, which is all a command needs to traverse
  and list `~`; the files it must actually READ are granted one by one just below.
#>
function Set-ConfigAccess([switch] $Revoke) {
  if (-not (Test-Path -LiteralPath $UserProfile)) {
    Write-Host "profile ${UserProfile}: not found; skipped (a confined command may not read ~)."
    return
  }
  $targets = @()
  # The root: traverse and list only, NEVER inheritable (see the note above).
  $targets += [pscustomobject]@{ Path = $UserProfile; Inherit = $false; Recurse = $false }
  foreach ($file in (Get-ChildItem -LiteralPath $UserProfile -File -Force -ErrorAction SilentlyContinue)) {
    # The registry hive and its transaction logs: yours alone, whatever else is granted.
    if ($file.Name -like 'ntuser*') { continue }
    $targets += [pscustomobject]@{ Path = $file.FullName; Inherit = $false; Recurse = $false }
  }
  foreach ($rel in $ConfigDirs) {
    $dir = Join-Path $UserProfile $rel
    if (Test-Path -LiteralPath $dir) {
      # Small by construction, so inheritance here propagates over a handful of files.
      $targets += [pscustomobject]@{ Path = $dir; Inherit = $true; Recurse = $true }
    }
  }
  foreach ($target in $targets) {
    $arguments = @($target.Path)
    if ($Revoke) {
      foreach ($who in @($GroupName, $FullOnlineUser, $FullOfflineUser)) {
        $arguments += @('/remove:g', $who)
      }
    } elseif ($target.Inherit) {
      $arguments += @('/grant', "${GroupName}:(OI)(CI)(RX)")
      $arguments += @('/grant', "${FullOnlineUser}:(OI)(CI)(M)")
      $arguments += @('/grant', "${FullOfflineUser}:(OI)(CI)(M)")
    } else {
      $arguments += @('/grant', "${GroupName}:(RX)")
      $arguments += @('/grant', "${FullOnlineUser}:(M)")
      $arguments += @('/grant', "${FullOfflineUser}:(M)")
    }
    if ($target.Recurse) { $arguments += '/T' }
    $arguments += @('/C', '/Q')
    & icacls @arguments 2>$null | Out-Null
  }
  $verb = if ($Revoke) { 'revoked on' } else { 'granted read (modify for full access) on' }
  Write-Host "profile config: $verb $($targets.Count) paths under $UserProfile"
}

<#
  What on a private directory names a sandbox account: our current and earlier account and group
  names, and a bare SID of a LOCAL account on this machine — an account an earlier -Remove
  already deleted leaves its entries behind as an unresolvable SID, and on ~/.ssh that is the same
  "Bad permissions" as a named one. Only this machine's own account SIDs, never yours: a domain
  account can show as a bare SID merely because its domain is unreachable.
#>
function Get-SandboxEntries([string] $Dir, [string[]] $Principals) {
  $listing = (& icacls $Dir /T /C 2>$null) -join "`n"
  $found = @($Principals | Where-Object { $listing -match [regex]::Escape("\${_}:") })
  $machineSid = (Get-LocalUser | Select-Object -First 1).SID.AccountDomainSid.Value
  $me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  foreach ($match in [regex]::Matches($listing, '(?m)\s(S-1-5-21-[0-9-]+):')) {
    $sid = $match.Groups[1].Value
    if ($machineSid -and $sid.StartsWith("$machineSid-") -and $sid -ne $me) {
      $found += "*$sid"
    }
  }
  return @($found | Select-Object -Unique)
}

<#
  Takes every sandbox account off the private directories, so OpenSSH accepts ~/.ssh again
  ("Bad permissions ... on file ~/.ssh/config" is what a leftover grant looks like). Explicit
  grants go first. An INHERITED one — an earlier build granted the whole profile with
  inheritance — cannot be removed where it lands, so the directory then stops inheriting
  (keeping copies of everything else it inherited) and the copies naming a sandbox account are
  removed; that is the shape OpenSSH's own guidance gives ~/.ssh. Small directories, and a clean
  one costs a single listing. Runs before -Remove deletes the accounts, while names still resolve.
#>
function Clear-PrivateDirs {
  $principals = @($GroupName) + $allUsers + $legacyGroups + $legacyUsers
  foreach ($rel in $PrivateDirs) {
    $dir = Join-Path $UserProfile $rel
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    $entries = Get-SandboxEntries $dir $principals
    if ($entries.Count -eq 0) {
      Write-Host "${dir}: no sandbox account has access"
      continue
    }
    foreach ($who in $entries) {
      & icacls $dir /remove:g $who /T /C /Q 2>$null | Out-Null
    }
    $inherited = Get-SandboxEntries $dir $principals
    if ($inherited.Count -gt 0) {
      & icacls $dir /inheritance:d /C /Q 2>$null | Out-Null
      foreach ($who in $inherited) {
        & icacls $dir /remove:g $who /T /C /Q 2>$null | Out-Null
      }
    }
    $left = Get-SandboxEntries $dir $principals
    if ($left.Count -gt 0) {
      Write-Warning "${dir}: could not remove $($left -join ', '); run: icacls `"$dir`" /remove:g <name> /T"
    } else {
      Write-Host "${dir}: removed sandbox access ($($entries -join ', '))"
    }
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

# What earlier builds left comes off first: an inheritable root grant (before the curated set
# is granted, or the set would inherit it again), then the accounts it named.
Clear-ProfileRootGrants
Remove-Legacy

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

Set-ConfigAccess -Revoke:$false
Clear-PrivateDirs

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

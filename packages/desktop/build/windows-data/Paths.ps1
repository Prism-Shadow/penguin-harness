# Windows PowerShell 5.1. Compare actual volumes, including a second drive letter
# for the same directory. GetFullPath alone cannot detect that case.
# The NSIS plugin directory also contains a native System.dll. Compile against the
# current PowerShell process's .NET Framework assemblies in their own directory.
$framework = [Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
$savedDirectory = [Environment]::CurrentDirectory
Push-Location -LiteralPath $framework
try {
[Environment]::CurrentDirectory = $framework
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.ComponentModel;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class PenguinVolume {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security,
    uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern uint GetFinalPathNameByHandle(SafeFileHandle file, StringBuilder result, uint length, uint flags);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool MoveFileEx(string from, string to, uint flags);
  public static string Existing(string path) {
    using (var f=CreateFile(path, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero)) {
      if (f.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error(), path);
      var result=new StringBuilder(32768);
      var n=GetFinalPathNameByHandle(f,result,(uint)result.Capacity,1);
      if (n==0 || n>=result.Capacity) throw new Win32Exception(Marshal.GetLastWin32Error(),path);
      return result.ToString().TrimEnd('\\');
    }
  }
  public static string Hash(string file) {
    using (var h=CreateFile(file,0x80000000,1,IntPtr.Zero,3,0x08000000,IntPtr.Zero)) {
      if (h.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error(),file);
      using(var stream=new FileStream(h,FileAccess.Read))
      using(var sha=System.Security.Cryptography.SHA256.Create())
        return Convert.ToBase64String(sha.ComputeHash(stream));
    }
  }
  public static void Publish(string from,string to) {
    if (!MoveFileEx(from,to,9)) throw new Win32Exception(Marshal.GetLastWin32Error(),to);
  }
}
'@
} finally {
  [Environment]::CurrentDirectory = $savedDirectory
  Pop-Location
}

function Full-Directory([string]$Path) {
  if ($Path -notmatch '^[A-Za-z]:[\\/]' -or $Path.Substring(2) -match '[:*?"<>|\x00-\x1f]') {
    throw "Select an absolute local drive directory: $Path"
  }
  foreach ($name in $Path.Substring(3).Split([char[]]'\/')) {
    if ($name -in @('.','..') -or $name -match '[. ]$|^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])($|\.)') {
      throw "Select a directory with ordinary Windows names: $Path"
    }
  }
  $full = [IO.Path]::GetFullPath($Path.Replace('/','\'))
  if ($full.Length -gt 3) { $full = $full.TrimEnd('\') }
  return $full
}

function Physical-Directory([string]$Path) {
  $current = Full-Directory $Path
  $tail = ''
  while (![IO.Directory]::Exists($current)) {
    if ([IO.File]::Exists($current)) { throw "A file occupies this directory: $current" }
    $parent = [IO.Path]::GetDirectoryName($current)
    if (!$parent) { throw "Drive unavailable: $Path" }
    $tail = '\' + [IO.Path]::GetFileName($current) + $tail
    $current = $parent
  }
  return ([PenguinVolume]::Existing($current) + $tail)
}

function Contains-Directory([string]$Parent, [string]$Child) {
  return $Child.Equals($Parent,[StringComparison]::OrdinalIgnoreCase) -or
    $Child.StartsWith($Parent.TrimEnd('\') + '\',[StringComparison]::OrdinalIgnoreCase)
}

function Assert-Separate([string]$First, [string]$Second) {
  $left = Physical-Directory $First
  $right = Physical-Directory $Second
  if ((Contains-Directory $left $right) -or (Contains-Directory $right $left)) {
    throw "Choose separate program and data directories. These paths overlap: $First and $Second"
  }
}

function Assert-NoRedirect([string]$Path) {
  $current = Full-Directory $Path
  while ($current) {
    if (Test-Path -LiteralPath $current) {
      $attr = [IO.File]::GetAttributes($current)
      if ($attr -band [IO.FileAttributes]::ReparsePoint) { throw "Choose a directory without redirected ancestors: $current" }
    }
    $current = [IO.Path]::GetDirectoryName($current)
  }
}

function Write-AtomicText([string]$Path,[string]$Value,[Text.Encoding]$Encoding) {
  $tmp = "$Path.$([Guid]::NewGuid()).tmp"
  try {
    $stream = [IO.File]::Open($tmp,'CreateNew','Write','None')
    try {
      $bom = $Encoding.GetPreamble()
      $body = $Encoding.GetBytes($Value)
      $stream.Write($bom,0,$bom.Length)
      $stream.Write($body,0,$body.Length)
      $stream.Flush($true)
    } finally { $stream.Dispose() }
    [PenguinVolume]::Publish($tmp,$Path)
  } finally { if ([IO.File]::Exists($tmp)) { [IO.File]::Delete($tmp) } }
}

function New-PrivateDirectory([string]$Path) {
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true,$false)
  $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
  foreach ($sid in @($owner, [Security.Principal.SecurityIdentifier]'S-1-5-18', [Security.Principal.SecurityIdentifier]'S-1-5-32-544')) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule)
  }
  [void][IO.Directory]::CreateDirectory($Path,$acl)
  # Fail before copying private files if the volume cannot enforce a per-user ACL.
  if (!(Get-Acl -LiteralPath $Path).AreAccessRulesProtected) { throw "The destination must support Windows file permissions: $Path" }
}

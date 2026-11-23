# A legacy uninstaller removes its entire target. Establish that a custom
# installation still contains only the program before starting that executable.
param(
    [Parameter(Mandatory)][string]$ProgramDirectory,
    [Parameter(Mandatory)][string]$Inventory,
    [Parameter(Mandatory)][string]$Uninstaller,
    [string]$Version
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($ProgramDirectory).TrimEnd('\')
if (!$root -or $root -eq [IO.Path]::GetPathRoot($root).TrimEnd('\')) { exit 2 }
for ($ancestor = [IO.DirectoryInfo]::new($root); $ancestor; $ancestor = $ancestor.Parent) {
    if ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { exit 2 }
}
$expected = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($line in [IO.File]::ReadLines($Inventory)) {
    [void]$expected.Add("F`t$line")
    for ($parent = [IO.Path]::GetDirectoryName($line); $parent; $parent = [IO.Path]::GetDirectoryName($parent)) {
        [void]$expected.Add("D`t$parent")
    }
}
$actual = [Collections.Generic.List[string]]::new()
$pending = [Collections.Generic.Stack[string]]::new()
$pending.Push($root)
while ($pending.Count) {
    foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($pending.Pop())) {
        $relative = $entry.Substring($root.Length + 1)
        $attributes = [IO.File]::GetAttributes($entry)
        if ($attributes -band [IO.FileAttributes]::ReparsePoint) { exit 2 }
        if ($attributes -band [IO.FileAttributes]::Directory) {
            $actual.Add("D`t" + $relative.ToLowerInvariant())
            $pending.Push($entry)
        } elseif ($relative -ne $Uninstaller) {
            $actual.Add("F`t" + $relative.ToLowerInvariant())
        }
    }
}
if ($Version -eq '0.2.18') {
    # Official v0.2.18 Windows x64 installer, SHA256 63cee08ac190f9b37e51283afc752179467ceddace81a18a8fe5420eccdba47f.
    # Its app-64.7z paths, with D/F and a tab, lowercase and sorted ordinally.
    # The stock uninstaller is installed separately from that archive.
    $actual.Sort([StringComparer]::Ordinal)
    $bytes = [Text.Encoding]::UTF8.GetBytes([string]::Join("`n", $actual))
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $digest = [BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-', '') }
    finally { $hash.Dispose() }
    if ($digest -eq '5a8f29241d778436d4063678850529a806ae3aef9d1bef9c47b8bdca84e743be') { exit 0 }
}
if ($expected.SetEquals($actual)) { exit 0 }
exit 2

# Only paths in the list compiled into this uninstaller may be removed. On update,
# move them aside first so a sharing violation can leave the old program intact.
param(
    [Parameter(Mandatory)][string]$ProgramDirectory,
    [Parameter(Mandatory)][string]$Inventory,
    [string]$BackupDirectory
)
$ErrorActionPreference = 'Stop'
$directory = [IO.Path]::GetFullPath($ProgramDirectory).TrimEnd('\')
if (!$directory -or $directory -eq [IO.Path]::GetPathRoot($directory).TrimEnd('\')) {
    throw 'A drive or share root cannot be removed.'
}
# Check each directory once, including paths above a custom destination. A
# junction can be retargeted after installation, so it cannot authorize removal.
$checked = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$parents = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
function Assert-Directory([string]$current) {
    if (!$current -or !$checked.Add($current)) { return }
    $parent = [IO.Directory]::GetParent($current)
    if ($parent) { Assert-Directory $parent.FullName }
    if ([IO.Directory]::Exists($current) -and
        ([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint)) {
        throw "The program folder is a link: $current"
    }
}
Assert-Directory $directory
$moved = [Collections.Generic.List[string]]::new()
try {
    foreach ($relative in [IO.File]::ReadLines($Inventory, [Text.Encoding]::UTF8)) {
        $file = [IO.Path]::GetFullPath([IO.Path]::Combine($directory, $relative))
        if (!$file.StartsWith($directory + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Invalid program inventory.'
        }
        $parent = [IO.Path]::GetDirectoryName($file)
        Assert-Directory $parent
        while ($parent -ne $directory -and $parents.Add($parent)) {
            $parent = [IO.Path]::GetDirectoryName($parent)
        }
        if (![IO.File]::Exists($file)) { continue }
        if ($BackupDirectory) {
            $backup = [IO.Path]::Combine($BackupDirectory, $relative)
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($backup)) | Out-Null
            [IO.File]::Move($file, $backup)
            $moved.Add($relative)
        } else {
            [IO.File]::Delete($file)
        }
    }
} catch {
    foreach ($relative in $moved) {
        [IO.File]::Move([IO.Path]::Combine($BackupDirectory, $relative), [IO.Path]::Combine($directory, $relative))
    }
    throw
}
foreach ($parent in $parents | Sort-Object Length -Descending) {
    if ([IO.Directory]::Exists($parent) -and ![IO.Directory]::EnumerateFileSystemEntries($parent).GetEnumerator().MoveNext()) {
        [IO.Directory]::Delete($parent)
    }
}

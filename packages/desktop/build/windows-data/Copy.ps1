# Recursion is explicit: inspect a reparse point before opening anything below it.
# Relative names identify regular files, empty directories and in-tree links.
function Read-Tree([string]$Root,[string]$Relative = '') {
  $dir = if ($Relative) { Join-Path $Root $Relative } else { $Root }
  foreach ($item in (Get-ChildItem -LiteralPath $dir -Force)) {
    $name = if ($Relative) { Join-Path $Relative $item.Name } else { $item.Name }
    if ($name -eq 'server.lock' -and $Root -eq $script:sourceData) { continue }
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      if ($item.LinkType -notin @('Junction','SymbolicLink') -or !$item.Target) {
        throw "Unsupported reparse point: $($item.FullName)"
      }
      $link = [string]@($item.Target)[0]
      if ([IO.Path]::IsPathRooted($link)) {
        $target = Full-Directory $link
      } else {
        $target = Full-Directory ([IO.Path]::GetFullPath((Join-Path $dir $link)))
      }
      if (!(Contains-Directory $Root $target)) { throw "The link leaves the data directory: $($item.FullName)" }
      [pscustomobject]@{ Name=$name; Kind=$item.LinkType; Target=$target.Substring($Root.Length).TrimStart('\'); Directory=$item.PSIsContainer }
    } elseif ($item.PSIsContainer) {
      [pscustomobject]@{Name=$name;Kind='Directory'}
      Read-Tree $Root $name
    } else {
      # CopyFile carries the named data streams too. Verify each stream independently.
      # -Force is required because Get-ChildItem -Force enumerates Hidden files (including Hidden+System files like desktop.ini).
      $streams = @(Get-Item -LiteralPath $item.FullName -Stream '*' -Force | Sort-Object Stream | ForEach-Object {
        $file = if ($_.Stream -eq ':$DATA') { $item.FullName } else { $item.FullName + ':' + $_.Stream }
        $_.Stream + '=' + [PenguinVolume]::Hash($file)
      })
      if (!$streams.Count) { throw "Cannot verify all data streams of $($item.FullName)" }
      [pscustomobject]@{Name=$name;Kind='File';Length=$item.Length;Hash=($streams -join '|')}
    }
  }
}

function Tree-Map([string]$Root) {
  $map = @{}
  if ([IO.Directory]::Exists($Root)) {
    foreach ($row in (Read-Tree $Root)) {
      if ($map.ContainsKey($row.Name)) { throw "Case-colliding names cannot be moved: $($row.Name)" }
      $map[$row.Name] = $row
    }
  }
  return $map
}

function Copy-Tree([string]$From,[string]$To,$Map) {
  [void][IO.Directory]::CreateDirectory($To)
  foreach ($row in ($Map.Values | Sort-Object { $_.Name.Length })) {
    $output = Join-Path $To $row.Name
    if ($row.Kind -eq 'Directory') {
      [void][IO.Directory]::CreateDirectory($output)
    } elseif ($row.Kind -eq 'File') {
      [IO.File]::Copy((Join-Path $From $row.Name),$output,$false)
    }
  }
}

function Complete-Tree([string]$From,[string]$To,$Map) {
  foreach ($row in $Map.Values) {
    if ($row.Kind -in @('Junction','SymbolicLink')) {
      $where = Join-Path $To $row.Name
      $target = if ($row.Target) { Join-Path $To $row.Target } else { $To }
      # An internal link must point into the new tree, even when its source used an absolute path.
      [void](New-Item -Path $where -ItemType $row.Kind -Target $target)
    }
  }
  $actual = Tree-Map $To
  $latest = Tree-Map $From
  if ($Map.Count -ne $latest.Count -or $Map.Count -ne $actual.Count) { throw "The contents changed while moving $From" }
  foreach ($name in $Map.Keys) {
    $expected = $Map[$name] | ConvertTo-Json -Compress
    foreach ($observed in @($actual,$latest)) {
      if (!$observed.ContainsKey($name) -or ($observed[$name] | ConvertTo-Json -Compress) -cne $expected) {
        throw "File verification failed: $(Join-Path $From $name)"
      }
    }
  }
  # Start with the private staging ACL. Keep more restrictive explicit source ACLs rather
  # than granting a new disk's other users access. Apply directories last, deepest first.
  foreach ($row in ($Map.Values | Where-Object Kind -in @('File','Directory') | Sort-Object { $_.Name.Length } -Descending)) {
    $inputFile = Join-Path $From $row.Name
    $outputFile = Join-Path $To $row.Name
    $acl = Get-Acl -LiteralPath $inputFile
    $explicit = @($acl.Access | Where-Object { !$_.IsInherited })
    if ($acl.AreAccessRulesProtected -or $explicit.Count) { Set-Acl -LiteralPath $outputFile -AclObject $acl }
    if ($row.Kind -eq 'Directory') {
      [IO.Directory]::SetLastWriteTimeUtc($outputFile,[IO.Directory]::GetLastWriteTimeUtc($inputFile))
    }
  }
}

function Remove-StagingTree([string]$Path) {
  $attr = [IO.File]::GetAttributes($Path)
  if ($attr -band [IO.FileAttributes]::ReparsePoint) {
    if ($attr -band [IO.FileAttributes]::Directory) { [IO.Directory]::Delete($Path) }
    else { [IO.File]::Delete($Path) }
    return
  }
  if ($attr -band [IO.FileAttributes]::Directory) {
    foreach ($child in [IO.Directory]::EnumerateFileSystemEntries($Path)) { Remove-StagingTree $child }
    [IO.Directory]::Delete($Path)
  } else {
    if ($attr -band [IO.FileAttributes]::ReadOnly) { [IO.File]::SetAttributes($Path,$attr -bxor [IO.FileAttributes]::ReadOnly) }
    [IO.File]::Delete($Path)
  }
}

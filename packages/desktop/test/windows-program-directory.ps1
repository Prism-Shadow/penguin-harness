# Exercise the same NSIS functions as the published installer. The compiled
# path checker only compares strings; all uninstall fixtures live under TEMP.
$ErrorActionPreference = 'Stop'
$build = (Resolve-Path (Join-Path $PSScriptRoot '../build')).Path
$source = Join-Path $PSScriptRoot 'nsis/program-paths.nsi'
$temp = Join-Path ([IO.Path]::GetTempPath()) ("penguin-path-test-" + [Guid]::NewGuid())
$null = New-Item -ItemType Directory -Path $temp
try {
    $compiler = Join-Path ${env:ProgramFiles(x86)} 'NSIS/makensis.exe'
    if (!(Test-Path -LiteralPath $compiler)) {
        choco install nsis -y --no-progress
        if ($LASTEXITCODE -ne 0) { throw 'Installing the NSIS test compiler failed.' }
    }
    Copy-Item -LiteralPath $source -Destination $temp
    & $compiler /WX /V2 "/X!addincludedir `"$build`"" "$temp/program-paths.nsi"
    if ($LASTEXITCODE -ne 0) { throw 'Compiling the NSIS path checks failed.' }
    $result = Start-Process "$temp/checked-paths.exe" -Wait -PassThru
    if ($result.ExitCode -ne 0) { throw 'The program-directory contract failed.' }
    $app = Join-Path $temp 'penguinharness'
    $null = New-Item -Type Directory -Path "$app/resources" -Force
    Set-Content -LiteralPath "$app/resources/installed.txt" -Value 'program'
    Set-Content -LiteralPath "$app/resources/personal.txt" -Value 'personal'
    Set-Content -LiteralPath "$temp/neighbor.txt" -Value 'neighbor'
    Set-Content -LiteralPath "$temp/inventory.txt" -Value 'resources\installed.txt' -Encoding utf8
    & "$build/windows-remove-program.ps1" -ProgramDirectory $app -Inventory "$temp/inventory.txt" -BackupDirectory "$temp/old"
    if ((Test-Path -LiteralPath "$app/resources/installed.txt") -or
        !(Test-Path -LiteralPath "$temp/old/resources/installed.txt") -or
        (Get-Content -LiteralPath "$app/resources/personal.txt") -ne 'personal' -or
        (Get-Content -LiteralPath "$temp/neighbor.txt") -ne 'neighbor') {
        throw 'Removing the inventoried file changed an unrelated file.'
    }
    $legacy = Join-Path $temp 'custom legacy'
    $null = New-Item -Type Directory -Path "$legacy/resources" -Force
    Set-Content -LiteralPath "$legacy/resources/installed.txt" -Value 'program'
    Set-Content -LiteralPath "$legacy/Uninstall PenguinHarness.exe" -Value 'test fixture'
    $powershell = "$env:SystemRoot/System32/WindowsPowerShell/v1.0/powershell.exe"
    $check = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        "$build/windows-legacy-program.ps1", '-ProgramDirectory', $legacy,
        '-Inventory', "$temp/inventory.txt", '-Uninstaller', 'Uninstall PenguinHarness.exe')
    & $powershell @check
    if ($LASTEXITCODE -ne 0) { throw 'The dedicated legacy folder was rejected.' }
    Set-Content -LiteralPath "$legacy/resources/notes.txt" -Value 'private note'
    & $powershell @check
    if ($LASTEXITCODE -ne 2 -or (Get-Content -LiteralPath "$legacy/resources/notes.txt") -ne 'private note') {
        throw 'The old recursive uninstaller would be allowed to touch an extra file.'
    }
    $global:LASTEXITCODE = 0
} finally {
    Remove-Item -LiteralPath $temp -Recurse -Force
}

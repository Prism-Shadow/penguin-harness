!macro PHFixtureLog text
  Push $7
  FileOpen $7 "$TEMP\ph-path-diagnostics.txt" a
  FileWrite $7 "${text}$\r$\n"
  FileClose $7
  Pop $7
!macroend
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "windows-program-directory.nsh"

; The data-location contribution shares this wizard, after the program page.
!if /FileExists "${BUILD_RESOURCES_DIR}\windows-data-directory.nsh"
  !include "windows-data-directory.nsh"
!endif

; The Windows language ID for Simplified Chinese (zh-CN).
!define PH_LANG_ZH_CN 2052
Var PHPathErrorText
!macro PHPathError
  StrCpy $PHPathErrorText "Setup stopped because a program directory is invalid or points to a drive or network share root. The installation was left in place."
  StrCmp $LANGUAGE ${PH_LANG_ZH_CN} 0 +2
  StrCpy $PHPathErrorText "程序目录无效或位于磁盘或网络共享的根目录。安装已停止，原文件已保留。"
  MessageBox MB_OK|MB_ICONSTOP "$PHPathErrorText" /SD IDOK
  !insertmacro PHFixtureLog "path error; old=$0; program=$INSTDIR; oldUninstaller=$PHOldUninstaller"
  SetErrorLevel 21
  Quit
!macroend

; The old uninstaller receives InstallLocation, falling back to the parent of
; UninstallString. Check both registry views the assisted installer can remove.
!macro PHCheckOldTarget root
  ReadRegStr $0 ${root} "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $PHOldUninstaller ${root} "${UNINSTALL_REGISTRY_KEY}" UninstallString
  !ifdef UNINSTALL_REGISTRY_KEY_2
    ${If} $PHOldUninstaller == ""
      ReadRegStr $PHOldUninstaller ${root} "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
    ${EndIf}
  !endif
  ${If} $PHOldUninstaller != ""
    StrCpy $1 $PHOldUninstaller 1
    ${If} $1 == '$\"'
      StrCpy $PHOldUninstaller $PHOldUninstaller "" 1
      ${WordFind} "$PHOldUninstaller" '$\"' "+1" $PHOldUninstaller
    ${EndIf}
    ${If} $0 == ""
      ${GetParent} "$PHOldUninstaller" $0
      ${If} $0 == ""
        !insertmacro PHPathError
      ${EndIf}
    ${EndIf}
  ${EndIf}
  ${If} $0 != ""
    Push $0
    Call PHNormalizePath
    Pop $0
    Push $0
    Call PHIsRoot
    Pop $1
    ReadEnvStr $2 "USERPROFILE"
    ${If} $0 == ""
    ${OrIf} $1 != 0
    ${OrIf} $0 == "$PROGRAMFILES"
    ${OrIf} $0 == "$PROGRAMFILES64"
    ${OrIf} $0 == "$LOCALAPPDATA"
    ${OrIf} $0 == "$LOCALAPPDATA\Programs"
    ${OrIf} $0 == $2
    ${OrIf} $0 == "$APPDATA"
    ${OrIf} $0 == "$DESKTOP"
    ${OrIf} $0 == "$DOCUMENTS"
    ${OrIf} $0 == "$WINDIR"
    ${OrIf} $0 == "$SYSDIR"
    ${OrIf} $0 == "$TEMP"
      !insertmacro PHPathError
    ${EndIf}
    ; Inventory-based uninstallers protect personal files themselves. A legacy
    ; uninstaller may clear an entire custom path, even for a different destination.
    ReadRegDWORD $1 ${root} "${INSTALL_REGISTRY_KEY}" ProgramFileInventory
    ${If} $1 != 1
    ${AndIf} $PHOldUninstaller != ""
    ${AndIf} ${FileExists} "$PHOldUninstaller"
    ${AndIf} $0 != "$LOCALAPPDATA\Programs\${APP_FILENAME}"
    ${AndIf} $0 != "$PROGRAMFILES\${APP_FILENAME}"
    ${AndIf} $0 != "$PROGRAMFILES64\${APP_FILENAME}"
      InitPluginsDir
      SetOutPath "$PLUGINSDIR"
      File /oname=check-old-program.ps1 "${BUILD_RESOURCES_DIR}\windows-legacy-program.ps1"
      File /oname=program-files.txt "${BUILD_RESOURCES_DIR}\generated\program-files.txt"
      ReadRegStr $1 ${root} "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
      StrCmp $1 "0.2.18" +2
      StrCpy $1 "unknown"
      !insertmacro PHFixtureLog "inventory; old=$0; program=$INSTDIR; version=$1; name=${UNINSTALL_FILENAME}; oldUninstaller=$PHOldUninstaller"
      nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\check-old-program.ps1" -ProgramDirectory "$0" -Inventory "$PLUGINSDIR\program-files.txt" -Uninstaller "${UNINSTALL_FILENAME}" -Version "$1"'
      Pop $1
      ${If} $1 != "0"
        StrCpy $PHPathErrorText "Setup kept the old program folder at $0. Its uninstaller could remove other files. Close PenguinHarness, rename the old folder to keep it as a backup, then run Setup again and choose an empty program folder."
        StrCmp $LANGUAGE ${PH_LANG_ZH_CN} 0 +2
        StrCpy $PHPathErrorText "旧程序文件夹 $0 已保留。旧卸载器可能删除其中的其他文件。请关闭 PenguinHarness，将旧文件夹改名留作备份，再次运行安装程序并选择空的程序文件夹。"
        MessageBox MB_OK|MB_ICONSTOP "$PHPathErrorText" /SD IDOK
        !insertmacro PHFixtureLog "inventory guard failed: result=$1"
        SetErrorLevel 22
        Quit
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!ifndef BUILD_UNINSTALLER
  !include "WordFunc.nsh"

  Var PHOldUninstaller
  Var PHProgramEdit
  Var PHProgramPreview
  Var PHInvalidText

  ; The builder's assisted-installer header supplies MUI and its plugins.
  !macro PHProgramPages
  Function PHProgramPage
    ${If} ${isUpdated}
      Call PHCheckRegisteredTargets
      !ifmacrodef PHCheckExistingDataLocation
        !insertmacro PHCheckExistingDataLocation
      !endif
      Abort
    ${EndIf}
    StrCpy $0 "Program files"
    StrCpy $1 "Choose where to install PenguinHarness."
    StrCpy $2 "Program folder"
    StrCpy $3 "Browse…"
    StrCpy $4 "Installation path"
    StrCpy $PHInvalidText "Enter an absolute path on a drive or network share."
    ${If} $LANGUAGE == ${PH_LANG_ZH_CN}
      StrCpy $0 "程序文件"
      StrCpy $1 "选择安装 PenguinHarness 的位置。"
      StrCpy $2 "程序文件夹"
      StrCpy $3 "浏览…"
      StrCpy $4 "最终安装路径"
      StrCpy $PHInvalidText "请输入磁盘或网络共享上的绝对路径。"
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "$0" "$1"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      !insertmacro PHPathError
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 12u "$2"
    Pop $0
    ${NSD_CreateDirRequest} 0 15u 73% 14u "$INSTDIR"
    Pop $PHProgramEdit
    ${NSD_OnChange} $PHProgramEdit PHProgramChanged
    ${NSD_CreateButton} 75% 15u 25% 14u "$3"
    Pop $0
    ${NSD_OnClick} $0 PHProgramBrowse
    ${NSD_CreateLabel} 0 43u 100% 12u "$4"
    Pop $0
    ${NSD_CreateLabel} 0 58u 100% 35u ""
    Pop $PHProgramPreview
    Call PHProgramPreviewPath
    nsDialogs::Show
  FunctionEnd

  Function PHProgramChanged
    Pop $0
    Call PHProgramPreviewPath
  FunctionEnd

  Function PHProgramPreviewPath
    ${NSD_GetText} $PHProgramEdit $0
    Push $0
    Push "typed"
    Call PHProgramDestination
    Pop $0
    ${If} $0 == ""
      ${NSD_SetText} $PHProgramPreview "$PHInvalidText"
    ${Else}
      ${NSD_SetText} $PHProgramPreview "$0"
    ${EndIf}
  FunctionEnd

  Function PHProgramBrowse
    Pop $0
    ${NSD_GetText} $PHProgramEdit $0
    nsDialogs::SelectFolderDialog "" "$0"
    Pop $0
    ${If} $0 != error
      Push $0
      Push "browse"
      Call PHProgramDestination
      Pop $0
      ${NSD_SetText} $PHProgramEdit "$0"
    ${EndIf}
  FunctionEnd

  Function PHProgramLeave
    ${NSD_GetText} $PHProgramEdit $0
    Push $0
    Push "typed"
    Call PHProgramDestination
    Pop $0
    ${If} $0 == ""
      MessageBox MB_OK|MB_ICONEXCLAMATION "$PHInvalidText"
      Abort
    ${EndIf}
    StrCpy $INSTDIR $0
    Call PHCheckRegisteredTargets
    Call PHProgramTargetAvailable
    IfErrors 0 +2
    Abort
    !ifmacrodef PHCheckExistingDataLocation
      !insertmacro PHCheckExistingDataLocation
    !endif
  FunctionEnd
  !macroend

  ; electron-builder defines its registry keys inside the standard installer
  ; body, after this include. Emit their consumers once that header is ready.
  !macro customHeader
    !insertmacro PHProgramPages
    !ifmacrodef PHDataPageFunctions
      !insertmacro PHDataPageFunctions
    !endif
  Function PHCheckRegisteredTargets
    Push $0
    Push $1
    Push $2
    !insertmacro PHCheckOldTarget SHELL_CONTEXT
    ${If} $installMode == "all"
      !insertmacro PHCheckOldTarget HKCU
    ${EndIf}
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd

  ; A new target can be created or reused when empty. A populated directory
  ; belongs to this install only when its registered location agrees.
  Function PHProgramTargetAvailable
    Push $0
    Push $1
    Push $2
    ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    Push $0
    Call PHNormalizePath
    Pop $0
    ${If} $0 == $INSTDIR
      Goto accepted
    ${EndIf}
    FindFirst $1 $2 "$INSTDIR\*"
    ${DoWhile} $2 != ""
      ${If} $2 != "."
      ${AndIf} $2 != ".."
        FindClose $1
        StrCpy $0 "This folder already contains files. Choose an empty program folder."
        StrCmp $LANGUAGE ${PH_LANG_ZH_CN} 0 +2
        StrCpy $0 "这个文件夹已有文件，请选择一个空的程序文件夹。"
        MessageBox MB_OK|MB_ICONEXCLAMATION "$0" /SD IDOK
        Pop $2
        Pop $1
        Pop $0
        SetErrors
        Return
      ${EndIf}
      FindNext $1 $2
    ${Loop}
    FindClose $1
accepted:
    Pop $2
    Pop $1
    Pop $0
    ClearErrors
  FunctionEnd

  !macroend

  !macro customInit
    ${If} ${Silent}
      Call PHCheckRegisteredTargets
      Push $INSTDIR
      Call PHNormalizePath
      Pop $INSTDIR
      Push $INSTDIR
      Call PHIsRoot
      Pop $0
      ${If} $INSTDIR == ""
      ${OrIf} $0 != 0
        !insertmacro PHPathError
      ${EndIf}
      Call PHProgramTargetAvailable
      ${If} ${Errors}
        !insertmacro PHFixtureLog "nonempty unrecognized program directory: $INSTDIR"
        SetErrorLevel 23
        Quit
      ${EndIf}
      !ifmacrodef PHCheckExistingDataLocation
        !insertmacro PHCheckExistingDataLocation
      !endif
    ${EndIf}
  !macroend

  !macro customPageAfterChangeDir
    Page custom PHProgramPage PHProgramLeave
    !ifmacrodef PHDataPage
      !insertmacro PHDataPage
    !endif
  !macroend

  !macro customInstall
    WriteRegDWORD SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" ProgramFileInventory 1
    !ifmacrodef PHCommitDataDirectory
      !insertmacro PHCommitDataDirectory
    !endif
  !macroend

!else
  !macro PHCheckUninstallTarget
    Push $0
    Push $1
    Push $INSTDIR
    Call un.PHNormalizePath
    Pop $0
    Push $0
    Call un.PHIsRoot
    Pop $1
    ${If} $0 == ""
    ${OrIf} $1 != 0
      !insertmacro PHPathError
    ${EndIf}
    Pop $1
    Pop $0
  !macroend

  !macro customRemoveFiles
    SetOutPath "$TEMP"
    InitPluginsDir
    File /oname=$PLUGINSDIR\program-files.txt "${BUILD_RESOURCES_DIR}\generated\program-files.txt"
    File /oname=$PLUGINSDIR\remove-program.ps1 "${BUILD_RESOURCES_DIR}\windows-remove-program.ps1"
    StrCpy $0 ""
    ${If} ${isUpdated}
      StrCpy $0 '-BackupDirectory "$PLUGINSDIR\old-program"'
    ${EndIf}
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\remove-program.ps1" -ProgramDirectory "$INSTDIR" -Inventory "$PLUGINSDIR\program-files.txt" $0'
    Pop $0
    ${If} $0 != "0"
      !insertmacro PHPathError
    ${EndIf}
    Delete "$INSTDIR\${UNINSTALL_FILENAME}"
    !ifdef UNINSTALLER_ICON
      Delete "$INSTDIR\uninstallerIcon.ico"
    !endif
    RMDir "$INSTDIR"
  !macroend

  !macro customUnInit
    !insertmacro PHCheckUninstallTarget
  !macroend

  ; Changing the user/all-users mode may have replaced $INSTDIR since un.onInit.
  !macro customUnInstall
    !insertmacro PHCheckUninstallTarget
  !macroend
!endif

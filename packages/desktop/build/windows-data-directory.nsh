!ifndef BUILD_UNINSTALLER
!include "FileFunc.nsh"
Var PHDataEdit
Var PHDataKeep
Var PHDataOther
Var PHDataBrowse
Var PHDataValue
Var PHDataCurrent
Var PHDataInitialized

!macro PHDataText variable english chinese
  StrCpy ${variable} "${english}"
  StrCmp $LANGUAGE 2052 0 +2
  StrCpy ${variable} "${chinese}"
!macroend

!macro PHRunDataHelper action
  StrCpy $1 "$INSTDIR"
  StrCpy $2 "$PHDataValue"
  StrCpy $3 "${action}"
  ${If} ${UAC_IsInnerInstance}
    !insertmacro UAC_AsUser_Call Function PHDataHelper ${UAC_SYNCREGISTERS}
  ${Else}
    Call PHDataHelper
  ${EndIf}
!macroend

!macro PHCheckExistingDataLocation
  Call PHReadDataChoice
  !insertmacro PHRunDataHelper Check
  ${If} $0 != "0"
    MessageBox MB_OK|MB_ICONSTOP "$4" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend
!macro PHDataPage
  Page custom PHShowDataPage PHLeaveDataPage
!macroend

!macro PHCommitDataDirectory
  Call PHReadDataChoice
  ${If} $PHDataValue != ""
    !insertmacro PHDataText $0 "Verifying PenguinHarness data..." "正在校验 PenguinHarness 数据…"
    DetailPrint "$0"
    !insertmacro PHRunDataHelper Apply
    ${If} $0 != "0"
      DetailPrint "$4"
      MessageBox MB_OK|MB_ICONSTOP "$4" /SD IDOK
      SetErrorLevel 2
      Quit
    ${EndIf}
  ${EndIf}
!macroend
; electron-builder adds its plugin directory before it expands customHeader.
!macro PHDataPageFunctions
Function PHReadDataChoice
  ${If} $PHDataInitialized != ""
    Return
  ${EndIf}
  StrCpy $PHDataInitialized 1
  ReadEnvStr $1 "USERPROFILE"
  ClearErrors
  FileOpen $0 "$1\.penguin\windows-data-location" r
  ${IfNot} ${Errors}
    FileReadUTF16LE $0 $PHDataCurrent
    FileClose $0
  ${EndIf}
  ${GetParameters} $1
  ClearErrors
  ${GetOptions} "$1" "/DATADIR=" $PHDataValue
  ${If} ${Errors}
    StrCpy $PHDataValue ""
  ${EndIf}
  ClearErrors
FunctionEnd

; Even an all-users installation copies data as the original user. Path values
; cross UAC in NSIS registers and reach PowerShell through its own environment.
Function PHDataHelper
  InitPluginsDir
  File /oname=$PLUGINSDIR\ph-data-setup.ps1 "${BUILD_RESOURCES_DIR}\windows-data\Setup.ps1"
  File /oname=$PLUGINSDIR\Paths.ps1 "${BUILD_RESOURCES_DIR}\windows-data\Paths.ps1"
  File /oname=$PLUGINSDIR\Copy.ps1 "${BUILD_RESOURCES_DIR}\windows-data\Copy.ps1"
  System::Call 'kernel32::SetEnvironmentVariableW(w "PH_SETUP_PROGRAM", w r1)i'
  System::Call 'kernel32::SetEnvironmentVariableW(w "PH_SETUP_DATA", w r2)i'
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\ph-data-setup.ps1" -Action $3'
  Pop $0
  Pop $4
FunctionEnd

Function PHShowDataPage
  Call PHReadDataChoice
  ${If} ${isUpdated}
    Abort
  ${EndIf}
  !insertmacro PHDataText $0 "Data directory" "数据目录"
  !insertmacro PHDataText $1 "Choose where this Windows user stores PenguinHarness data." "选择当前 Windows 用户的 PenguinHarness 数据位置。"
  !insertmacro MUI_HEADER_TEXT "$0" "$1"
  nsDialogs::Create 1018
  Pop $0
  !insertmacro PHDataText $0 "Keep the current location" "保留当前位置"
  ${NSD_CreateRadioButton} 0 0 100% 14u "$0"
  Pop $PHDataKeep
  ${If} $PHDataCurrent == ""
    !insertmacro PHDataText $0 "Standard server data and desktop profile folders" "当前用户原有的服务数据与桌面配置目录"
  ${Else}
    StrCpy $0 "$PHDataCurrent"
  ${EndIf}
  ${NSD_CreateLabel} 12u 17u 96% 18u "$0"
  Pop $0
  !insertmacro PHDataText $0 "Use another data directory" "选择其他数据目录"
  ${NSD_CreateRadioButton} 0 44u 100% 14u "$0"
  Pop $PHDataOther
  ${NSD_CreateDirRequest} 12u 61u 73% 14u "$PHDataValue"
  Pop $PHDataEdit
  !insertmacro PHDataText $0 "Browse..." "浏览…"
  ${NSD_CreateButton} 77% 60u 23% 16u "$0"
  Pop $PHDataBrowse
  ${NSD_OnClick} $PHDataBrowse PHBrowseDataDirectory
  ${NSD_OnClick} $PHDataKeep PHDataModeChanged
  ${NSD_OnClick} $PHDataOther PHDataModeChanged
  !insertmacro PHDataText $0 "Server data and the desktop profile will be stored in the data and desktop subfolders. Close PenguinHarness before moving. Setup verifies the copy and keeps the originals." "服务数据和桌面配置分别保存到 data 和 desktop 子目录。迁移前请退出 PenguinHarness；安装器校验副本后才会切换，并保留原件。"
  ${NSD_CreateLabel} 0 88u 100% 42u "$0"
  Pop $0
  ${If} $PHDataValue == ""
    ${NSD_Check} $PHDataKeep
  ${Else}
    ${NSD_Check} $PHDataOther
  ${EndIf}
  Call PHDataSetControls
  nsDialogs::Show
FunctionEnd

Function PHDataModeChanged
  Pop $0
  Call PHDataSetControls
FunctionEnd
Function PHDataSetControls
  ${NSD_GetState} $PHDataOther $0
  EnableWindow $PHDataEdit $0
  EnableWindow $PHDataBrowse $0
FunctionEnd
Function PHBrowseDataDirectory
  Pop $0
  ${NSD_GetText} $PHDataEdit $1
  nsDialogs::SelectFolderDialog "" "$1"
  Pop $0
  ${If} $0 != error
    StrLen $1 $0
    ${If} $1 == 3
      StrCpy $0 "$0PenguinHarnessData"
    ${EndIf}
    ${NSD_SetText} $PHDataEdit "$0"
  ${EndIf}
FunctionEnd

Function PHLeaveDataPage
  ${NSD_GetState} $PHDataOther $0
  StrCpy $PHDataValue ""
  ${If} $0 == ${BST_CHECKED}
    ${NSD_GetText} $PHDataEdit $PHDataValue
    ${If} $PHDataValue == ""
      !insertmacro PHDataText $1 "Choose an empty data directory." "请选择一个空的数据目录。"
      MessageBox MB_OK|MB_ICONEXCLAMATION "$1"
      Abort
    ${EndIf}
    !insertmacro PHRunDataHelper Check
    ${If} $0 != "0"
      MessageBox MB_OK|MB_ICONEXCLAMATION "$4"
      Abort
    ${EndIf}
  ${EndIf}
FunctionEnd

!macroend
!endif

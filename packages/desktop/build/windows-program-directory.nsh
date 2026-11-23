!ifndef PH_PROGRAM_DIRECTORY_INCLUDED
!define PH_PROGRAM_DIRECTORY_INCLUDED

!include LogicLib.nsh
!include FileFunc.nsh

; A normalized absolute drive or UNC share path, or empty for an invalid target.
; Never convert a relative path (including "C:") using the installer's working directory.
!macro PHPathFunctions prefix
Function ${prefix}PHNormalizePath
  Exch $0
  Push $1
  Push $2
  StrCpy $1 $0 2
  ${If} $1 == "\\"
    StrCpy $1 $0 4
    ${If} $1 == "\\?\"
    ${OrIf} $1 == "\\.\"
      Goto invalid
    ${EndIf}
    System::Call 'shlwapi::PathIsUNCServerW(w r0) i.r1'
    ${If} $1 != 0
      Goto invalid
    ${EndIf}
  ${Else}
    StrCpy $1 $0 2 1
    StrCmp $1 ":\" +2
    Goto invalid
  ${EndIf}
  System::Call 'kernel32::GetFullPathNameW(w r0, i ${NSIS_MAX_STRLEN}, w .r1, p 0) i.r2'
  ${If} $2 == 0
  ${OrIf} $2 >= ${NSIS_MAX_STRLEN}
    Goto invalid
  ${EndIf}
  StrCpy $0 $1
  ; Retain the separator in a drive root but trim it on shares and ordinary paths.
  StrLen $2 $0
  ${If} $2 > 3
    StrCpy $1 $0 1 -1
    ${If} $1 == "\"
      StrCpy $0 $0 -1
    ${EndIf}
  ${EndIf}
  Goto done
invalid:
  StrCpy $0 ""
done:
  Pop $2
  Pop $1
  Exch $0
FunctionEnd

; Input is a normalized path. Both Windows root forms need an owned child directory.
Function ${prefix}PHIsRoot
  Exch $0
  Push $1
  System::Call 'shlwapi::PathIsRootW(w r0) i.r1'
  ${If} $1 == 0
    System::Call 'shlwapi::PathIsUNCServerShareW(w r0) i.r1'
  ${EndIf}
  StrCpy $0 $1
  Pop $1
  Exch $0
FunctionEnd
!macroend

!ifdef BUILD_UNINSTALLER
  !insertmacro PHPathFunctions "un."
!else
  !insertmacro PHPathFunctions ""

; Input: path and whether it came from Browse. Output: final program path.
Function PHProgramDestination
  Exch $1
  Exch 1
  Exch $0
  Push $2
  Push $0
  Call PHNormalizePath
  Pop $0
  ${If} $0 != ""
    Push $0
    Call PHIsRoot
    Pop $2
    ${If} $2 != 0
      StrCpy $2 $0 1 -1
      ${If} $2 == "\"
        StrCpy $0 "$0penguinharness"
      ${Else}
        StrCpy $0 "$0\penguinharness"
      ${EndIf}
    ${ElseIf} $1 == "browse"
      ${GetFileName} "$0" $2
      ${If} $2 != "penguinharness"
        StrCpy $0 "$0\penguinharness"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $2
  Exch $0
  Exch 1
  Pop $1
FunctionEnd
!endif
!endif

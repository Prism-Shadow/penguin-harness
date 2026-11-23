Unicode true
Name "PenguinHarness path contract"
OutFile "checked-paths.exe"
RequestExecutionLevel user
SilentInstall silent
!include "windows-program-directory.nsh"

!macro ExpectTarget input mode expected
  Push "${input}"
  Push "${mode}"
  Call PHProgramDestination
  Pop $0
  StrCmp $0 "${expected}" +3
  SetErrorLevel 1
  Quit
!macroend

Section
  !insertmacro ExpectTarget "D:\" "browse" "D:\penguinharness"
  !insertmacro ExpectTarget "D:\Apps" "browse" "D:\Apps\penguinharness"
  !insertmacro ExpectTarget "D:\PenguinHarness\" "browse" "D:\PenguinHarness"
  !insertmacro ExpectTarget "D:\Apps\PenguinHarness Tools\中文" "browse" "D:\Apps\PenguinHarness Tools\中文\penguinharness"
  !insertmacro ExpectTarget "D:\Apps\..\." "typed" "D:\penguinharness"
  !insertmacro ExpectTarget "D:\Apps\Chosen" "typed" "D:\Apps\Chosen"
  !insertmacro ExpectTarget "\\server\share\" "typed" "\\server\share\penguinharness"
  !insertmacro ExpectTarget "\\server\share" "browse" "\\server\share\penguinharness"
  !insertmacro ExpectTarget "\\server\share\PenguinHarness" "browse" "\\server\share\PenguinHarness"
  !insertmacro ExpectTarget "\\server" "typed" ""
  !insertmacro ExpectTarget "D:relative" "typed" ""
  !insertmacro ExpectTarget "relative" "typed" ""
  !insertmacro ExpectTarget "\\?\D:\" "typed" ""
SectionEnd

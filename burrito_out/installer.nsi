; NSIS Installer Script with VC++ 2015-2022 Redistributable Check
; Modern UI and x64 support
; makensis installer.nsi in dir
!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"

; Installer Configuration
Name "PaperLand Dojo"
OutFile "PaperLandInstaller.exe"
InstallDir "$PROGRAMFILES64\PaperLand Dojo"
InstallDirRegKey HKLM "Software\PaperLand Dojo" "InstallDir"
RequestExecutionLevel admin

; UI Configuration
!define MUI_ABORTWARNING
!define MUI_ICON "resources/app-icon.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "resources/banner.bmp"
!define MUI_HEADERIMAGE_BITMAP_NOSTRETCH

;!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"

!define MUI_WELCOMEFINISHPAGE_BITMAP "resources/dialog.bmp"
;!define MUI_WELCOMEFINISHPAGE_BITMAP_NOSTRETCH

!define MUI_FINISHPAGE_RUN "$INSTDIR\dojo_windows.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Enter PaperLand"
!define MUI_FINISHPAGE_RUN_NOTCHECKED


; Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "resources/license.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; VC++ Registry Keys for Detection
; These cover all versions from 2015-2022 (v14.x)
!define VCREDIST_X64_KEY "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64"
;!define VCREDIST_X86_KEY "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x86"

; Minimum required version (14.0 = VC++ 2015)
!define MIN_VCREDIST_VERSION_MAJOR 14
!define MIN_VCREDIST_VERSION_MINOR 0

Var VCRedistNeeded
Var VCRedistArch

;--------------------------------
; Function: CheckVCRedist
; Checks if Visual C++ Redistributable is installed and meets minimum version
;--------------------------------
Function CheckVCRedist
    SetRegView 64
    StrCpy $VCRedistNeeded "0"
    StrCpy $VCRedistArch ""
    
    ${If} ${RunningX64}
        DetailPrint "Checking for VC++ Redistributable (x64)..."
        
        ; Check x64 version
        ReadRegDWORD $0 HKLM "${VCREDIST_X64_KEY}" "Installed"
        ${If} $0 == 1
            ReadRegDWORD $1 HKLM "${VCREDIST_X64_KEY}" "Major"
            ReadRegDWORD $2 HKLM "${VCREDIST_X64_KEY}" "Minor"
            ReadRegDWORD $3 HKLM "${VCREDIST_X64_KEY}" "Bld"
            
            DetailPrint "Found VC++ x64: $1.$2.$3"
            
            ; Check if version meets minimum requirement
            ${If} $1 < ${MIN_VCREDIST_VERSION_MAJOR}
                StrCpy $VCRedistNeeded "1"
                StrCpy $VCRedistArch "x64"
                DetailPrint "VC++ x64 version too old, installation required"
            ${ElseIf} $1 == ${MIN_VCREDIST_VERSION_MAJOR}
                ${If} $2 < ${MIN_VCREDIST_VERSION_MINOR}
                    StrCpy $VCRedistNeeded "1"
                    StrCpy $VCRedistArch "x64"
                    DetailPrint "VC++ x64 version too old, installation required"
                ${Else}
                    DetailPrint "VC++ x64 is up to date"
                ${EndIf}
            ${Else}
                DetailPrint "VC++ x64 is up to date"
            ${EndIf}
        ${Else}
            StrCpy $VCRedistNeeded "1"
            StrCpy $VCRedistArch "x64"
            DetailPrint "VC++ x64 not found, installation required"
        ${EndIf}
    ; ${Else}
    ;     DetailPrint "Checking for VC++ Redistributable (x86)..."
        
    ;     ; Check x86 version on 32-bit system
    ;     SetRegView 32
    ;     ReadRegDWORD $0 HKLM "${VCREDIST_X86_KEY}" "Installed"
    ;     ${If} $0 == 1
    ;         ReadRegDWORD $1 HKLM "${VCREDIST_X86_KEY}" "Major"
    ;         ReadRegDWORD $2 HKLM "${VCREDIST_X86_KEY}" "Minor"
    ;         ReadRegDWORD $3 HKLM "${VCREDIST_X86_KEY}" "Bld"
            
    ;         DetailPrint "Found VC++ x86: $1.$2.$3"
            
    ;         ${If} $1 < ${MIN_VCREDIST_VERSION_MAJOR}
    ;             StrCpy $VCRedistNeeded "1"
    ;             StrCpy $VCRedistArch "x86"
    ;             DetailPrint "VC++ x86 version too old, installation required"
    ;         ${ElseIf} $1 == ${MIN_VCREDIST_VERSION_MAJOR}
    ;             ${If} $2 < ${MIN_VCREDIST_VERSION_MINOR}
    ;                 StrCpy $VCRedistNeeded "1"
    ;                 StrCpy $VCRedistArch "x86"
    ;                 DetailPrint "VC++ x86 version too old, installation required"
    ;             ${Else}
    ;                 DetailPrint "VC++ x86 is up to date"
    ;             ${EndIf}
    ;         ${Else}
    ;             DetailPrint "VC++ x86 is up to date"
    ;         ${EndIf}
    ;     ${Else}
    ;         StrCpy $VCRedistNeeded "1"
    ;         StrCpy $VCRedistArch "x86"
    ;         DetailPrint "VC++ x86 not found, installation required"
    ;     ${EndIf}
    ;
    ${EndIf}
FunctionEnd

;--------------------------------
; Function: InstallVCRedist
; Installs the Visual C++ Redistributable
;--------------------------------
Function InstallVCRedist
    ${If} $VCRedistNeeded == "1"
        DetailPrint "Installing Visual C++ 2015-2022 Redistributable ($VCRedistArch)..."
        
        ${If} $VCRedistArch == "x64"
            ; Extract and install x64 redistributable
            SetOutPath "$TEMP"
            File "resources/vc_redist.x64.exe"
            
            ; Install with silent mode, no restart, and wait for completion
            DetailPrint "Executing: $TEMP\vc_redist.x64.exe /install /quiet /norestart"
            ExecWait '"$TEMP\vc_redist.x64.exe" /install /quiet /norestart' $0
            
            Delete "$TEMP\vc_redist.x64.exe"
        ; ${Else}
        ;     ; Extract and install x86 redistributable
        ;     SetOutPath "$TEMP"
        ;     File "resources/vc_redist.x86.exe"
            
        ;     DetailPrint "Executing: $TEMP\vc_redist.x86.exe /install /quiet /norestart"
        ;     ExecWait '"$TEMP\vc_redist.x86.exe" /install /quiet /norestart' $0
            
        ;     Delete "$TEMP\vc_redist.x86.exe"
        ${EndIf}
        
        ; Check return code
        ${If} $0 == 0
            DetailPrint "VC++ Redistributable installed successfully"
        ${ElseIf} $0 == 3010
            DetailPrint "VC++ Redistributable installed (reboot required)"
            SetRebootFlag true
        ${ElseIf} $0 == 1638
            DetailPrint "VC++ Redistributable already installed (newer version)"
        ${Else}
            DetailPrint "VC++ Redistributable installation returned code: $0"
            MessageBox MB_ICONEXCLAMATION|MB_OK "Visual C++ Redistributable installation completed with code $0.$\r$\nThe application may not work correctly."
        ${EndIf}
    ${Else}
        DetailPrint "VC++ Redistributable check passed, no installation needed"
    ${EndIf}
FunctionEnd

;--------------------------------
; Main Installation Section
;--------------------------------
Section "MainSection" SEC01
    ; Check and install VC++ if needed
    Call CheckVCRedist
    Call InstallVCRedist
    
    ; Set output path and install your files
    SetOutPath "$INSTDIR"
    
    ; Install your batch file and other application files
    File "dojo_windows.exe"
    File "app-icon.ico"   ; Installs the icon file
    ; File "other_files.exe"
    ; File /r "data\*.*"
    
    ; Create uninstaller
    WriteUninstaller "$INSTDIR\Uninstall.exe"
    
    ; Write registry keys for Add/Remove Programs
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PaperLand Dojo" "DisplayName" "PaperLand Dojo"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PaperLand Dojo" "UninstallString" "$INSTDIR\Uninstall.exe"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PaperLand Dojo" "DisplayIcon" "$INSTDIR\app-icon.ico"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PaperLand Dojo" "Publisher" "PaperLand"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PaperLand Dojo" "DisplayVersion" "1.0"
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PaperLand Dojo" "NoModify" 1
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PaperLand Dojo" "NoRepair" 1
    
    ; Store installation directory
    WriteRegStr HKLM "Software\PaperLand Dojo" "InstallDir" "$INSTDIR"
    
    ; Create Start Menu shortcut
    CreateDirectory "$SMPROGRAMS\PaperLand Dojo"
    CreateShortCut "$SMPROGRAMS\PaperLand Dojo\PaperLand Dojo.lnk" "$INSTDIR\dojo_windows.exe" "" "$INSTDIR\app-icon.ico" 0
    CreateShortCut "$SMPROGRAMS\PaperLand Dojo\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
    CreateShortCut "$DESKTOP\PaperLand Dojo.lnk" "$INSTDIR\dojo_windows.exe" "" "$INSTDIR\app-icon.ico" 0
    DetailPrint "Installation completed successfully"
SectionEnd

;--------------------------------
; Uninstaller Section
;--------------------------------
Section "Uninstall"
    ; Remove files
    Delete "$INSTDIR\dojo_windows.exe"
    Delete "$INSTDIR\Uninstall.exe"
    Delete "$INSTDIR\app-icon.ico"
    ; Delete "$INSTDIR\other_files.exe"
    ; RMDir /r "$INSTDIR\data"
    
    RMDir "$INSTDIR"
    
    ; Remove Start Menu shortcuts
    Delete "$SMPROGRAMS\PaperLand Dojo\PaperLand Dojo.lnk"
    Delete "$SMPROGRAMS\PaperLand Dojo\Uninstall.lnk"
    RMDir "$SMPROGRAMS\PaperLand Dojo"
    Delete "$DESKTOP\PaperLand Dojo.lnk"
    ; Remove registry keys
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PaperLand Dojo"
    DeleteRegKey HKLM "Software\PaperLand Dojo"
    
    DetailPrint "Uninstallation completed"
SectionEnd

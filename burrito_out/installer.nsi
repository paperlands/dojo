; NSIS Installer Script with VC++ 2015-2022 Redistributable Check
; Modern UI and x64 support
; makensis installer.nsi in dir
;
; ── Code Signing ──────────────────────────────────────────────────────────
; Both dojo_windows.exe AND the final PaperLandInstaller.exe must be signed
; to avoid SmartScreen "Unknown Publisher" warnings. Sign the exe BEFORE
; running makensis, then sign the installer AFTER:
;
;   osslsigncode sign -certs cert.pem -key key.pem \
;     -n "PaperLand Dojo" -t http://timestamp.digicert.com \
;     -in dojo_windows.exe -out dojo_windows_signed.exe
;   mv dojo_windows_signed.exe dojo_windows.exe
;   makensis installer.nsi
;   osslsigncode sign -certs cert.pem -key key.pem \
;     -n "PaperLand Dojo" -t http://timestamp.digicert.com \
;     -in PaperLandInstaller.exe -out PaperLandInstaller_signed.exe
;
; Cheapest SmartScreen bypass options (2025):
;   - Azure Trusted Signing (~$10/month) — immediate reputation
;   - SignPath.io — free EV signing for open-source projects
;   - OV cert from Sectigo/DigiCert (~$100-300/year) — reputation builds over time
; ──────────────────────────────────────────────────────────────────────────

!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"

; Installer Configuration
Name "PaperLand Dojo"
OutFile "PaperLandInstaller.exe"
InstallDir "$PROGRAMFILES64\PaperLand Dojo"
InstallDirRegKey HKLM "Software\PaperLand Dojo" "InstallDir"
RequestExecutionLevel admin

; App version — keep in sync with mix.exs
!define APP_VERSION "0.3"

; Firewall rule names (used in both install and uninstall)
!define FW_RULE_APP  "PaperLand Dojo"
!define FW_RULE_MDNS "PaperLand Dojo mDNS"

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

!define MUI_FINISHPAGE_RUN "wscript.exe"
!define MUI_FINISHPAGE_RUN_PARAMETERS '"$INSTDIR\launch.vbs"'
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
; Function: .onInit
; Runs before the installer UI — stops any running instance so the exe isn't locked.
;--------------------------------
Function .onInit
    ; Silent kill — if not running, taskkill exits non-zero silently
    nsExec::Exec 'taskkill /f /im dojo_windows.exe'
FunctionEnd

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
    
    ; Install application files
    File "dojo_windows.exe"
    File "app-icon.ico"
    File "resources/splash.html"

    ; Create a VBScript launcher that:
    ;   1. Opens splash.html in the default browser (instant feedback)
    ;   2. Launches dojo_windows.exe hidden (Burrito + BEAM boot ~30s)
    ;   3. Forwards DOJO_DEBUG env var as ?debug=1 query param
    ; The splash page polls localhost:4000 and redirects to /welcome when ready.
    ; DOJO_SPLASH=1 tells the Elixir side not to open a duplicate browser tab.
    FileOpen $0 "$INSTDIR\launch.vbs" w
    FileWrite $0 'Set WshShell = CreateObject("WScript.Shell")$\r$\n'
    FileWrite $0 'Set env = WshShell.Environment("Process")$\r$\n'
    FileWrite $0 'env("DOJO_SPLASH") = "0"$\r$\n'
    FileWrite $0 '$\r$\n'
    FileWrite $0 'Set sysEnv = WshShell.Environment("System")$\r$\n'
    FileWrite $0 'If sysEnv("DOJO_DEBUG") = "1" Then$\r$\n'
    FileWrite $0 '  WshShell.Run """$INSTDIR\splash.html?debug=1""", 1, False$\r$\n'
    FileWrite $0 '  WshShell.Run """$INSTDIR\dojo_windows.exe""", 1, False$\r$\n'
    FileWrite $0 'Else$\r$\n'
    FileWrite $0 '  WshShell.Run """$INSTDIR\splash.html""", 1, False$\r$\n'
    FileWrite $0 '  WshShell.Run """$INSTDIR\dojo_windows.exe""", 0, False$\r$\n'
    FileWrite $0 'End If$\r$\n'
    FileClose $0
    
    ; Create uninstaller
    WriteUninstaller "$INSTDIR\Uninstall.exe"
    
    ; Write registry keys for Add/Remove Programs
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PaperLand Dojo" "DisplayName" "PaperLand Dojo"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PaperLand Dojo" "UninstallString" "$INSTDIR\Uninstall.exe"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PaperLand Dojo" "DisplayIcon" "$INSTDIR\app-icon.ico"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PaperLand Dojo" "Publisher" "PaperLand"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PaperLand Dojo" "DisplayVersion" "${APP_VERSION}"
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PaperLand Dojo" "NoModify" 1
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PaperLand Dojo" "NoRepair" 1
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PaperLand Dojo" "EstimatedSize" 50000
    
    ; Store installation directory
    WriteRegStr HKLM "Software\PaperLand Dojo" "InstallDir" "$INSTDIR"
    
    ; Create Start Menu and Desktop shortcuts pointing at the VBS launcher.
    ; wscript.exe runs the .vbs which hides the console window.
    CreateDirectory "$SMPROGRAMS\PaperLand Dojo"
    CreateShortCut "$SMPROGRAMS\PaperLand Dojo\PaperLand Dojo.lnk" "wscript.exe" '"$INSTDIR\launch.vbs"' "$INSTDIR\app-icon.ico" 0
    CreateShortCut "$SMPROGRAMS\PaperLand Dojo\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
    CreateShortCut "$DESKTOP\PaperLand Dojo.lnk" "wscript.exe" '"$INSTDIR\launch.vbs"' "$INSTDIR\app-icon.ico" 0

    ; ── Windows Firewall rules ──────────────────────────────────────────────
    ; profile=any ensures clustering works on Domain, Private AND Public networks.
    ; Without this, a school laptop on a "Public" WiFi would silently block peers.
    DetailPrint "Adding Windows Firewall rules..."

    ; Inbound: program-scoped rule covers HTTP (TCP 4000) and Partisan (TCP ~53527).
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${FW_RULE_APP}"'
    nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${FW_RULE_APP}" dir=in action=allow program="$INSTDIR\dojo_windows.exe" profile=any description="PaperLand Dojo — HTTP server and peer networking"'

    ; Inbound mDNS: UDP 5454 scoped to the exe, all profiles.
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${FW_RULE_MDNS}"'
    nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${FW_RULE_MDNS}" dir=in action=allow protocol=UDP localport=5454 program="$INSTDIR\dojo_windows.exe" profile=any description="PaperLand Dojo — mDNS peer discovery"'

    ; Outbound mDNS: needed on Public profile where outbound multicast may be blocked.
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${FW_RULE_MDNS} Out"'
    nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${FW_RULE_MDNS} Out" dir=out action=allow protocol=UDP remoteport=5454 program="$INSTDIR\dojo_windows.exe" profile=any description="PaperLand Dojo — mDNS multicast out"'

    DetailPrint "Installation completed successfully"
SectionEnd

;--------------------------------
; Uninstaller Section
;--------------------------------
Section "Uninstall"
    ; Stop the app if it is running so the exe isn't locked during delete
    DetailPrint "Stopping PaperLand Dojo if running..."
    nsExec::ExecToLog 'taskkill /f /im dojo_windows.exe'

    ; Remove all firewall rules added at install time
    DetailPrint "Removing Windows Firewall rules..."
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${FW_RULE_APP}"'
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${FW_RULE_MDNS}"'
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${FW_RULE_MDNS} Out"'

    ; Remove all installed files and the install directory
    RMDir /r "$INSTDIR"

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

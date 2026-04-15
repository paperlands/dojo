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
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "resources/banner.bmp"
!define MUI_HEADERIMAGE_BITMAP_NOSTRETCH
!define MUI_WELCOMEFINISHPAGE_BITMAP "resources/dialog.bmp"

; Finish page — launch checkbox is checked by default
!define MUI_FINISHPAGE_RUN "$INSTDIR\dojo_windows.exe"   ; ← required to show the checkbox
!define MUI_FINISHPAGE_RUN_TEXT "Launch PaperLand Dojo now"
!define MUI_FINISHPAGE_RUN_FUNCTION "LaunchDojo"

Function LaunchDojo
    Exec '"$INSTDIR\dojo_windows.exe"'
FunctionEnd

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

    System::Call 'kernel32::CreateMutexA(i 0, i 0, t "PaperLandDojoInstaller") i .r1 ?e'
        Pop $R0
        ${If} $R0 = 183  ; ERROR_ALREADY_EXISTS
            MessageBox MB_OK|MB_ICONEXCLAMATION \
                "The PaperLand Dojo installer is already running."
            Abort
        ${EndIf}

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

        ReadRegDWORD $0 HKLM "${VCREDIST_X64_KEY}" "Installed"
        ${If} $0 == 1
            ReadRegDWORD $1 HKLM "${VCREDIST_X64_KEY}" "Major"
            ReadRegDWORD $2 HKLM "${VCREDIST_X64_KEY}" "Minor"
            ReadRegDWORD $3 HKLM "${VCREDIST_X64_KEY}" "Bld"

            DetailPrint "Found VC++ x64: $1.$2.$3"

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
    ${EndIf}
FunctionEnd

;--------------------------------
; Function: InstallVCRedist
; Installs the Visual C++ Redistributable if needed
;--------------------------------
Function InstallVCRedist
    ${If} $VCRedistNeeded == "1"
        DetailPrint "Installing Visual C++ 2015-2022 Redistributable ($VCRedistArch)..."

        SetOutPath "$TEMP"
        File "resources/vc_redist.x64.exe"

        DetailPrint "Executing: $TEMP\vc_redist.x64.exe /install /quiet /norestart"
        ExecWait '"$TEMP\vc_redist.x64.exe" /install /quiet /norestart' $0

        Delete "$TEMP\vc_redist.x64.exe"

        ${If} $0 == 0
            DetailPrint "VC++ Redistributable installed successfully"
        ${ElseIf} $0 == 3010
            DetailPrint "VC++ Redistributable installed (reboot required)"
            SetRebootFlag true
        ${ElseIf} $0 == 1638
            DetailPrint "VC++ Redistributable already installed (newer version present)"
        ${Else}
            DetailPrint "VC++ Redistributable installation returned code: $0"
            MessageBox MB_ICONEXCLAMATION|MB_OK "Visual C++ Redistributable installation completed with code $0.$\r$\nThe application may not work correctly."
        ${EndIf}
    ${Else}
        DetailPrint "VC++ Redistributable already present, skipping"
    ${EndIf}
FunctionEnd

;--------------------------------
; Main Installation Section
;--------------------------------
Section "MainSection" SEC01
    Call CheckVCRedist
    Call InstallVCRedist

    SetOutPath "$INSTDIR"

    File "dojo_windows.exe"
    File "app-icon.ico"

    ; Create uninstaller
    WriteUninstaller "$INSTDIR\Uninstall.exe"

    ; Add/Remove Programs registry entries
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

    ; Start Menu and Desktop shortcuts
    CreateDirectory "$SMPROGRAMS\PaperLand Dojo"
    CreateShortCut "$SMPROGRAMS\PaperLand Dojo\PaperLand Dojo.lnk" "$INSTDIR\dojo_windows.exe" "" "$INSTDIR\app-icon.ico" 0
    CreateShortCut "$SMPROGRAMS\PaperLand Dojo\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
    CreateShortCut "$DESKTOP\PaperLand Dojo.lnk" "$INSTDIR\dojo_windows.exe" "" "$INSTDIR\app-icon.ico" 0

    ; ── ERTS Firewall Rules ─────────────────────────────────────────────────
    ; Covers beam.smp.exe, erl.exe, and epmd.exe so Windows never prompts.
    ; profile=any = domain + private + public networks.
    ; protocol=any = TCP + UDP in one rule (suppresses the WD dialog fully).
    ; Both dir=in and dir=out are required — inbound-only still triggers the
    ; popup on Windows 11 22H2+ for processes that also send multicast.

    DetailPrint "Locating Erlang runtime directory..."

    FindFirst $R1 $R2 "$INSTDIR\erts-*"
    ${If} $R2 != ""
        StrCpy $R0 "$INSTDIR\$R2\bin"
        DetailPrint "Found ERTS bin: $R0"
        ; ── beam.smp.exe ──
        nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="PaperLand Dojo BEAM"'
        nsExec::ExecToLog 'netsh advfirewall firewall add rule name="PaperLand Dojo BEAM" dir=in action=allow program="$R0\beam.smp.exe" protocol=any profile=any description="PaperLand Dojo Erlang VM inbound"'
        nsExec::ExecToLog 'netsh advfirewall firewall add rule name="PaperLand Dojo BEAM Out" dir=out action=allow program="$R0\beam.smp.exe" protocol=any profile=any description="PaperLand Dojo Erlang VM outbound"'

        ; ── erl.exe ──
        nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="PaperLand Dojo ERL"'
        nsExec::ExecToLog 'netsh advfirewall firewall add rule name="PaperLand Dojo ERL" dir=in action=allow program="$R0\erl.exe" protocol=any profile=any description="PaperLand Dojo Erlang launcher inbound"'
        nsExec::ExecToLog 'netsh advfirewall firewall add rule name="PaperLand Dojo ERL Out" dir=out action=allow program="$R0\erl.exe" protocol=any profile=any description="PaperLand Dojo Erlang launcher outbound"'

        ; ── epmd.exe ──
        nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="PaperLand Dojo EPMD"'
        nsExec::ExecToLog 'netsh advfirewall firewall add rule name="PaperLand Dojo EPMD" dir=in action=allow program="$R0\epmd.exe" protocol=any profile=any description="PaperLand Dojo EPMD inbound"'
        nsExec::ExecToLog 'netsh advfirewall firewall add rule name="PaperLand Dojo EPMD Out" dir=out action=allow program="$R0\epmd.exe" protocol=any profile=any description="PaperLand Dojo EPMD outbound"'

        DetailPrint "ERTS firewall rules added successfully"
    ${Else}
        DetailPrint "WARNING: erts-* directory not found under $INSTDIR"
    ${EndIf}
    FindClose $R1
    
    DetailPrint "Installation completed successfully"
SectionEnd

;--------------------------------
; Uninstaller Section
;--------------------------------
Section "Uninstall"
    DetailPrint "Stopping PaperLand Dojo if running..."
    nsExec::ExecToLog 'taskkill /f /im dojo_windows.exe'

    DetailPrint "Removing Windows Firewall rules..."
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${FW_RULE_APP}"'
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${FW_RULE_MDNS}"'
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${FW_RULE_MDNS} Out"'
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="PaperLand Dojo ERTS"'
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="PaperLand Dojo BEAM"'
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="PaperLand Dojo BEAM Out"'
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="PaperLand Dojo ERL"'
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="PaperLand Dojo ERL Out"'
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="PaperLand Dojo EPMD"'
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="PaperLand Dojo EPMD Out"'
    RMDir /r "$INSTDIR"

    Delete "$SMPROGRAMS\PaperLand Dojo\PaperLand Dojo.lnk"
    Delete "$SMPROGRAMS\PaperLand Dojo\Uninstall.lnk"
    RMDir "$SMPROGRAMS\PaperLand Dojo"
    Delete "$DESKTOP\PaperLand Dojo.lnk"

    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PaperLand Dojo"
    DeleteRegKey HKLM "Software\PaperLand Dojo"

    DetailPrint "Uninstallation completed"
SectionEnd

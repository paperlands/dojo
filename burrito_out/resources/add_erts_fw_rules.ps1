# add_erts_fw_rules.ps1
#
# Discovers every erl.exe and epmd.exe that Burrito has extracted for
# PaperLand Dojo across ALL user profiles and adds Windows Firewall rules
# for each one.
#
# Must be run as SYSTEM or Administrator (the installer's scheduled task
# runs it as SYSTEM at each user logon).
#
# Rule naming convention:
#   "PaperLand Dojo ERTS - <full path to binary>"
#
# Idempotent: skips binaries that already have a matching rule.
# The uninstaller removes all rules matching "PaperLand Dojo ERTS - *".

#Requires -RunAsAdministrator

$ErrorActionPreference = 'SilentlyContinue'
$RulePrefix = 'PaperLand Dojo ERTS -'

# ── Locate all Burrito extraction roots ───────────────────────────────────
# Burrito extracts to:
#   <UserProfile>\AppData\Local\.burrito\dojo_erts-<erts_ver>_<app_ver>\erts-<erts_ver>\bin\
#
# We scan every user profile under C:\Users (covers the installing admin,
# the actual end-user, and any future accounts).  Also check the SYSTEM
# profile just in case.

$searchRoots = @(
    'C:\Users\*\AppData\Local\.burrito\dojo_erts-*\erts-*\bin'
    'C:\Windows\System32\config\systemprofile\AppData\Local\.burrito\dojo_erts-*\erts-*\bin'
    'C:\Windows\SysWOW64\config\systemprofile\AppData\Local\.burrito\dojo_erts-*\erts-*\bin'
)

# Binaries that open sockets and need firewall rules
$binaryNames = @('erl.exe', 'epmd.exe', 'erlsrv.exe')

# ── Helper: ensure a firewall rule exists for a given binary ──────────────
function Ensure-FwRule {
    param(
        [string]$BinaryPath,
        [string]$Direction   # 'Inbound' or 'Outbound'
    )

    $displayName = "$RulePrefix $Direction - $BinaryPath"

    $existing = Get-NetFirewallRule -DisplayName $displayName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Output "  [skip] Rule already exists: $displayName"
        return
    }

    try {
        New-NetFirewallRule `
            -DisplayName  $displayName `
            -Direction    $Direction `
            -Action       Allow `
            -Program      $BinaryPath `
            -Profile      Any `
            -Protocol     Any `
            -Enabled      True `
            -ErrorAction  Stop | Out-Null

        Write-Output "  [added] $Direction rule for $BinaryPath"
    }
    catch {
        Write-Warning "  [error] Failed to add $Direction rule for ${BinaryPath}: $_"
    }
}

# ── Main loop ─────────────────────────────────────────────────────────────
$foundAny = $false

foreach ($pattern in $searchRoots) {
    $binDirs = Resolve-Path $pattern -ErrorAction SilentlyContinue
    if (-not $binDirs) { continue }

    foreach ($binDir in $binDirs) {
        foreach ($name in $binaryNames) {
            $fullPath = Join-Path $binDir.Path $name
            if (-not (Test-Path $fullPath)) { continue }

            $foundAny = $true
            Write-Output "Processing: $fullPath"

            Ensure-FwRule -BinaryPath $fullPath -Direction 'Inbound'
            Ensure-FwRule -BinaryPath $fullPath -Direction 'Outbound'
        }
    }
}

if (-not $foundAny) {
    Write-Output "No Burrito ERTS extractions found yet — rules will be added on next logon after first launch."
}

Write-Output "Done."

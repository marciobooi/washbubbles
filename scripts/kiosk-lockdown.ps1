# Locks down the kiosk touch screen. Run as the kiosk user (Geral), elevated. Never restarts anything:
# changes take effect at the next restart.
#   -Mode status (default) | apply | revert
# (a) no swipes from the screen edges; (b) for this user only, no explorer.exe (no taskbar, no Start menu).
# The kiosk browser is started by the "WashBubbles Kiosk" logon task, not by explorer.
param([ValidateSet('status', 'apply', 'revert')][string]$Mode = 'status')
$ErrorActionPreference = 'Stop'

$edge = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\EdgeUI'
$winlogon = 'HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
# A shell that only stays alive: no file on disk that an update could break.
$shell = 'powershell.exe -NoProfile -WindowStyle Hidden -Command "while(1){Start-Sleep 3600}"'

if ($Mode -eq 'apply') {
  if (-not (Get-ScheduledTask -TaskName 'WashBubbles Kiosk' -ErrorAction SilentlyContinue)) { throw "Task 'WashBubbles Kiosk' is missing: without explorer nothing would open the screen." }
  New-Item -Path $edge -Force | Out-Null
  Set-ItemProperty -Path $edge -Name AllowEdgeSwipe -Value 0 -Type DWord
  New-Item -Path $winlogon -ErrorAction SilentlyContinue | Out-Null
  Set-ItemProperty -Path $winlogon -Name Shell -Value $shell -Type String
}
if ($Mode -eq 'revert') {
  Remove-ItemProperty -Path $edge -Name AllowEdgeSwipe -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path $winlogon -Name Shell -ErrorAction SilentlyContinue
}

$s = (Get-ItemProperty -Path $winlogon -ErrorAction SilentlyContinue).Shell
$a = (Get-ItemProperty -Path $edge -ErrorAction SilentlyContinue).AllowEdgeSwipe
"user: $env:USERNAME"
"AllowEdgeSwipe: $(if ($null -eq $a) { 'not set (swipes on)' } else { $a })"
"user shell: $(if ($s) { $s } else { 'not set (explorer.exe)' })"

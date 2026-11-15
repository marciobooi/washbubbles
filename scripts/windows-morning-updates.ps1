# Morning updates of the shop PC, run by the scheduled task 'WashBubbles Morning Updates' a few minutes after the PC starts
# (scripts/install-windows.ps1). The kiosk is up first; this runs at low priority and never restarts the PC.
#   1. Tailscale (the remote access): updated when a new stable version exists.
#   2. Windows Update: security, Defender and other SOFTWARE updates are installed. DRIVERS are left alone: a new driver for the
#      USB network adapter (the link to the controller) or the card reader must be tried by a person, not by a script at 06:45.
#      Nothing is restarted: what needs a restart finishes when the PC is switched off at night and on again in the morning.
#   3. Programs (Node.js, MongoDB, Git...): only listed. A new Node or MongoDB can break the program and is updated by us, tested.
# Everything is written to logs\morning-updates.log, and a short summary to logs\morning-updates.json.
param([switch]$ReportOnly)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir 'morning-updates.log'
function Log($m) { Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) -Encoding UTF8 }
try { (Get-Process -Id $PID).PriorityClass = 'BelowNormal' } catch { }

$lock = Join-Path $logDir 'morning-updates.lock'
if ((Test-Path $lock) -and ((Get-Date) - (Get-Item $lock).LastWriteTime).TotalHours -lt 3) { Log 'another run is busy: nothing done'; exit 0 }
Set-Content -Path $lock -Value $PID
$summary = [ordered]@{ at = (Get-Date).ToString('s'); reportOnly = [bool]$ReportOnly; tailscale = $null; windows = @(); windowsFailed = @(); driversSkipped = @(); rebootPending = $false; programs = @() }
Log ("---- morning updates" + $(if ($ReportOnly) { ' (report only)' } else { '' }))

try {
  # 1. Tailscale
  $ts = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
  if (Test-Path $ts) {
    $ver = (& $ts version 2>$null | Select-Object -First 1)
    $dry = (& $ts update --dry-run 2>&1 | Out-String).Trim()
    if ($dry -match '(?i)no update needed|already running') { $summary.tailscale = "$ver (up to date)"; Log "tailscale ${ver}: up to date" }
    elseif ($ReportOnly) { $summary.tailscale = "$ver -> update available"; Log "tailscale ${ver}: update available ($dry)" }
    else {
      Log "tailscale ${ver}: updating ($dry)"
      $out = (& $ts update --yes 2>&1 | Out-String).Trim()
      $now = (& $ts version 2>$null | Select-Object -First 1)
      $summary.tailscale = "$ver -> $now"
      Log "tailscale now $now ($out)"
    }
  } else { $summary.tailscale = 'not installed'; Log 'tailscale: not installed' }

  # 2. Windows Update (software only: drivers are listed, never installed)
  try {
    $session = New-Object -ComObject Microsoft.Update.Session
    $session.ClientApplicationID = 'WashBubbles morning updates'
    $all = $session.CreateUpdateSearcher().Search("IsInstalled=0 and IsHidden=0")
    $toInstall = New-Object -ComObject Microsoft.Update.UpdateColl
    foreach ($u in $all.Updates) {
      if ($u.Type -eq 2) { $summary.driversSkipped += $u.Title; Log "driver left alone: $($u.Title)"; continue }   # 2 = driver
      if ($u.InstallationBehavior.CanRequestUserInput) { Log "needs a person, left alone: $($u.Title)"; continue }
      if (-not $u.EulaAccepted) { try { $u.AcceptEula() } catch { } }
      [void]$toInstall.Add($u)
    }
    Log "windows update: $($toInstall.Count) to install, $($summary.driversSkipped.Count) driver(s) left alone"
    if ($toInstall.Count -gt 0 -and -not $ReportOnly) {
      $dl = $session.CreateUpdateDownloader(); $dl.Updates = $toInstall; [void]$dl.Download()
      $inst = $session.CreateUpdateInstaller(); $inst.Updates = $toInstall
      $res = $inst.Install()
      for ($i = 0; $i -lt $toInstall.Count; $i++) {
        $code = $res.GetUpdateResult($i).ResultCode   # 2 = succeeded, 3 = succeeded with errors, 4 = failed, 5 = aborted
        $title = $toInstall.Item($i).Title
        if ($code -eq 2 -or $code -eq 3) { $summary.windows += $title; Log "installed: $title" }
        else { $summary.windowsFailed += $title; Log "NOT installed (code $code): $title" }
      }
      if ($res.RebootRequired) { Log 'a restart is needed: it happens with tonight''s shutdown (this script never restarts the PC)' }
    } elseif ($ReportOnly) { foreach ($u in $toInstall) { $summary.windows += "(pending) $($u.Title)" } }
  } catch { Log "windows update failed: $($_.Exception.Message)"; $summary.windowsFailed += "error: $($_.Exception.Message)" }
  $summary.rebootPending = Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'

  # 3. Programs: listed only
  try {
    $wg = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $wg) { $wg = Get-ChildItem "$env:ProgramFiles\WindowsApps\Microsoft.DesktopAppInstaller_*_x64__8wekyb3d8bbwe\winget.exe" -ErrorAction SilentlyContinue | Select-Object -Last 1 }
    if ($wg) {
      # Get-Command gives .Source, the file found under WindowsApps (when run as SYSTEM) gives .FullName
      $wgPath = if ($wg.Source) { $wg.Source } else { $wg.FullName }
      $lines = & $wgPath upgrade --accept-source-agreements --disable-interactivity 2>$null
      $rows = $lines | Where-Object { $_ -match '\s(winget|msstore)\s*$' }
      foreach ($r in $rows) { $summary.programs += ($r -replace '\s{2,}', ' | ').Trim() }
      Log "programs with a newer version (not updated, listed only): $($summary.programs.Count)"
      foreach ($p in $summary.programs) { Log "  $p" }
    } else { Log 'winget not available: programs not checked' }
  } catch { Log "program check failed: $($_.Exception.Message)" }
} finally {
  $summary | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $logDir 'morning-updates.json') -Encoding UTF8
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
  Log '---- done'
}

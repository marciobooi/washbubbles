# Closes the kiosk in order and then switches the PC off. Started by backend/src/services/shutdownScheduler.js (detached, so it
# keeps running when it stops the backend). Cancel during the last seconds with:  shutdown /a
#   1. the kiosk screen (browser) is closed,
#   2. the boot-time tasks are stopped (so nothing restarts the backend or the bridge), then the backend and the hardware bridge,
#   3. the database service is stopped (everything written to disk),
#   4. Windows shuts down (10 s).
param([int]$DelaySeconds = 10)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root 'logs\shutdown.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
function Log($m) { Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) }
Log 'graceful shutdown started'

# 1. kiosk browser windows (a polite close first, then whatever is left)
foreach ($n in 'chrome', 'msedge', 'firefox') {
  Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object { try { [void]$_.CloseMainWindow() } catch { } }
}
Start-Sleep -Seconds 4
foreach ($n in 'chrome', 'msedge', 'firefox') { Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue }
Log 'kiosk screen closed'

# 2. stop the loops that restart things, then the programs themselves (this script is not one of them)
foreach ($t in 'WashBubbles Kiosk', 'WashBubbles Update', 'WashBubbles Backend', 'WashBubbles Bridge') { try { Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue } catch { } }
Start-Sleep -Seconds 2
Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -match 'src\\index\.js|bridge' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "name='cmd.exe'" | Where-Object { $_.CommandLine -match 'run-backend|run-bridge|start-kiosk' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Log 'backend and bridge stopped'

# 3. the database: a clean stop writes everything to disk
try { Stop-Service -Name 'MongoDB' -Force -ErrorAction Stop; Log 'database stopped' } catch { Log ('database not stopped: ' + $_.Exception.Message) }

# 4. switch off
Log "shutting down in $DelaySeconds s"
& shutdown.exe /s /t $DelaySeconds /c 'Desligar agendado do quiosque'

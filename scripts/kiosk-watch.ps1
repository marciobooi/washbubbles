# Keeps the kiosk screen open (task "WashBubbles Kiosk Watch", runs as the logged-in user, every 2 minutes).
# If the backend answers but no kiosk browser is running (it crashed, or the PC just started and the logon task was missed),
# start it through the "WashBubbles Kiosk" task. Never closes anything.
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root 'logs\kiosk-watch.log'
$port = 3000
$e = Join-Path $root 'backend\.env'
if (Test-Path $e) { $m = Select-String -Path $e -Pattern '^PORT=(\d+)' | Select-Object -First 1; if ($m) { $port = [int]$m.Matches[0].Groups[1].Value } }
try { $ok = (Invoke-WebRequest "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { $ok = $false }
if (-not $ok) { exit 0 }   # the backend is not up yet: the logon task / the next round will open the screen
$kiosk = Get-CimInstance Win32_Process -Filter "name='msedge.exe'" | Where-Object { $_.CommandLine -match '--kiosk' }
if ($kiosk) { exit 0 }
Add-Content $log ("[{0}] kiosk browser not running: starting it" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
& schtasks /run /tn 'WashBubbles Kiosk' | Out-Null

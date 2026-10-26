# Updater for the shop PC (scheduled task "WashBubbles Update", every minute: a push to main is live here within about a minute).
#   git fetch; if origin/main has news: pull (fast-forward only), install dependencies if package files changed,
#   build the screen into dist-new and swap it in, restart ONLY the backend (src\index.js; run-backend.bat starts it
#   again), check /api/health. If anything fails it goes back to the previous commit and the previous screen.
#   The kiosk browser is never touched: the screen reloads itself when it sees a new build and nobody is using it.
# Manual run:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\kiosk-update.ps1 [-DryRun] [-Force]
param([switch]$DryRun, [switch]$Force)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logFile = Join-Path $root 'logs\update.log'
if (-not (Test-Path (Split-Path $logFile))) { New-Item -ItemType Directory -Path (Split-Path $logFile) | Out-Null }

$lock = Join-Path $root "logs\update.lock"
if ((Test-Path $lock) -and ((Get-Date) - (Get-Item $lock).LastWriteTime).TotalMinutes -lt 20) { exit 0 }   # another run is busy
Set-Content $lock (Get-Date)
try {

function Log($m) { $l = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m; Add-Content -Path $logFile -Value $l; Write-Host $l }
function Invoke-Git { & git -c 'safe.directory=*' @args 2>&1 }
function Port { $p = 3000; $e = Join-Path $root 'backend\.env'
  if (Test-Path $e) { $m = Select-String -Path $e -Pattern '^PORT=(\d+)' | Select-Object -First 1; if ($m) { $p = [int]$m.Matches[0].Groups[1].Value } }; $p }
function Healthy($secs) {
  $u = "http://127.0.0.1:$(Port)/api/health"
  for ($i = 0; $i -lt [math]::Ceiling($secs / 3); $i++) {
    try { if ((Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { return $true } } catch {}
    Start-Sleep 3
  }
  $false
}
# backend.log is never rotated by run-backend.bat and grew past 90 MB with card holders' names and tax ids in it. Each time the
# backend is restarted (it is stopped for ~5 s then) a log over 20 MB is moved aside, and once the backend is up again the moved
# file is masked (name / tax id / e-mail / phone), compressed into logs\archive and deleted. The 5 newest archives are kept.
function Rotate-BackendLog {
  $log = Join-Path $root 'logs\backend.log'
  if (-not (Test-Path $log) -or (Get-Item $log).Length -lt 20MB) { return $null }
  $arch = Join-Path $root 'logs\archive'; New-Item -ItemType Directory -Force $arch | Out-Null
  $dest = Join-Path $arch ('backend-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.raw.log')
  for ($i = 0; $i -lt 10; $i++) { try { Move-Item $log $dest -ErrorAction Stop; return $dest } catch { Start-Sleep -Milliseconds 500 } }
  $null
}
function Archive-RawLog($raw) {
  try {
    $san = $raw -replace '\.raw\.log$', '.log'
    $sr = New-Object IO.StreamReader($raw, [Text.Encoding]::UTF8); $sw = New-Object IO.StreamWriter($san, $false, [Text.Encoding]::UTF8)
    while ($null -ne ($line = $sr.ReadLine())) {
      $sw.WriteLine([regex]::Replace($line, '"(name|nif|email|phone|contribuinte|customerName|customerEmail|customerPhone)":"([^"]*[^"\s][^"]*)"', '"$1":"***"'))
    }
    $sw.Close(); $sr.Close()
    Compress-Archive -Path $san -DestinationPath ($san -replace '\.log$', '.zip') -Force
    Remove-Item $san, $raw -Force
    Get-ChildItem (Split-Path $raw) -Filter '*.zip' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 5 | Remove-Item -Force
    Log 'backend.log rotated: masked copy archived, original removed'
  } catch { Log ('log archive failed (the raw file is kept): ' + $_.Exception.Message) }
}
function RestartBackend {
  Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -match 'src\\index\.js' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Start-Sleep 1
  $raw = Rotate-BackendLog
  Start-Sleep 7   # run-backend.bat waits 5 s and starts it again
  $ok = Healthy 120
  if ($ok -and $raw) { Archive-RawLog $raw }
  $ok
}
function BuildScreen {
  $e = Join-Path $root 'backend\.env'
  $k = (Get-Content $e | Where-Object { $_ -match '^KIOSK_API_KEY=' } | Select-Object -First 1) -replace '^KIOSK_API_KEY=', ''
  $env:VITE_KIOSK_API_KEY = $k.Trim().Trim('"')
  if (Test-Path dist-new) { Remove-Item dist-new -Recurse -Force }
  & npm run build -- --outDir dist-new --emptyOutDir 2>&1 | Out-Null
  (Test-Path 'dist-new\index.html')
}
function SwapIn { if (Test-Path dist-old) { Remove-Item dist-old -Recurse -Force }
  if (Test-Path dist) { Rename-Item dist dist-old }; Rename-Item dist-new dist }
function SwapBack { if (Test-Path dist-old) { if (Test-Path dist) { Remove-Item dist -Recurse -Force }; Rename-Item dist-old dist } }

$null = Invoke-Git fetch origin --quiet
if ($LASTEXITCODE -ne 0) { Log 'fetch failed (no network or no access to GitHub): nothing done'; exit 1 }
$old = (Invoke-Git rev-parse HEAD).Trim()
$new = (Invoke-Git rev-parse origin/main).Trim()
if ($old -eq $new -and -not $Force) { Log "up to date at $($old.Substring(0,7))"; exit 0 }
if (Invoke-Git status --porcelain --untracked-files=no) { Log 'tracked files were changed on this PC: not updating (look at git status)'; exit 2 }

$files = @(Invoke-Git diff --name-only $old $new)
$pkg = [bool]($files | Where-Object { $_ -match '(^|/)package(-lock)?\.json$' })
$front = [bool]($files | Where-Object { $_ -match '^(src/|public/|index\.html$|vite\.config|tailwind|postcss|components\.json$)' })
$back = [bool]($files | Where-Object { $_ -match '^backend/' })
Log ("update {0} -> {1}: {2} files (packages={3} screen={4} backend={5})" -f $old.Substring(0, 7), $new.Substring(0, 7), $files.Count, $pkg, $front, $back)
if ($DryRun) { Log 'dry run: stopping here'; exit 0 }

function Rollback($why) {
  Log "FAILED ($why): going back to $($old.Substring(0,7))"
  $null = Invoke-Git reset --hard $old
  SwapBack
  if ($pkg) { & npm install --no-audit --no-fund 2>&1 | Out-Null; Push-Location backend; & npm install --no-audit --no-fund 2>&1 | Out-Null; Pop-Location }
  if (-not (RestartBackend)) { Log 'WARNING: backend not healthy after the rollback either - needs a look' }
  exit 3
}

$null = Invoke-Git merge --ff-only origin/main
if ($LASTEXITCODE -ne 0) { Log 'fast-forward not possible: not updating'; exit 2 }

if ($pkg) {
  & npm install --no-audit --no-fund 2>&1 | Out-Null; $a = $LASTEXITCODE
  Push-Location backend; & npm install --no-audit --no-fund 2>&1 | Out-Null; $b = $LASTEXITCODE; Pop-Location
  if ($a -ne 0 -or $b -ne 0) { Rollback 'npm install' }
}
if ($front) {
  if (-not (BuildScreen)) { Rollback 'screen build' }
  SwapIn
  Log 'screen built and swapped in'
}
if ($back) {
  if (-not (RestartBackend)) { Rollback 'backend not healthy' }
  Log 'backend restarted and healthy'
} elseif (-not (Healthy 30)) { Rollback 'backend not healthy' }

# The kiosk browser is NEVER closed from here: the screen reloads itself when nobody is touching it (src/lib/autoReload.js). It is
# also TOLD to: a `screen:reload` message to every kiosk screen of this shop, so nobody has to press F5.
if ($front -or $back) {
  try {
    $k = Select-String -Path (Join-Path $root 'backend\.env') -Pattern '^KIOSK_API_KEY=' | Select-Object -First 1
    $key = ($k.Line -replace '^KIOSK_API_KEY=', '').Trim().Trim('"')
    Invoke-RestMethod -Uri "http://127.0.0.1:$(Port)/api/pos/screen-reload" -Method Post -Headers @{ Authorization = "ApiKey $key" } -ContentType 'application/json' -Body '{}' -TimeoutSec 10 | Out-Null
    Log 'kiosk screens told to refresh'
  } catch { Log ('could not tell the kiosk screens to refresh (they refresh by themselves): ' + $_.Exception.Message) }
}
Log "done: now at $((Invoke-Git rev-parse --short HEAD).Trim())"
} finally { Remove-Item $lock -Force -ErrorAction SilentlyContinue }

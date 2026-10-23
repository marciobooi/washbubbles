# Updater for a shop PC that was installed from the central server (no git here). Scheduled task "WashBubbles Update".
#   asks the central server for its version (/installer/version, with this post's key); when it differs from .version:
#   downloads the program (zip), keeps a copy of what is installed, copies the new files over (never the shop's .env,
#   database, logs or uploads), installs packages / builds the screen / restarts ONLY the backend as needed, checks
#   /api/health, and goes back to the saved copy if anything fails.
# Manual run:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\kiosk-update-bundle.ps1 [-DryRun] [-Force]
param([switch]$DryRun, [switch]$Force)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logFile = Join-Path $root 'logs\update.log'
if (-not (Test-Path (Split-Path $logFile))) { New-Item -ItemType Directory -Path (Split-Path $logFile) | Out-Null }
function Log($m) { $l = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m; Add-Content -Path $logFile -Value $l; Write-Host $l }

$lock = Join-Path $root 'logs\update.lock'
if ((Test-Path $lock) -and ((Get-Date) - (Get-Item $lock).LastWriteTime).TotalMinutes -lt 30) { exit 0 }
Set-Content $lock (Get-Date)
try {

function EnvVal($k) { $e = Join-Path $root 'backend\.env'
  if (-not (Test-Path $e)) { return '' }
  $m = Select-String -Path $e -Pattern ("^" + $k + "=(.*)$") | Select-Object -First 1
  if ($m) { return $m.Matches[0].Groups[1].Value.Trim().Trim('"') } ; '' }
function Port { $p = EnvVal 'PORT'; if ($p) { [int]$p } else { 3000 } }
function Healthy($secs) {
  $u = "http://127.0.0.1:$(Port)/api/health"
  for ($i = 0; $i -lt [math]::Ceiling($secs / 3); $i++) {
    try { if ((Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { return $true } } catch {}
    Start-Sleep 3
  }
  $false
}
function RestartBackend {
  Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -match 'src\\index\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Start-Sleep 8   # run-backend.bat waits 5 s and starts it again
  Healthy 120
}
function BuildScreen {
  $env:VITE_KIOSK_API_KEY = EnvVal 'KIOSK_API_KEY'
  if (Test-Path dist-new) { Remove-Item dist-new -Recurse -Force }
  & npm run build -- --outDir dist-new --emptyOutDir 2>&1 | Out-Null
  (Test-Path 'dist-new\index.html')
}
function SwapIn { if (Test-Path dist-old) { Remove-Item dist-old -Recurse -Force }; if (Test-Path dist) { Rename-Item dist dist-old }; Rename-Item dist-new dist }
function SwapBack { if (Test-Path dist-old) { if (Test-Path dist) { Remove-Item dist -Recurse -Force }; Rename-Item dist-old dist } }
# Hash of every file of a group of folders, to know what changed between the installed and the new program.
function GroupHash($base, $paths) {
  $items = foreach ($p in $paths) {
    $full = Join-Path $base $p
    if (Test-Path $full -PathType Leaf) { Get-Item $full }
    elseif (Test-Path $full) { Get-ChildItem $full -Recurse -File | Where-Object { $_.FullName -notmatch '\\node_modules\\' } }
  }
  (($items | Sort-Object FullName | ForEach-Object { $_.FullName.Substring($base.Length) + ':' + (Get-FileHash $_.FullName -Algorithm SHA1).Hash }) -join '|')
}

$server = (EnvVal 'SYNC_SERVER_URL').TrimEnd('/'); $key = EnvVal 'SYNC_API_KEY'
if (-not $server -or -not $key) { Log 'no central server / key in backend\.env: nothing to update from'; exit 0 }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$headers = @{ Authorization = "ApiKey $key" }
$verFile = Join-Path $root '.version'
$have = ''; if (Test-Path $verFile) { $have = (Get-Content $verFile -Raw).Trim() }
try { $remote = (Invoke-RestMethod -Uri "$server/installer/version" -Headers $headers -TimeoutSec 20).version }
catch { Log 'central server not reachable (or it refused the key): nothing done'; exit 1 }
if ($remote -eq $have -and -not $Force) { exit 0 }
Log ("update {0} -> {1}" -f $(if ($have) { $have.Substring(0, [math]::Min(7, $have.Length)) } else { '?' }), $remote.Substring(0, [math]::Min(7, $remote.Length)))
if ($DryRun) { Log 'dry run: stopping here'; exit 0 }

$zip = Join-Path $env:TEMP 'washbubbles-update.zip'; $stage = Join-Path $env:TEMP 'washbubbles-update-stage'
if (Test-Path $zip) { Remove-Item $zip -Force }; if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
try { Invoke-WebRequest -Uri "$server/installer/bundle" -Headers $headers -OutFile $zip -UseBasicParsing -TimeoutSec 600 } catch { Log "download failed: $($_.Exception.Message)"; exit 1 }
if ((Get-Item $zip).Length -lt 100000) { Log 'downloaded file is incomplete: nothing done'; exit 1 }
Expand-Archive -Path $zip -DestinationPath $stage -Force

$pkgNow = GroupHash $root @('package.json', 'package-lock.json', 'backend\package.json', 'backend\package-lock.json')
$pkgNew = GroupHash $stage @('package.json', 'package-lock.json', 'backend\package.json', 'backend\package-lock.json')
$frontPaths = @('src', 'public', 'index.html', 'vite.config.js', 'tailwind.config.js', 'postcss.config.js', 'components.json')
$front = (GroupHash $root $frontPaths) -ne (GroupHash $stage $frontPaths)
$back = (GroupHash $root @('backend\src')) -ne (GroupHash $stage @('backend\src'))
$pkg = $pkgNow -ne $pkgNew
Log ("changes: packages=$pkg screen=$front backend=$back")

# A copy of what is installed now, to go back to.
$save = Join-Path $root 'rollback-code'
if (Test-Path $save) { Remove-Item $save -Recurse -Force }
& robocopy $root $save /E /NFL /NDL /NJH /NJS /NP /XD 'node_modules' 'dist' 'dist-old' 'dist-new' 'logs' 'rollback-code' 'uploads' '.git' /XF '.env' | Out-Null

function Rollback($why) {
  Log "FAILED ($why): going back to the saved copy"
  & robocopy $save $root /E /NFL /NDL /NJH /NJS /NP /XF '.env' | Out-Null
  SwapBack
  if ($pkg) { & npm install --no-audit --no-fund 2>&1 | Out-Null; Push-Location backend; & npm install --no-audit --no-fund 2>&1 | Out-Null; Pop-Location }
  if (-not (RestartBackend)) { Log 'WARNING: backend not healthy after the rollback either - needs a look' }
  exit 3
}

# source folders are mirrored (a file removed in the new version disappears); everything else is copied over
foreach ($d in 'backend\src', 'src', 'scripts') { if (Test-Path (Join-Path $stage $d)) { & robocopy (Join-Path $stage $d) (Join-Path $root $d) /MIR /NFL /NDL /NJH /NJS /NP | Out-Null } }
& robocopy $stage $root /E /NFL /NDL /NJH /NJS /NP /XF '.env' | Out-Null
if ($LASTEXITCODE -ge 8) { Rollback 'copy' }

if ($pkg) {
  & npm install --no-audit --no-fund 2>&1 | Out-Null; $a = $LASTEXITCODE
  Push-Location backend; & npm install --omit=dev --no-audit --no-fund 2>&1 | Out-Null; $b = $LASTEXITCODE; Pop-Location
  if ($a -ne 0 -or $b -ne 0) { Rollback 'npm install' }
}
if ($front) {
  if (-not (BuildScreen)) { Rollback 'screen build' }
  SwapIn; Log 'screen built and swapped in'
}
if ($back) {
  if (-not (RestartBackend)) { Rollback 'backend not healthy' }
  Log 'backend restarted and healthy'
} elseif (-not (Healthy 30)) { Rollback 'backend not healthy' }

Set-Content -Path $verFile -Value $remote -Encoding ASCII
Remove-Item $zip, $stage, $save -Recurse -Force -ErrorAction SilentlyContinue
Log "done: now at $($remote.Substring(0, [math]::Min(7, $remote.Length)))"
} finally { Remove-Item $lock -Force -ErrorAction SilentlyContinue }

# Final checks after the installation: is the program answering, does the central server accept this post's key,
# does the controller answer. Prints a short list in plain Portuguese. Exit code 0 = all good.
param([string]$ConfigFile = '')
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$cfg = $null
if ($ConfigFile -and (Test-Path $ConfigFile)) { $cfg = Get-Content $ConfigFile -Raw | ConvertFrom-Json }
$port = 3000
$envFile = Join-Path $Root 'backend\.env'
if (Test-Path $envFile) { $m = Select-String -Path $envFile -Pattern '^PORT=(\d+)' | Select-Object -First 1; if ($m) { $port = [int]$m.Matches[0].Groups[1].Value } }

$bad = 0
function Line($ok, $okText, $badText, $critical = $true) {
  if ($ok) { Write-Host ("    [OK] " + $okText) -ForegroundColor Green }
  else { Write-Host ("    [!!] " + $badText) -ForegroundColor Yellow; if ($critical) { $script:bad++ } }
}

# 1. the program answers (up to 2 minutes: the database and the program take a while to start)
$up = $false
for ($i = 0; $i -lt 40 -and -not $up; $i++) {
  try { if ((Invoke-WebRequest "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { $up = $true } } catch { Start-Sleep 3 }
}
Line $up 'O programa do quiosque esta a funcionar.' 'O programa do quiosque nao arrancou. Reinicie o computador e, se continuar, envie-nos o diagnostico.'

# 2. the central server accepts this post
if ($cfg) {
  $central = $false
  try { $r = Invoke-RestMethod -Uri ($cfg.serverUrl + '/installer/version') -Headers @{ Authorization = ('ApiKey ' + $cfg.key) } -TimeoutSec 15; $central = [bool]$r.version } catch { }
  Line $central ('Ligado ao servidor da loja ' + $cfg.shopName + '.') 'Nao foi possivel ligar ao servidor central.'
}

# 3. the machines' controller (only a warning: the cable or the controller may simply be off during the installation)
if ($cfg -and $cfg.hardware.controllerHost) {
  $ping = Test-Connection -ComputerName $cfg.hardware.controllerHost -Count 2 -Quiet -ErrorAction SilentlyContinue
  Line $ping 'O controlador das maquinas responde.' ('O controlador das maquinas (' + $cfg.hardware.controllerHost + ') nao responde. Verifique se esta ligado e se o cabo de rede esta no sitio certo.') $false
}

# 4. starts by itself (tasks)
$tasks = @('WashBubbles Backend', 'WashBubbles Bridge', 'WashBubbles Kiosk')
$missing = @($tasks | Where-Object { -not (Get-ScheduledTask -TaskName $_ -ErrorAction SilentlyContinue) })
Line ($missing.Count -eq 0) 'Arranca sozinho sempre que o computador liga.' ('Falta configurar o arranque automatico: ' + ($missing -join ', '))

if ($bad -gt 0) {
  try {
    $logs = Join-Path $Root 'logs'
    $out = Join-Path ([Environment]::GetFolderPath('Desktop')) ('Diagnostico-' + $(if ($cfg) { $cfg.slug } else { 'posto' }) + '.zip')
    if (Test-Path $out) { Remove-Item $out -Force }
    Compress-Archive -Path (Join-Path $logs '*.log') -DestinationPath $out -Force
  } catch { }
  exit 1
}
exit 0

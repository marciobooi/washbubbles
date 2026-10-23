# ---------------------------------------------------------------------------------------------------------------------
# Instalador do posto (gerado pelo painel de administração). O cliente só faz duplo clique no ficheiro .bat.
# Faz tudo sozinho: pede permissão de administrador, descarrega o programa, instala o que falta, liga o posto à loja
# e testa. Pode ser executado outra vez sem estragar nada. Mensagens em português simples.
# ---------------------------------------------------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$cfg = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ConfigB64)) | ConvertFrom-Json
$Dir = 'C:\WashBubbles'
$LogDir = Join-Path $Dir 'logs'
$Desktop = [Environment]::GetFolderPath('Desktop')
$Support = $cfg.supportEmail

function Say($m, $c = 'White') { Write-Host $m -ForegroundColor $c }
function Big($m, $c) { Write-Host ''; Write-Host ('=' * 70) -ForegroundColor $c; Write-Host ("  " + $m) -ForegroundColor $c; Write-Host ('=' * 70) -ForegroundColor $c; Write-Host '' }
function Step($n, $t) { Say ("`n[$n/6] $t") 'Cyan' }

function Test-Admin { (New-Object Security.Principal.WindowsPrincipal ([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }

if (-not (Test-Admin)) {
  Say 'Vai aparecer uma janela a pedir permissão. Carregue em "Sim".' 'Yellow'
  Start-Process -FilePath $env:ComSpec -ArgumentList '/c', ('"' + $BatPath + '"') -Verb RunAs
  exit 10
}

Clear-Host
Big ("Instalação do posto - " + $cfg.shopName) 'Cyan'
Say 'Não feche esta janela. Demora entre 10 e 25 minutos. Pode demorar mais se a internet for lenta.' 'Gray'
Say 'Se ficar parado algum tempo, é normal: está a descarregar ou a instalar.' 'Gray'

New-Item -ItemType Directory -Force $LogDir | Out-Null
$log = Join-Path $LogDir ("instalador-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
try { Start-Transcript -Path $log | Out-Null } catch { }

function Report($msg) {
  # Tell the central server how it went (never blocks the installation).
  try {
    $tail = ''
    if (Test-Path $log) { $tail = (Get-Content $log -Tail 80 -ErrorAction SilentlyContinue) -join "`n" }
    $body = @{ ok = $false; message = "$msg"; machine = $env:COMPUTERNAME; log = $tail } | ConvertTo-Json
    Invoke-RestMethod -Uri ($cfg.serverUrl + '/installer/report') -Method Post -ContentType 'application/json; charset=utf-8' -Headers @{ Authorization = ('ApiKey ' + $cfg.key) } -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 20 | Out-Null
  } catch { }
}

try {
  # 1 ---- internet and server
  Step 1 'A verificar a ligação à internet e ao servidor...'
  $ok = $false
  for ($i = 1; $i -le 5 -and -not $ok; $i++) {
    try { Invoke-WebRequest -Uri ($cfg.serverUrl + '/health') -UseBasicParsing -TimeoutSec 15 | Out-Null; $ok = $true } catch { Start-Sleep 4 }
  }
  if (-not $ok) { throw 'NET: Este computador não consegue ligar-se à internet (ou ao servidor). Verifique o cabo de rede/Wi-Fi e execute este ficheiro outra vez.' }
  Say '    Ligação OK.' 'Green'

  # 2 ---- download the program
  Step 2 'A descarregar o programa...'
  New-Item -ItemType Directory -Force $Dir | Out-Null
  $zip = Join-Path $env:TEMP 'washbubbles-app.zip'
  if (Test-Path $zip) { Remove-Item $zip -Force }
  $headers = @{ Authorization = ('ApiKey ' + $cfg.key) }
  try { Invoke-WebRequest -Uri ($cfg.serverUrl + '/installer/bundle') -Headers $headers -OutFile $zip -UseBasicParsing -TimeoutSec 600 }
  catch { throw ('DOWNLOAD: Não foi possível descarregar o programa. ' + $_.Exception.Message) }
  if ((Get-Item $zip).Length -lt 100000) { throw 'DOWNLOAD: O ficheiro descarregado está incompleto. Execute este ficheiro outra vez.' }
  $ver = (Invoke-RestMethod -Uri ($cfg.serverUrl + '/installer/version') -Headers $headers -TimeoutSec 20).version
  Say '    Descarregado.' 'Green'

  # 3 ---- unpack (never touches the shop's own data: backend\.env, the database, logs)
  Step 3 'A preparar os ficheiros...'
  $stage = Join-Path $env:TEMP 'washbubbles-stage'
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $stage -Force
  & robocopy $stage $Dir /E /NFL /NDL /NJH /NJS /NP /XF '.env' | Out-Null
  if ($LASTEXITCODE -ge 8) { throw 'FILES: Não foi possível copiar os ficheiros para C:\WashBubbles.' }
  Set-Content -Path (Join-Path $Dir '.version') -Value $ver -Encoding ASCII
  ($cfg | ConvertTo-Json -Depth 6) | Set-Content -Path (Join-Path $Dir 'install-config.json') -Encoding UTF8
  Remove-Item $stage, $zip -Recurse -Force -ErrorAction SilentlyContinue
  Say '    Pronto.' 'Green'

  # 4 ---- the real installer (Node, database, settings, network, autostart)
  Step 4 'A instalar os componentes (Node.js, base de dados, configuração)...'
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Dir 'scripts\install-windows.ps1') -NonInteractive -ConfigFile (Join-Path $Dir 'install-config.json')
  if ($LASTEXITCODE -ne 0) { throw 'INSTALL: A instalação dos componentes falhou.' }

  # 5 ---- start and test
  Step 5 'A arrancar e a testar...'
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Dir 'scripts\first-start-check.ps1') -ConfigFile (Join-Path $Dir 'install-config.json')
  $checkCode = $LASTEXITCODE

  Step 6 'Concluído'
  try { Invoke-RestMethod -Uri ($cfg.serverUrl + '/installer/report') -Method Post -ContentType 'application/json' -Headers $headers -Body (@{ ok = $true; message = 'installed'; machine = $env:COMPUTERNAME; version = $ver } | ConvertTo-Json) -TimeoutSec 20 | Out-Null } catch { }
  if ($checkCode -eq 0) {
    Big 'INSTALAÇÃO CONCLUÍDA' 'Green'
    Say '  O posto está instalado e ligado à loja.' 'Green'
    Say '  Já pode fechar esta janela. O ecrã do quiosque abre sozinho sempre que o computador liga.' 'Green'
  } else {
    Big 'INSTALAÇÃO CONCLUÍDA, MAS FALTA VERIFICAR ALGO' 'Yellow'
    Say '  Os programas foram instalados mas um dos testes finais não passou (veja acima).' 'Yellow'
    Say ('  Envie-nos o ficheiro "Diagnostico-' + $cfg.slug + '.zip" que está no Ambiente de trabalho: ' + $Support) 'Yellow'
  }
}
catch {
  $msg = $_.Exception.Message
  $plain = switch -Regex ($msg) {
    '^NET:' { $msg -replace '^NET:\s*', '' }
    '^DOWNLOAD:' { $msg -replace '^DOWNLOAD:\s*', '' }
    '^FILES:' { $msg -replace '^FILES:\s*', '' }
    '^INSTALL:' { $msg -replace '^INSTALL:\s*', '' }
    default { 'Ocorreu um problema inesperado.' }
  }
  Big 'A INSTALAÇÃO NÃO FICOU COMPLETA' 'Red'
  Say ('  ' + $plain) 'Red'
  Say '  O que fazer: execute este ficheiro outra vez (não estraga nada). Se voltar a falhar,' 'Yellow'
  Say ('  envie-nos o ficheiro "Diagnostico-' + $cfg.slug + '.zip" que ficou no Ambiente de trabalho para ' + $Support + '.') 'Yellow'
  Report $msg
  try { Stop-Transcript | Out-Null } catch { }
  try {
    $zipOut = Join-Path $Desktop ('Diagnostico-' + $cfg.slug + '.zip')
    if (Test-Path $zipOut) { Remove-Item $zipOut -Force }
    Compress-Archive -Path (Join-Path $LogDir '*.log') -DestinationPath $zipOut -Force
    Say ('  Criado: ' + $zipOut) 'Gray'
  } catch { }
  exit 1
}
try { Stop-Transcript | Out-Null } catch { }

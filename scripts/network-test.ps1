# Communications test of the shop PC: run it BEFORE and AFTER a change of cables / adapter / switch and compare the two results.
#   powershell -ExecutionPolicy Bypass -File scripts\network-test.ps1 -Label antes-cat8
# Read-only and gentle: pings and counters only. It NEVER opens a connection to the controller (the hardware bridge owns that
# session). Takes about 70 seconds. The result is printed and written to logs\network-test-<label>.txt.
param([string]$Label = (Get-Date -Format 'yyyyMMdd-HHmm'), [string]$Controller = '192.168.2.201', [int]$Count = 60)
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "logs\network-test-$Label.txt"
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
$lines = New-Object System.Collections.Generic.List[string]
function Say($t) { $lines.Add($t); Write-Output $t }

$gw = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1).NextHop
$targets = @(
  @{ name = "Controlador $Controller"; host = $Controller },
  @{ name = "Router/gateway $gw"; host = $gw },
  @{ name = 'Internet 1.1.1.1'; host = '1.1.1.1' },
  @{ name = 'Servidor central (Hetzner)'; host = '128.140.118.209' }
) | Where-Object { $_.host }

# the four pings run at the same time (same minute, same conditions)
$jobs = foreach ($t in $targets) {
  Start-Job -ArgumentList $t.host, $Count -ScriptBlock {
    param($h, $n)
    $r = @(Test-Connection -ComputerName $h -Count $n -ErrorAction SilentlyContinue)
    $ms = @($r | ForEach-Object { if ($_.ResponseTime -ne $null) { [double]$_.ResponseTime } elseif ($_.Latency -ne $null) { [double]$_.Latency } })
    [pscustomobject]@{ host = $h; sent = $n; got = $ms.Count; ms = $ms }
  }
}

Say "=== Teste de comunicações: $Label  ($(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))"
Say ''
Say '--- Placa de rede (cabo)'
Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object {
  $st = Get-NetAdapterStatistics -Name $_.Name -ErrorAction SilentlyContinue
  Say ("{0}: {1}, velocidade {2}, duplex {3}" -f $_.Name, $_.InterfaceDescription, $_.LinkSpeed, $_.FullDuplex)
  if ($st) { Say ("  erros recebidos {0}, descartados {1}; erros enviados {2}, descartados {3}" -f $st.ReceivedPacketErrors, $st.ReceivedDiscardedPackets, $st.OutboundPacketErrors, $st.OutboundDiscardedPackets) }
}

$null = Wait-Job $jobs -Timeout 150
Say ''
Say "--- Ping ($Count pedidos a cada destino, em simultâneo)"
foreach ($j in $jobs) {
  $r = Receive-Job $j -ErrorAction SilentlyContinue
  $name = ($targets | Where-Object { $_.host -eq $r.host }).name
  if (-not $r) { Say "${name}: sem resultado"; continue }
  $loss = [math]::Round(100 * ($r.sent - $r.got) / $r.sent, 1)
  if ($r.got -gt 0) {
    $avg = ($r.ms | Measure-Object -Average).Average
    $sd = [math]::Sqrt((($r.ms | ForEach-Object { ($_ - $avg) * ($_ - $avg) }) | Measure-Object -Sum).Sum / $r.got)
    $mx = ($r.ms | Measure-Object -Maximum).Maximum; $mn = ($r.ms | Measure-Object -Minimum).Minimum
    Say ("{0,-34} perda {1,5}%  min {2,6} / média {3,7:N1} / máx {4,6} ms  variação {5:N1} ms" -f $name, $loss, $mn, $avg, $mx, $sd)
  } else { Say ("{0,-34} perda {1,5}%  (sem resposta{2})" -f $name, $loss, $(if ($r.host -eq $Controller) { ': o controlador pode não responder a ping' } else { '' })) }
}
Remove-Job $jobs -Force -ErrorAction SilentlyContinue

Say ''
Say '--- Servidor central (HTTPS, 10 pedidos)'
$t = @(1..10 | ForEach-Object { $sw = [Diagnostics.Stopwatch]::StartNew(); try { $null = Invoke-WebRequest -UseBasicParsing -Uri 'https://freshbubbles.pt/api/health' -TimeoutSec 10; $sw.ElapsedMilliseconds } catch { -1 }; Start-Sleep -Milliseconds 300 })
$ok = @($t | Where-Object { $_ -ge 0 })
if ($ok.Count) { Say ("respostas {0}/10, média {1:N0} ms, máx {2} ms" -f $ok.Count, ($ok | Measure-Object -Average).Average, ($ok | Measure-Object -Maximum).Maximum) } else { Say 'sem resposta' }

Say ''
Say '--- Velocidade da internet (Cloudflare: 2 x 25 MB a descarregar, 10 MB a enviar; nada fica guardado)'
function Speed-Down($bytes) {
  try {
    $req = [Net.HttpWebRequest]::Create("https://speed.cloudflare.com/__down?bytes=$bytes"); $req.Timeout = 30000; $req.ReadWriteTimeout = 30000
    $sw = [Diagnostics.Stopwatch]::StartNew(); $resp = $req.GetResponse(); $s = $resp.GetResponseStream(); $buf = New-Object byte[] 262144; $n = 0; $total = 0
    while (($n = $s.Read($buf, 0, $buf.Length)) -gt 0) { $total += $n }
    $sw.Stop(); $resp.Close()
    return [math]::Round(($total * 8 / 1e6) / ($sw.ElapsedMilliseconds / 1000), 1)
  } catch { return -1 }
}
function Speed-Up($bytes) {
  try {
    $req = [Net.HttpWebRequest]::Create('https://speed.cloudflare.com/__up'); $req.Method = 'POST'; $req.Timeout = 30000; $req.ContentLength = $bytes; $req.AllowWriteStreamBuffering = $false
    $data = New-Object byte[] 65536; (New-Object Random).NextBytes($data)
    $sw = [Diagnostics.Stopwatch]::StartNew(); $s = $req.GetRequestStream(); $sent = 0
    while ($sent -lt $bytes) { $k = [Math]::Min($data.Length, $bytes - $sent); $s.Write($data, 0, $k); $sent += $k }
    $s.Close(); $resp = $req.GetResponse(); $resp.Close(); $sw.Stop()
    return [math]::Round(($bytes * 8 / 1e6) / ($sw.ElapsedMilliseconds / 1000), 1)
  } catch { return -1 }
}
$d1 = Speed-Down 25000000; $d2 = Speed-Down 25000000; $u1 = Speed-Up 10000000
Say ("descarregar: {0} e {1} Mbps   enviar: {2} Mbps   (-1 = falhou)" -f $d1, $d2, $u1)

Say ''
Say '--- Tailscale'
$ts = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
if (Test-Path $ts) { (& $ts status 2>&1 | Select-Object -First 4) | ForEach-Object { Say $_ } } else { Say 'não instalado' }

Say ''
Say '--- Quedas da ligação ao controlador (bridge.log, tudo o que o ficheiro guarda)'
$bl = Join-Path $root 'logs\bridge.log'
if (Test-Path $bl) {
  $drops = @(Select-String -Path $bl -Pattern 'controller connected' | ForEach-Object { $_.Line })
  Say ("reconexões registadas: {0}" -f $drops.Count)
  $drops | Select-Object -Last 6 | ForEach-Object { Say ('  ' + $_.Substring(0, [Math]::Min(150, $_.Length))) }
} else { Say 'sem bridge.log' }

$lines | Set-Content -Path $out -Encoding UTF8
Say ''
Say "Guardado em $out"

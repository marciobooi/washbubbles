<#
.SYNOPSIS
  First-run installer for a WashBubbles kiosk PC (Windows 10/11, x64).

.DESCRIPTION
  Sets up everything the app needs on a NEW PC that will replace the old LMA
  kiosk PC in the shop:

    1. Node.js LTS and MongoDB Community (via winget, only if missing)
    2. npm dependencies, web UI build, backend\.env with generated secrets
    3. First-time database seed (admin/kiosk users, default settings)
    4. Hardware LAN: static IP on the NIC cabled to the low-level controller
       (shop: this PC 192.168.2.190/24 -> controller 192.168.2.201:16852)
    5. Power plan (never sleep on AC), autostart at logon, kiosk browser launcher

  Safe to re-run: finished steps are skipped, existing .env values and users are
  never overwritten. Writes a log to logs\install-<timestamp>.log.

  IMPORTANT - controller safety: the shop controller may accept only ONE client.
  Do not start the new PC's app while the old PC is still connected to it. The
  installer never opens a TCP connection to the controller unless you pass
  -CheckController.

.PARAMETER HardwareNic
  Name of the network adapter cabled to the hardware controller (e.g. "Ethernet").
  If omitted you are asked (or the step is skipped with -NonInteractive).

.PARAMETER DryRun
  Print what would be done without changing anything.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 -HardwareNic "Ethernet" -DryRun
#>
[CmdletBinding()]
param(
  [string]$HardwareNic = '',
  [string]$HardwareIp = '192.168.2.190',
  [int]$HardwarePrefix = 24,
  [string]$ControllerHost = '192.168.2.201',
  [int]$ControllerPort = 16852,
  [int]$Port = 3000,
  [string]$KioskUser = $env:USERNAME,
  [switch]$SkipNetwork,
  [switch]$SkipPower,
  [switch]$SkipAutostart,
  [switch]$SkipSeed,
  [switch]$CheckController,
  [string]$ConfigFile = '',     # written by the admin's "Gerar instalacao do posto" (shop, server, key, network)
  [switch]$NonInteractive,
  [switch]$DryRun,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Marker = Join-Path $Root '.installed'
$LogDir = Join-Path $Root 'logs'
$EnvFile = Join-Path $Root 'backend\.env'

# Settings from the shop's installer file: the network of the post, and the link to the central server.
$SyncUrl = ''; $SyncKey = ''; $ShopName = ''; $ShopTenant = ''
if ($ConfigFile -and (Test-Path $ConfigFile)) {
  $cfg = Get-Content $ConfigFile -Raw | ConvertFrom-Json
  $ShopName = [string]$cfg.shopName; $ShopTenant = [string]$cfg.tenantId
  $SyncUrl = [string]$cfg.serverUrl; $SyncKey = [string]$cfg.key
  if ($cfg.hardware.pcIp) { $HardwareIp = [string]$cfg.hardware.pcIp }
  if ($cfg.hardware.controllerHost) { $ControllerHost = [string]$cfg.hardware.controllerHost }
  if ($cfg.hardware.controllerPort) { $ControllerPort = [int]$cfg.hardware.controllerPort }
}

# ---------------------------------------------------------------- helpers ----
function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Step($n, $title) { Say ("`n[{0}] {1}" -f $n, $title) 'Cyan' }
function Ok($msg) { Say ("    OK  " + $msg) 'Green' }
function Warn($msg) { Say ("    !!  " + $msg) 'Yellow' }
function Todo($msg) { Say ("    DRY " + $msg) 'DarkYellow' }

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# winget/MSI installers update PATH in the registry, not in this session.
function Update-SessionPath {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

function New-Secret([int]$bytes = 24) {
  $b = New-Object byte[] $bytes
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($b)
  return ($b | ForEach-Object { $_.ToString('x2') }) -join ''
}

function Run($file, $arguments, $workDir = $Root) {
  Say ("    > $file $arguments") 'DarkGray'
  if ($DryRun) { return }
  Push-Location $workDir
  try {
    & $file @arguments
    if ($LASTEXITCODE -ne 0) { throw "$file exited with code $LASTEXITCODE" }
  } finally { Pop-Location }
}

function Read-DotEnv($path) {
  $map = @{}
  if (Test-Path $path) {
    foreach ($line in Get-Content $path) {
      if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') { $map[$Matches[1]] = $Matches[2] }
    }
  }
  return $map
}

# Plain download of an installer from the vendor, accepted only when its digital signature is valid (used when winget is missing).
function Install-Msi($label, $url, $msiArgs) {
  Say "    > downloading $label from $url" 'DarkGray'
  if ($DryRun) { return }
  $f = Join-Path $env:TEMP (Split-Path $url -Leaf)
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $url -OutFile $f -UseBasicParsing
  $sig = Get-AuthenticodeSignature $f
  if ($sig.Status -ne 'Valid') { throw "$label installer has no valid digital signature - refusing to run it." }
  $p = Start-Process msiexec.exe -ArgumentList (@('/i', "`"$f`"") + $msiArgs) -Wait -PassThru
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { throw "$label installer exited with code $($p.ExitCode)" }
}

function Set-EnvValue($path, $key, $value) {
  $lines = @(); if (Test-Path $path) { $lines = @(Get-Content $path) }
  $found = $false
  $lines = $lines | ForEach-Object { if ($_ -match "^\s*#?\s*$key=") { if (-not $found) { $found = $true; "$key=$value" } } else { $_ } }
  if (-not $found) { $lines += "$key=$value" }
  Set-Content -Path $path -Value $lines -Encoding ASCII
}

function Confirm($question) {
  if ($NonInteractive) { return $false }
  $a = Read-Host "$question [y/N]"
  return ($a -match '^(y|yes|s|sim)$')
}

# ---------------------------------------------------------------- start ------
if (-not (Test-Admin)) {
  if ($DryRun) { Warn 'Not elevated - a real run needs Administrator (dry run continues).' }
  else {
    Say 'Administrator rights are required - relaunching elevated...' 'Yellow'
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    foreach ($kv in $PSBoundParameters.GetEnumerator()) {
      if ($kv.Value -is [switch]) { if ($kv.Value.IsPresent) { $argList += "-$($kv.Key)" } }
      else { $argList += "-$($kv.Key)"; $argList += "`"$($kv.Value)`"" }
    }
    Start-Process powershell -Verb RunAs -ArgumentList $argList -Wait
    exit $LASTEXITCODE
  }
}

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$log = Join-Path $LogDir ("install-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
try { Start-Transcript -Path $log | Out-Null } catch { }

Say '=== WashBubbles kiosk installer ===' 'White'
Say "Project folder : $Root"
Say "Log file       : $log"
if ($DryRun) { Say 'DRY RUN - nothing will be changed.' 'Yellow' }

$firstRun = -not (Test-Path $Marker)
if (-not $firstRun -and -not $Force) { Say 'Already installed - re-checking each step (use -Force to rebuild everything).' 'Yellow' }

try {
  # ------------------------------------------------------------ prerequisites
  Step 1 'Prerequisites (Node.js LTS, MongoDB)'
  $haveWinget = [bool](Get-Command winget -ErrorAction SilentlyContinue)

  $nodeOk = $false
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    $v = (& node -v) -replace '^v', ''
    if ([int]($v.Split('.')[0]) -ge 20) { $nodeOk = $true; Ok "Node.js $v" }
    else { Warn "Node.js $v is too old (need 20+)" }
  }
  if (-not $nodeOk) {
    if ($haveWinget) {
      Run 'winget' @('install', '-e', '--id', 'OpenJS.NodeJS.LTS', '--silent', '--accept-package-agreements', '--accept-source-agreements')
    } else {
      Install-Msi 'Node.js' 'https://nodejs.org/dist/v22.11.0/node-v22.11.0-x64.msi' @('/qn', '/norestart')
    }
    if (-not $DryRun) { Update-SessionPath; if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js could not be installed.' }; Ok ("Node.js " + (& node -v)) }
  }

  $mongo = Get-Service -Name 'MongoDB' -ErrorAction SilentlyContinue
  if (-not $mongo) {
    if ($haveWinget) {
      Run 'winget' @('install', '-e', '--id', 'MongoDB.Server', '--silent', '--accept-package-agreements', '--accept-source-agreements')
    } else {
      Install-Msi 'MongoDB' 'https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-7.0.14-signed.msi' @('/qn', '/norestart', 'ADDLOCAL=ServerService,Client')
    }
    if (-not $DryRun) { $mongo = Get-Service -Name 'MongoDB' -ErrorAction SilentlyContinue }
  }
  if ($mongo -or $DryRun) {
    if (-not $DryRun) {
      Set-Service -Name 'MongoDB' -StartupType Automatic
      if ($mongo.Status -ne 'Running') { Start-Service -Name 'MongoDB' }
      Ok 'MongoDB service running (automatic start)'
    } else { Todo 'ensure MongoDB service is Automatic + Running' }
  } else { throw 'MongoDB service not found after install. Install it manually as a Windows service and re-run.' }

  # -------------------------------------------------------------- dependencies
  Step 2 'Dependencies and configuration'
  Run 'npm' @('install', '--no-audit', '--no-fund')
  Run 'npm' @('--prefix', 'backend', 'install', '--omit=dev', '--no-audit', '--no-fund')

  if (-not (Test-Path $EnvFile)) {
    $lines = @(
      '# Generated by scripts\install-windows.ps1 - keep this file private.'
      'MONGODB_URL=mongodb://127.0.0.1:27017/washstore'
      "JWT_SECRET=$(New-Secret 32)"
      "ADMIN_PASSWORD=$(New-Secret 9)"
      "KIOSK_PASSWORD=$(New-Secret 9)"
      "KIOSK_API_KEY=$(New-Secret 24)"
      '# Central sync (optional): uncomment and fill in to send sales to the central server when online.'
      '# SYNC_SERVER_URL=https://api.washbubbles.app/api'
      '# SYNC_API_KEY='
      '# Outbound email (password reset, day-close reports, receipts) - mailbox'
      '# marcacoes@freshbubbles.pt at amen.pt. Uncomment and set MAIL_PASS from'
      '# amen.pt''s control panel (never commit it) to turn this on.'
      '# MAIL_HOST=smtp-pt.securemail.pro'
      '# MAIL_PORT=587'
      '# MAIL_USER=marcacoes@freshbubbles.pt'
      '# MAIL_PASS='
      '# MAIL_FROM=marcacoes@freshbubbles.pt'
    )
    if ($DryRun) { Todo "create $EnvFile with generated secrets" }
    else { Set-Content -Path $EnvFile -Value $lines -Encoding ASCII; Ok "created backend\.env (secrets generated, not shown)" }
  } else { Ok 'backend\.env already exists - secrets kept' }

  # Non-secret runtime settings: add only what is missing, never overwrite.
  $wanted = [ordered]@{
    PORT = "$Port"
    HOST = '127.0.0.1'
    SERVE_FRONTEND = 'true'
    LOWLEVEL_ENABLED = 'true'
    # The backend talks to the local hardware bridge (which owns the one connection to the controller).
    LOWLEVEL_HOST = '127.0.0.1'
    LOWLEVEL_PORT = '16853'
    CONTROLLER_HOST = $ControllerHost
    CONTROLLER_PORT = "$ControllerPort"
  }
  $have = Read-DotEnv $EnvFile
  $add = @()
  foreach ($k in $wanted.Keys) { if (-not $have.ContainsKey($k)) { $add += "$k=$($wanted[$k])" } }
  if ($add.Count -gt 0) {
    if ($DryRun) { Todo ("append to backend\.env: " + ($add -join ', ')) }
    else { Add-Content -Path $EnvFile -Value $add -Encoding ASCII; Ok ("added: " + ($add -join ', ')) }
  }

  # Link to the central server (from the shop's installer file).
  if ($SyncUrl -and $SyncKey -and -not $DryRun) {
    Set-EnvValue $EnvFile 'SYNC_SERVER_URL' $SyncUrl
    Set-EnvValue $EnvFile 'SYNC_API_KEY' $SyncKey
    if ($ShopTenant) { Set-EnvValue $EnvFile 'SHOP_TENANT_ID' $ShopTenant }
    Ok "linked to the central server for '$ShopName'"
  }

  # ----------------------------------------------------------------- web build
  Step 3 'Build the web UI'
  $dist = Join-Path $Root 'dist\index.html'
  if ($Force -or $firstRun -or -not (Test-Path $dist)) {
    $envMap = Read-DotEnv $EnvFile
    # The kiosk key is baked into the bundle at build time (see docker/frontend.Dockerfile).
    if ($envMap.ContainsKey('KIOSK_API_KEY')) { $env:VITE_KIOSK_API_KEY = $envMap['KIOSK_API_KEY'] }
    Run 'npm' @('run', 'build')
  } else { Ok 'dist\ already built' }

  # --------------------------------------------------------------------- seed
  Step 4 'Database (first-time seed)'
  if ($SkipSeed) { Warn 'skipped (-SkipSeed)' }
  elseif ($firstRun) {
    # The seed script resets the admin/kiosk passwords each time it runs, so it is
    # only ever run on a fresh install.
    $envMap = Read-DotEnv $EnvFile
    foreach ($k in $envMap.Keys) { Set-Item -Path "Env:$k" -Value $envMap[$k] }
    if (-not $DryRun) {
      $deadline = (Get-Date).AddSeconds(45)
      while ((Get-Date) -lt $deadline) {
        $c = New-Object Net.Sockets.TcpClient
        try { $c.Connect('127.0.0.1', 27017); $c.Close(); break } catch { Start-Sleep -Seconds 2 }
      }
    }
    Run 'npm' @('--prefix', 'backend', 'run', 'seed')
    Ok 'seeded (users: admin, kiosk; default settings and equivalence tables)'
  } else { Ok 'not first run - existing data and passwords untouched' }

  # ----------------------------------------------------------- hardware network
  Step 5 "Hardware LAN (controller $ControllerHost`:$ControllerPort)"
  if ($SkipNetwork) { Warn 'skipped (-SkipNetwork)' }
  else {
    $adapters = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' })
    $subnet = ($HardwareIp -replace '\.\d+$', '.')
    $already = $null
    foreach ($a in $adapters) {
      $ips = @(Get-NetIPAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue)
      if ($ips | Where-Object { $_.IPAddress.StartsWith($subnet) }) { $already = $a }
    }
    if ($already) { Ok "adapter '$($already.Name)' is already on ${subnet}0/$HardwarePrefix" }
    else {
      $nic = $null
      if ($HardwareNic) { $nic = $adapters | Where-Object { $_.Name -eq $HardwareNic } | Select-Object -First 1 }
      elseif ($NonInteractive) {
        # No questions for a non-technical customer: the controller's adapter is the only cabled adapter WITHOUT internet (no gateway).
        $noGw = @($adapters | Where-Object { -not (Get-NetIPConfiguration -InterfaceIndex $_.ifIndex -ErrorAction SilentlyContinue).IPv4DefaultGateway })
        if ($noGw.Count -eq 1 -and $adapters.Count -ge 2) { $nic = $noGw[0]; Say "    adapter chosen automatically: '$($nic.Name)'" 'DarkGray' }
        elseif ($adapters.Count -eq 1 -and -not (Get-NetIPConfiguration -InterfaceIndex $adapters[0].ifIndex -ErrorAction SilentlyContinue).IPv4DefaultGateway) { $nic = $adapters[0] }
      }
      elseif ($adapters.Count -gt 0) {
        Say '    Which adapter is cabled to the hardware controller?'
        for ($i = 0; $i -lt $adapters.Count; $i++) { Say ("      [{0}] {1}  ({2})" -f ($i + 1), $adapters[$i].Name, $adapters[$i].InterfaceDescription) }
        $pick = Read-Host '    Number (Enter to skip)'
        if ($pick -match '^\d+$' -and [int]$pick -ge 1 -and [int]$pick -le $adapters.Count) { $nic = $adapters[[int]$pick - 1] }
      }
      if (-not $nic) { Warn "no adapter chosen - set a static $HardwareIp/$HardwarePrefix on the controller-facing NIC yourself (no gateway)." }
      elseif ($DryRun) { Todo "set static $HardwareIp/$HardwarePrefix (no gateway) on '$($nic.Name)'" }
      else {
        # No default gateway on purpose: internet must keep using the other NIC.
        Set-NetIPInterface -InterfaceIndex $nic.ifIndex -Dhcp Disabled
        Get-NetIPAddress -InterfaceIndex $nic.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Remove-NetIPAddress -Confirm:$false
        New-NetIPAddress -InterfaceIndex $nic.ifIndex -IPAddress $HardwareIp -PrefixLength $HardwarePrefix | Out-Null
        Ok "'$($nic.Name)' = $HardwareIp/$HardwarePrefix (static, no gateway)"
      }
    }
    if (-not $DryRun) {
      if (Test-Connection -ComputerName $ControllerHost -Count 2 -Quiet -ErrorAction SilentlyContinue) { Ok "controller $ControllerHost answers ping" }
      else { Warn "controller $ControllerHost does not answer ping (it may simply not reply to ICMP, or the cable/IP is wrong)" }
      if ($CheckController) {
        $c = New-Object Net.Sockets.TcpClient
        try {
          $iar = $c.BeginConnect($ControllerHost, $ControllerPort, $null, $null)
          if ($iar.AsyncWaitHandle.WaitOne(3000) -and $c.Connected) { Ok "TCP $ControllerHost`:$ControllerPort accepts connections" } else { Warn "TCP $ControllerHost`:$ControllerPort not reachable" }
        } finally { $c.Close() }
      } else { Say '    (TCP check skipped - pass -CheckController once the old PC is OFF)' 'DarkGray' }
    }
  }

  # -------------------------------------------------------------------- power
  Step 6 'Power plan (kiosk must never sleep on AC)'
  if ($SkipPower) { Warn 'skipped (-SkipPower)' }
  elseif ($DryRun) { Todo 'powercfg: standby/monitor/hibernate timeouts on AC = never' }
  else {
    & powercfg /change standby-timeout-ac 0
    & powercfg /change monitor-timeout-ac 0
    & powercfg /change hibernate-timeout-ac 0
    Ok 'sleep, screen-off and hibernate disabled on AC power'
  }

  # ---------------------------------------------------------------- autostart
  Step 7 'Autostart at logon'
  if ($SkipAutostart) { Warn 'skipped (-SkipAutostart)' }
  else {
    $bat = Join-Path $Root 'start-kiosk.bat'
    if ($DryRun) { Todo "register scheduled task 'WashBubbles Kiosk' for $KioskUser -> $bat" }
    else {
      # Hidden: a visible console window on top of the kiosk screen is not wanted. PowerShell starts the batch file with no window.
      $hiddenCmd = "Start-Process -WindowStyle Hidden -FilePath cmd.exe -ArgumentList '/c','`"$bat`"'"
      $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command `"$hiddenCmd`"" -WorkingDirectory $Root
      $trigger = New-ScheduledTaskTrigger -AtLogOn -User $KioskUser
      $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
      Register-ScheduledTask -TaskName 'WashBubbles Kiosk' -Action $action -Trigger $trigger -Settings $settings -User $KioskUser -RunLevel Limited -Force | Out-Null
      Ok "task 'WashBubbles Kiosk' runs start-kiosk.bat when $KioskUser logs on"

      # The backend itself starts at BOOT as SYSTEM, so sales/sync/hardware keep working
      # even if nobody has logged in (e.g. after a power cut). start-kiosk.bat reuses it.
      $runBackend = Join-Path $Root 'scripts\run-backend.bat'
      $bAction = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$runBackend`"" -WorkingDirectory $Root
      $bTrigger = New-ScheduledTaskTrigger -AtStartup
      $bTrigger.Delay = 'PT30S'   # let the MongoDB service come up first
      $bPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
      Register-ScheduledTask -TaskName 'WashBubbles Backend' -Action $bAction -Trigger $bTrigger -Settings $settings -Principal $bPrincipal -Force | Out-Null
      Ok "task 'WashBubbles Backend' runs the backend at boot (no login needed)"

      # The hardware bridge owns the controller connection and starts BEFORE the backend (no delay), so the
      # backend can be restarted or updated without the controller seeing a disconnect.
      $runBridge = Join-Path $Root 'scripts\run-bridge.bat'
      $brAction = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$runBridge`"" -WorkingDirectory $Root
      $brTrigger = New-ScheduledTaskTrigger -AtStartup
      Register-ScheduledTask -TaskName 'WashBubbles Bridge' -Action $brAction -Trigger $brTrigger -Settings $settings -Principal $bPrincipal -Force | Out-Null
      Ok "task 'WashBubbles Bridge' keeps the controller connection at boot"

      # Windows (security, Defender; never drivers) and Tailscale updates, 5 minutes after the PC starts (the kiosk is up first).
      # Never restarts the PC: what needs a restart finishes with the night's shutdown. See scripts/windows-morning-updates.ps1.
      $mu = Join-Path $Root 'scripts\windows-morning-updates.ps1'
      $muAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$mu`"" -WorkingDirectory $Root
      $muTrigger = New-ScheduledTaskTrigger -AtStartup
      $muTrigger.Delay = 'PT5M'
      $muSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
      Register-ScheduledTask -TaskName 'WashBubbles Morning Updates' -Action $muAction -Trigger $muTrigger -Settings $muSettings -Principal $bPrincipal -Force | Out-Null
      Ok "task 'WashBubbles Morning Updates' installs Windows and Tailscale updates after each start (no drivers, no restart)"

      # Automatic updates every minute: a PC installed from the central server (no git folder) updates from it.
      if ($SyncUrl) {
        $upd = Join-Path $Root 'scripts\kiosk-update-bundle.ps1'
        $uAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$upd`"" -WorkingDirectory $Root
        $uTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 5)
        Register-ScheduledTask -TaskName 'WashBubbles Update' -Action $uAction -Trigger $uTrigger -Settings $settings -Principal $bPrincipal -Force | Out-Null
        Ok "task 'WashBubbles Update' checks the central server for a new version every 5 minutes"
      }
    }
  }

  # ------------------------------------------------------------------- finish
  if (-not $DryRun) {
    $info = [ordered]@{ installedAt = (Get-Date).ToString('s'); machine = $env:COMPUTERNAME; node = (& node -v); controller = "$ControllerHost`:$ControllerPort" }
    $info | ConvertTo-Json | Set-Content -Path $Marker -Encoding ASCII
  }
  if ($ConfigFile -and -not $DryRun) {
    # Start everything now (no need to wait for a reboot). The bridge first: it owns the one connection to the controller.
    foreach ($t in 'WashBubbles Bridge', 'WashBubbles Backend') { try { Start-ScheduledTask -TaskName $t; Start-Sleep -Seconds 4 } catch { Warn "could not start $t" } }
    try { Start-ScheduledTask -TaskName 'WashBubbles Kiosk' } catch { Warn 'could not start the kiosk screen' }
  }
  Say "`n=== Done ===" 'Green'
  Say "  Web UI / admin : http://localhost:$Port   (admin password is in backend\.env)"
  Say '  Start now      : start-kiosk.bat   (it also runs at every logon)'
  Say '  Before going live:'
  Say '    * Switch the OLD PC off first - the controller may accept only one client.'
  Say '    * Central sync: put SYNC_SERVER_URL and SYNC_API_KEY in backend\.env (see docs section 14). Sales, cards and day-closes queue locally until then.'
  Say '    * Admin > Peripherals: keep the controller-bus addresses (coin 2, hopper 3, card 22, bill 40 ...).'
  Say '    * Optional, manual: Windows auto-logon for the kiosk user, and remote access (AnyDesk/TeamViewer).'
  Say "  Full reference : docs\SHOP-HARDWARE-AND-COMMUNICATIONS.md"
}
catch {
  Say "`nINSTALL FAILED: $($_.Exception.Message)" 'Red'
  Say "Details are in $log" 'Red'
  try { Stop-Transcript | Out-Null } catch { }
  exit 1
}
try { Stop-Transcript | Out-Null } catch { }

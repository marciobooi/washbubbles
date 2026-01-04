# Production Deployment - Packaged Executables

## The Right Way: Minimal POS Installation

Instead of installing Node.js and source code on every POS machine, we package everything into standalone executables.

### What the POS Machine Needs

```
C:\WashBubbles\
├── WashBubblesPOS.exe           ← Electron app (10-80 MB)
├── hardware-agent.exe            ← Hardware agent (30-50 MB)  
├── config.json                   ← Configuration file
└── start.bat                     ← Simple startup script
```

**Total size: ~100 MB** (vs 500+ MB with full installation)
**Requirements: NONE!** (no Node.js, no npm, nothing)

## Building the Packages (On Development Machine)

### 1. Build Electron Executable

```bash
# On your development machine
cd washbubbles
npm install
npm run build
npm run package:electron
```

This creates: `dist-electron/WashBubbles POS Setup.exe`

### 2. Build Hardware Agent Executable

```bash
npm run package:agent
```

This creates: `dist-agent/hardware-agent.exe`

### 3. Create Deployment Package

```bash
# Create deployment folder
mkdir POS-Deploy
cd POS-Deploy

# Copy executables
copy ..\dist-electron\WashBubbles*.exe .
copy ..\dist-agent\hardware-agent.exe .

# Create config template
echo { > config.json
echo   "serverUrl": "http://192.168.1.100:3000", >> config.json
echo   "apiKey": "your-kiosk-api-key", >> config.json
echo   "comPorts": { >> config.json
echo     "coin": "COM1", >> config.json
echo     "bill": "COM2", >> config.json
echo     "interface": "COM3", >> config.json
echo     "hopper": "COM4", >> config.json
echo     "cardDispenser": "COM5", >> config.json
echo     "printer": "COM6", >> config.json
echo     "rfid": "COM7" >> config.json
echo   } >> config.json
echo } >> config.json
```

## Deployment to POS Machines

### Method 1: USB Drive

1. Copy `POS-Deploy` folder to USB
2. Insert USB in POS machine
3. Copy to `C:\WashBubbles`
4. Edit `config.json` with correct values
5. Run `WashBubblesPOS.exe`

### Method 2: Network Share

```bash
# On server
net share deploy=C:\deploy\POS-Deploy /GRANT:Everyone,READ

# On POS machine
xcopy /E /I \\server\deploy C:\WashBubbles
cd C:\WashBubbles
notepad config.json  # Edit configuration
WashBubblesPOS.exe
```

### Method 3: Installer (Best for Multiple POS)

Create an NSIS installer that:
1. Copies files to `C:\Program Files\WashBubbles`
2. Prompts for server URL and API key
3. Creates config.json
4. Adds to startup
5. Creates desktop shortcut

## Configuration File

`config.json`:

```json
{
  "serverUrl": "http://192.168.1.100:3000",
  "apiKey": "ksk_store1_abc123",
  "storeId": "store1",
  "comPorts": {
    "coin": "COM1",
    "bill": "COM2",
    "interface": "COM3",
    "interfaceId": "507f1f77bcf86cd799439011",
    "hopper": "COM4",
    "cardDispenser": "COM5",
    "printer": "COM6",
    "rfid": "COM7"
  },
  "autoStart": true,
  "kioskMode": true
}
```

## Simple Startup Script

`start.bat`:

```batch
@echo off
echo Starting WashBubbles POS...

REM Start hardware agent in background
start "Hardware Agent" /MIN hardware-agent.exe config.json

REM Wait a moment
timeout /t 2 /nobreak >nul

REM Start POS UI
start "WashBubbles POS" WashBubblesPOS.exe config.json

echo POS started successfully!
```

## Auto-Start Configuration

**Task Scheduler:**
1. Task name: WashBubbles POS
2. Trigger: At startup
3. Action: `C:\WashBubbles\start.bat`
4. Run with highest privileges

## Updating POS Machines

### Simple Update Process

1. Build new executables on dev machine
2. Copy new .exe files to POS machines
3. Restart POS

**No npm install, no build step, no hassle!**

### Automated Update Script

```batch
REM update-pos.bat
@echo off
echo Updating WashBubbles POS...

REM Stop running instances
taskkill /IM WashBubblesPOS.exe /F >nul 2>&1
taskkill /IM hardware-agent.exe /F >nul 2>&1

REM Copy new files from network share
echo Copying updates...
copy /Y \\server\deploy\WashBubblesPOS.exe .
copy /Y \\server\deploy\hardware-agent.exe .

echo Update complete!
echo Restarting...
start.bat
```

## Configuration Tool (Optional)

Create a simple config GUI:

`config-tool.html`:

```html
<!DOCTYPE html>
<html>
<head>
    <title>WashBubbles POS Configuration</title>
    <style>
        body { font-family: Arial; max-width: 600px; margin: 50px auto; }
        label { display: block; margin: 10px 0 5px; font-weight: bold; }
        input { width: 100%; padding: 8px; }
        button { margin-top: 20px; padding: 10px 20px; background: #007bff; color: white; border: none; cursor: pointer; }
    </style>
</head>
<body>
    <h1>WashBubbles POS Configuration</h1>
    <form id="configForm">
        <label>Server URL:</label>
        <input type="text" id="serverUrl" placeholder="http://192.168.1.100:3000" required>
        
        <label>API Key:</label>
        <input type="text" id="apiKey" placeholder="ksk_abc123..." required>
        
        <label>Store ID:</label>
        <input type="text" id="storeId" placeholder="store1" required>
        
        <h3>COM Ports</h3>
        <label>Coin Acceptor:</label>
        <input type="text" id="comCoin" placeholder="COM1">
        
        <label>Bill Acceptor:</label>
        <input type="text" id="comBill" placeholder="COM2">
        
        <label>Interface:</label>
        <input type="text" id="comInterface" placeholder="COM3">
        
        <button type="submit">Save Configuration</button>
    </form>
    
    <script>
        document.getElementById('configForm').onsubmit = function(e) {
            e.preventDefault();
            const config = {
                serverUrl: document.getElementById('serverUrl').value,
                apiKey: document.getElementById('apiKey').value,
                storeId: document.getElementById('storeId').value,
                comPorts: {
                    coin: document.getElementById('comCoin').value,
                    bill: document.getElementById('comBill').value,
                    interface: document.getElementById('comInterface').value,
                }
            };
            
            // In real implementation, this would write to config.json
            alert('Configuration saved! Copy this to config.json:\n\n' + JSON.stringify(config, null, 2));
        };
    </script>
</body>
</html>
```

## Comparison: Old vs New Deployment

### ❌ Old Way (Overcomplicated)

```
POS Machine Requirements:
- Install Node.js (150 MB)
- Install Git
- Clone repository
- npm install (250 MB node_modules)
- npm run build
- Configure multiple files
- Total: 500+ MB, 30+ minutes

Updates:
- git pull
- npm install
- npm run build
- Restart
```

### ✅ New Way (Simple)

```
POS Machine Requirements:
- Copy 2 exe files (100 MB total)
- Edit 1 config file
- Run
- Total: 100 MB, 5 minutes

Updates:
- Copy new exe files
- Restart
```

## Benefits

✅ **No Node.js required** on POS machines
✅ **No source code** on POS machines
✅ **Smaller installation** (100 MB vs 500+ MB)
✅ **Faster deployment** (5 min vs 30+ min)
✅ **Easier updates** (copy files vs rebuild)
✅ **More secure** (compiled code, no package vulnerabilities)
✅ **Faster startup** (no Node.js overhead)

## Known Limitations

### Hardware Agent Packaging

The `pkg` tool has limitations with native modules like `serialport`. Options:

1. **Use serialport with pkg patches** (may work)
2. **Use alternative:** Bundle with Node.js runtime (nexe)
3. **Hybrid approach:** Keep agent as Node.js script but package Electron

### Recommended Approach

**Electron:** Package as .exe (works perfectly)
**Hardware Agent:** Include minimal Node.js runtime

```
C:\WashBubbles\
├── WashBubblesPOS.exe           ← Packaged Electron (80 MB)
├── node.exe                      ← Minimal Node runtime (30 MB)
├── hardware-agent/               ← Agent code + dependencies (50 MB)
│   ├── agent.js
│   └── node_modules/
├── config.json
└── start.bat
```

**Total: ~160 MB** (still much better than 500+ MB)

## Build Script

`build-deployment.bat`:

```batch
@echo off
echo Building WashBubbles Deployment Package...

REM Clean previous builds
rmdir /S /Q dist-electron 2>nul
rmdir /S /Q POS-Deploy 2>nul

REM Build frontend
echo Building frontend...
call npm run build

REM Package Electron
echo Packaging Electron app...
call npm run package:electron

REM Create deployment folder
mkdir POS-Deploy
cd POS-Deploy

REM Copy Electron exe
echo Copying Electron exe...
copy ..\dist-electron\*.exe WashBubblesPOS.exe

REM Copy Node.js runtime for agent
echo Copying Node.js runtime...
mkdir hardware-agent
copy "%ProgramFiles%\nodejs\node.exe" .

REM Copy agent files
xcopy /E /I ..\backend\src hardware-agent\src
xcopy /E /I ..\backend\node_modules hardware-agent\node_modules

REM Create config template
echo Creating config template...
(
echo {
echo   "serverUrl": "http://YOUR-SERVER-IP:3000",
echo   "apiKey": "YOUR-KIOSK-API-KEY",
echo   "comPorts": {
echo     "coin": "COM1",
echo     "bill": "COM2",
echo     "interface": "COM3",
echo     "hopper": "COM4",
echo     "cardDispenser": "COM5",
echo     "printer": "COM6",
echo     "rfid": "COM7"
echo   }
echo }
) > config.json

REM Create startup script
(
echo @echo off
echo start "Hardware Agent" /MIN node hardware-agent\src\agentServer.js config.json
echo timeout /t 2 /nobreak ^>nul
echo start "POS" WashBubblesPOS.exe config.json
) > start.bat

echo.
echo ========================================
echo Deployment package created in POS-Deploy\
echo ========================================
echo.
echo Next steps:
echo 1. Copy POS-Deploy folder to USB drive
echo 2. On POS machine: copy to C:\WashBubbles
echo 3. Edit config.json with correct values
echo 4. Run start.bat
echo.
pause
```

Run: `build-deployment.bat`

This creates a ready-to-deploy package!

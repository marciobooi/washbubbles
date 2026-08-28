================================================================================
                      WASHBUBBLES POS CLIENT SETUP
================================================================================

This folder contains everything needed to run a POS terminal that connects to
your remote WashBubbles server.

REQUIREMENTS:
- Windows PC with serial ports (COM1, COM2, etc.)
- Node.js installed (https://nodejs.org/)
- Network connection to the server

================================================================================
                           QUICK START
================================================================================

1. EDIT start-pos.bat
   - Change SERVER_URL to your server's IP/hostname
   - Change KIOSK_API_KEY to your KIOSK user's API key

2. EDIT config.json
   - Set the correct COM ports for your hardware
   - Enable/disable peripherals as needed

3. RUN start-pos.bat
   - Double-click to start
   - Everything runs inside one Electron window: local database, hardware
     agent, background sync engine, and the POS interface itself

================================================================================
                          CONFIGURATION
================================================================================

config.json settings:

{
  "serverUrl": "ws://YOUR-SERVER-IP:3000/hardware-agent",
  "apiKey": "YOUR-KIOSK-API-KEY",
  "peripherals": {
    "coin_acceptor": { "enabled": true, "port": "COM1" },
    "bill_acceptor": { "enabled": true, "port": "COM2" },
    "interface": { "enabled": true, "port": "COM3" },
    "hopper": { "enabled": true, "port": "COM4" },
    "card_dispenser": { "enabled": true, "port": "COM5" },
    "printer": { "enabled": true, "port": "COM6" },
    "rfid_reader": { "enabled": true, "port": "COM7" }
  }
}

================================================================================
                            FILES
================================================================================

start-pos.bat    - Main startup script (edit SERVER_URL and KIOSK_API_KEY)
config.json      - Hardware configuration (edit COM ports)
electron/        - Electron app: local DB, embedded hardware agent, sync engine, UI shell
package.json     - Dependencies (don't modify)

================================================================================
                         TROUBLESHOOTING
================================================================================

"Node.js is not installed"
  → Download and install from https://nodejs.org/

"API key error"
  → Check that KIOSK_API_KEY in start-pos.bat matches your server's kiosk user

"Cannot connect to server"
  → Check SERVER_URL is correct
  → Check firewall allows port 3000
  → Check server is running

"Serial port not found"
  → Check Device Manager for correct COM port numbers
  → Update config.json with correct ports

================================================================================
                           SUPPORT
================================================================================

For help, contact your system administrator.

================================================================================

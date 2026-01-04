# Hardware Agent - Quick Start Guide

## What is the Hardware Agent?

The Hardware Agent is a lightweight service that runs on your local POS machine and manages all physical peripherals (coin acceptor, washing machines, printer, etc.). It communicates with your remote backend server via WebSocket.

## Why Do We Need It?

Your backend server runs on a remote server/cloud, but your physical hardware (serial ports) is connected to the local POS machine. The Hardware Agent bridges this gap:

```
[Local Hardware] ←→ [Hardware Agent] ←→ [Remote Server]
```

## Installation Steps

### Step 1: Configure the Agent

1. Navigate to `backend` folder
2. Copy `.env.agent.example` to `.env.agent`
3. Edit `.env.agent`:

```bash
# Your remote server's WebSocket URL
HARDWARE_SERVER_URL=ws://192.168.1.100:3000/hardware-agent

# Your kiosk API key (get this from the admin dashboard)
HARDWARE_AGENT_API_KEY=your-api-key-here
```

### Step 2: Configure COM Ports

Edit `backend/src/agentServer.js` and configure your COM ports:

```javascript
const config = {
  // ... other config ...
  peripherals: {
    'COM1': {
      type: 'coin_acceptor',
      baudRate: 9600,
      address: 2,
    },
    'COM2': {
      type: 'bill_acceptor',
      baudRate: 9600,
      address: 40,
    },
    'COM3': {
      type: 'interface',
      baudRate: 9600,
      interfaceId: 'your-interface-id-from-admin', // Get from admin dashboard
      address: 16,
    },
    // Add more peripherals as needed...
  },
}
```

#### How to Find COM Ports (Windows)

1. Open **Device Manager** (Win + X → Device Manager)
2. Expand **Ports (COM & LPT)**
3. Note the COM port numbers for each device:
   - USB Serial Port (COM1) → Coin Acceptor
   - USB Serial Port (COM2) → Bill Acceptor
   - etc.

### Step 3: Get Your API Key

1. Go to Admin Dashboard → Users
2. Find your KIOSK user
3. Copy the API Key
4. Paste it in `.env.agent`

### Step 4: Start the Agent

Double-click: `start-hardware-agent.bat`

Or from command line:
```bash
cd backend
node --env-file=.env.agent src/agentServer.js
```

## Verify It's Working

### Check Agent Output

You should see:
```
[HardwareAgent] Starting...
[HardwareAgent] Connecting coin_acceptor on COM1...
[HardwareAgent] coin_acceptor connected on COM1
[HardwareAgent] Connecting to server: ws://192.168.1.100:3000/hardware-agent
[HardwareAgent] Connected to server
```

### Check Server Logs

On your remote server, you should see:
```
[HardwareAgentServer] Agent connected: KIOSK_POS_1 (65abc123...)
[HardwareAgentServer] Agent 65abc123... peripherals: [ 'COM1', 'COM2', ... ]
```

## Testing

### Test 1: Insert a Coin

1. Insert a coin into the coin acceptor
2. Check agent output:
```
[HardwareAgent] Peripheral credit event: { port: 'COM1', type: 'coin_acceptor', amount: 0.50 }
```
3. Check server logs:
```
[Backend] Peripheral credit event: { agentId: '65abc123...', port: 'COM1', amount: 0.50 }
```

### Test 2: Activate a Machine

1. In POS, select a machine and pay
2. Check agent output:
```
[HardwareAgent] Received command: machine:activate
[HardwareAgent] Machine activation sent
```
3. Machine should start

## Troubleshooting

### Problem: "Not connected to server"

**Solution:**
1. Check `HARDWARE_SERVER_URL` in `.env.agent`
2. Verify server is running
3. Check firewall settings
4. Ping the server: `ping 192.168.1.100`

### Problem: "Invalid API key"

**Solution:**
1. Verify API key in Admin → Users
2. Make sure the user role is **KIOSK** (not ADMIN)
3. Copy/paste the key carefully (no spaces)

### Problem: "Failed to connect peripheral on COMx"

**Solution:**
1. Check COM port in Device Manager
2. Verify no other program is using the port
3. Check cable connections
4. Try different COM port

### Problem: Peripheral connected but not responding

**Solution:**
1. Check baud rate matches hardware (usually 9600)
2. Verify address matches your device configuration
3. Test with a serial monitor tool (e.g., PuTTY)
4. Check cable and power supply

## Configuration Reference

### Peripheral Types

| Type | Protocol | Purpose |
|------|----------|---------|
| `coin_acceptor` | ccTalk/MDB | Accepts coins |
| `bill_acceptor` | ccTalk/MDB | Accepts bills |
| `interface` | KITSEC | Controls washing/drying machines |
| `hopper` | ccTalk | Dispenses change |
| `card_dispenser` | ccTalk/Pulse | Dispenses loyalty cards |
| `printer` | ESC/POS | Prints receipts |
| `rfid_reader` | Serial | Reads RFID cards |

### Common Baud Rates

- **9600** - Most peripherals (ccTalk, KITSEC, ESC/POS)
- **19200** - Some newer devices
- **115200** - RFID readers (check your device)

### ccTalk Addresses

- **2** - Coin acceptor
- **3** - Hopper
- **4** - Card dispenser
- **16** - Interface (KITSEC)
- **40** - Bill acceptor

## Running on Startup (Optional)

### Windows - Task Scheduler

1. Open **Task Scheduler**
2. Create Task:
   - Name: "WashBubbles Hardware Agent"
   - Trigger: At startup
   - Action: Start program
   - Program: `C:\path\to\washbubbles\start-hardware-agent.bat`
   - Start in: `C:\path\to\washbubbles`

### Windows Service (Advanced)

Use a tool like [NSSM](https://nssm.cc/) to run as a Windows service:

```bash
nssm install WashBubblesAgent "C:\Program Files\nodejs\node.exe"
nssm set WashBubblesAgent AppParameters "--env-file=.env.agent src/agentServer.js"
nssm set WashBubblesAgent AppDirectory "C:\path\to\washbubbles\backend"
nssm start WashBubblesAgent
```

## Support

If you're still having issues:

1. Check logs in the terminal/command window
2. Verify all cables are connected
3. Test each peripheral individually
4. Contact support with the error message

## Next Steps

Once the agent is running:

1. ✅ Test coin/bill insertion
2. ✅ Test machine activation
3. ✅ Test card reading (if RFID)
4. ✅ Configure the Electron POS client
5. ✅ Start serving customers!

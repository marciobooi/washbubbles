# Hardware Agent

A lightweight WebSocket-based service that bridges local hardware peripherals (connected via serial ports) with a remote backend server.

## Purpose

The WashBubbles system uses a distributed architecture where:
- **Backend** runs on a remote server (cloud)
- **Physical hardware** is connected to local POS machines
- **Hardware Agent** runs on each POS machine and bridges the gap

## Features

- ✅ Manages multiple serial port peripherals
- ✅ Real-time WebSocket communication with backend
- ✅ Automatic reconnection on network failure
- ✅ Protocol support: ccTalk, MDB, KITSEC, ESC/POS
- ✅ Hot-pluggable peripherals
- ✅ Comprehensive logging

## Supported Peripherals

| Peripheral | Protocol | Purpose |
|------------|----------|---------|
| Coin Acceptor | ccTalk/MDB | Accept coins (€0.05-€2.00) |
| Bill Acceptor | ccTalk/MDB | Accept bills (€5, €10, €20) |
| Interface (INT 6) | KITSEC | Control washing/drying machines |
| Hopper | ccTalk | Dispense change |
| Card Dispenser | ccTalk/Pulse | Dispense loyalty cards |
| Printer | ESC/POS | Print receipts |
| RFID Reader | Serial | Read loyalty cards |

## Quick Start

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Agent

Create `backend/.env.agent`:

```bash
HARDWARE_SERVER_URL=ws://your-server-ip:3000/hardware-agent
HARDWARE_AGENT_API_KEY=your-kiosk-api-key
```

### 3. Configure Peripherals

Edit `backend/src/agentServer.js`:

```javascript
const config = {
  peripherals: {
    'COM1': {
      type: 'coin_acceptor',
      baudRate: 9600,
      address: 2,
    },
    // Add your COM ports here...
  },
}
```

### 4. Start Agent

```bash
start-hardware-agent.bat
```

Or:

```bash
cd backend
node --env-file=.env.agent src/agentServer.js
```

## Architecture

```
┌─────────────────────────────────────────┐
│         Hardware Agent (Local)          │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │  Serial Port Manager             │  │
│  │  - Reads data from peripherals   │  │
│  │  - Sends commands to peripherals │  │
│  └────────┬─────────────────────────┘  │
│           │                             │
│           ▼                             │
│  ┌──────────────────────────────────┐  │
│  │  Protocol Handlers               │  │
│  │  - ccTalk parser                 │  │
│  │  - KITSEC parser                 │  │
│  │  - ESC/POS builder               │  │
│  └────────┬─────────────────────────┘  │
│           │                             │
│           ▼                             │
│  ┌──────────────────────────────────┐  │
│  │  WebSocket Client                │  │
│  │  - Sends events to server        │  │
│  │  - Receives commands from server │  │
│  │  - Auto-reconnect                │  │
│  └────────┬─────────────────────────┘  │
└───────────┼─────────────────────────────┘
            │
            │ WebSocket
            ▼
┌───────────────────────────────────────┐
│      Remote Backend Server            │
│  - Business logic                     │
│  - Database                           │
│  - Multi-store management             │
└───────────────────────────────────────┘
```

## Communication Flow

### Example 1: Customer Inserts Coin

```
[Coin Acceptor] 
    │ sends ccTalk packet (0.50€)
    ▼
[Hardware Agent]
    │ parses packet → 0.50€
    │ emits event
    ▼
[WebSocket] → {"type": "peripheral:credit", "payload": {"amount": 0.50}}
    │
    ▼
[Remote Server]
    │ updates customer balance
    │ broadcasts to all clients
    ▼
[POS UI] → displays updated balance
```

### Example 2: Customer Activates Machine

```
[POS UI] → user clicks "Start Wash 20kg"
    │
    ▼
[Remote Server]
    │ validates payment
    │ sends command via WebSocket
    ▼
[Hardware Agent] ← {"type": "machine:activate", "payload": {...}}
    │ builds KITSEC packet
    ▼
[Interface] → sends activation pulse to machine
    │
    ▼
[Washing Machine] → starts cycle
```

## WebSocket Protocol

### Events Sent by Agent (to Server)

#### Peripheral Credit
```json
{
  "type": "peripheral:credit",
  "payload": {
    "port": "COM1",
    "type": "coin_acceptor",
    "amount": 0.50
  }
}
```

#### Interface Status
```json
{
  "type": "interface:status",
  "payload": {
    "interfaceId": "507f1f77bcf86cd799439011",
    "door": true,
    "occupied": false,
    "fault": false
  }
}
```

#### RFID Card Detected
```json
{
  "type": "rfid:card_detected",
  "payload": {
    "port": "COM7",
    "cardCode": "1234567890"
  }
}
```

### Commands Received by Agent (from Server)

#### Activate Machine
```json
{
  "type": "machine:activate",
  "payload": {
    "interfaceId": "507f1f77bcf86cd799439011",
    "port": 1,
    "channel": 2,
    "impulses": 5,
    "tOn": 5,
    "tOff": 1
  }
}
```

#### Dispense Change
```json
{
  "type": "hopper:dispense",
  "payload": {
    "port": "COM4",
    "coins": [
      { "denomination": 0.50, "quantity": 2 },
      { "denomination": 0.20, "quantity": 1 }
    ]
  }
}
```

#### Print Receipt
```json
{
  "type": "printer:print",
  "payload": {
    "port": "COM6",
    "lines": [
      { "text": "WashBubbles", "align": "center", "bold": true },
      { "text": "---", "align": "center" },
      { "text": "Wash 20kg: 5.00€" }
    ]
  }
}
```

## Configuration

### Environment Variables (`.env.agent`)

```bash
# Remote server WebSocket URL
HARDWARE_SERVER_URL=ws://192.168.1.100:3000/hardware-agent

# Kiosk API key (get from admin dashboard)
HARDWARE_AGENT_API_KEY=ksk_abc123xyz456
```

### Peripheral Configuration

```javascript
{
  'COM1': {
    type: 'coin_acceptor',      // Peripheral type
    baudRate: 9600,             // Serial baud rate
    address: 2,                 // ccTalk address
  },
}
```

### Finding COM Ports (Windows)

1. Open Device Manager (Win + X)
2. Expand "Ports (COM & LPT)"
3. Note COM port numbers
4. Update configuration accordingly

## Troubleshooting

### Problem: Can't Connect to Server

**Symptoms:**
```
[HardwareAgent] WebSocket error: connect ECONNREFUSED
```

**Solutions:**
1. Check `HARDWARE_SERVER_URL` is correct
2. Verify server is running
3. Test: `ping your-server-ip`
4. Check firewall settings

### Problem: Invalid API Key

**Symptoms:**
```
[HardwareAgent] Disconnected from server (1008: Unauthorized)
```

**Solutions:**
1. Get API key from admin dashboard (Users → KIOSK user)
2. Copy to `.env.agent`
3. Ensure user role is KIOSK (not ADMIN)
4. Restart agent

### Problem: Can't Open COM Port

**Symptoms:**
```
[HardwareAgent] Failed to connect peripheral on COM3: Port is opening
```

**Solutions:**
1. Check COM port exists in Device Manager
2. Close other programs using the port
3. Verify correct COM port number
4. Check cable connections

### Problem: Peripheral Connected But Not Responding

**Solutions:**
1. Check baud rate matches device (usually 9600)
2. Verify ccTalk address is correct
3. Test with serial monitor (PuTTY)
4. Check device power supply

## Logging

The agent provides detailed logging:

```
[HardwareAgent] Starting...
[HardwareAgent] Connecting coin_acceptor on COM1...
[HardwareAgent] coin_acceptor connected on COM1
[HardwareAgent] Connecting to server: ws://192.168.1.100:3000
[HardwareAgent] Connected to server
[HardwareAgent] Peripheral credit event: { port: 'COM1', amount: 0.50 }
[HardwareAgent] Received command: machine:activate
```

## Auto-Start on Boot

### Windows Task Scheduler

1. Open Task Scheduler
2. Create Task:
   - Name: "WashBubbles Hardware Agent"
   - Trigger: At system startup
   - Action: `C:\washbubbles\start-hardware-agent.bat`
   - Run whether user is logged on or not

### Windows Service (using NSSM)

```bash
nssm install WashBubblesAgent "C:\Program Files\nodejs\node.exe"
nssm set WashBubblesAgent AppParameters "--env-file=.env.agent src/agentServer.js"
nssm set WashBubblesAgent AppDirectory "C:\washbubbles\backend"
nssm start WashBubblesAgent
```

## Development & Testing

### Local Testing

```bash
# Terminal 1: Start backend
cd backend
npm start

# Terminal 2: Start agent (local)
start-hardware-agent-local-test.bat
```

### Testing Without Hardware

Create mock peripherals for testing:

```javascript
// In agentServer.js
const config = {
  peripherals: {
    'MOCK1': {
      type: 'coin_acceptor',
      baudRate: 9600,
      address: 2,
      mock: true,  // Use mock instead of real serial
    },
  },
}
```

## Security

- ✅ API key authentication required
- ✅ Only KIOSK users can connect
- ✅ Commands validated on server before execution
- ✅ Use WSS (secure WebSocket) in production
- ✅ Firewall rules to restrict connections

## Performance

- **Latency:** ~50-200ms (WebSocket)
- **Bandwidth:** ~1-5 KB/minute per machine
- **CPU:** <1% on modern hardware
- **Memory:** ~50-100 MB

## Updates

To update the agent:

1. Stop the agent
2. Pull latest code: `git pull`
3. Install dependencies: `npm install`
4. Restart agent

No configuration changes needed unless new features require it.

## Support

- [ARCHITECTURE.md](../ARCHITECTURE.md) - System architecture overview
- [HARDWARE_AGENT_SETUP.md](../HARDWARE_AGENT_SETUP.md) - Detailed setup guide
- [MIGRATION_GUIDE.md](../MIGRATION_GUIDE.md) - Migrate from old system

## License

Proprietary - WashBubbles

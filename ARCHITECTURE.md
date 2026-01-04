# WashBubbles Architecture

## Overview

WashBubbles consists of a distributed architecture with three main components:

1. **Remote Backend Server** - Centralized business logic, database, and API
2. **Local Hardware Agent** - Runs on each POS machine, manages physical peripherals
3. **Electron POS Client** - User interface running on POS machines

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    REMOTE SERVER                             │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Backend API (Node.js + Express)                   │     │
│  │  - Business Logic                                  │     │
│  │  - User Management                                 │     │
│  │  - Machine Management                              │     │
│  │  - Transactions & Sales                            │     │
│  │  - Price Configuration                             │     │
│  └────────────────────────────────────────────────────┘     │
│           │                    │                             │
│           ▼                    ▼                             │
│  ┌─────────────────┐  ┌──────────────────────────┐          │
│  │   MongoDB       │  │  WebSocket Servers       │          │
│  │   Database      │  │  - /ws (clients)         │          │
│  │                 │  │  - /hardware-agent       │          │
│  └─────────────────┘  └──────────────────────────┘          │
└─────────────────────────────────────┬───────────────────────┘
                                      │
                           WebSocket over Internet
                                      │
┌─────────────────────────────────────┴───────────────────────┐
│                    LOCAL POS MACHINE                         │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Hardware Agent (Node.js)                          │     │
│  │  - Manages all serial port connections             │     │
│  │  - Communicates with remote server                 │     │
│  │  - Executes hardware commands                      │     │
│  └────────────────────────────────────────────────────┘     │
│           │                                                  │
│           ▼                                                  │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Physical Peripherals (Serial Ports)               │     │
│  │  - COM1: Coin Acceptor (ccTalk/MDB)               │     │
│  │  - COM2: Bill Acceptor (ccTalk/MDB)               │     │
│  │  - COM3: Interface/Machines (INT 6 KITSEC)        │     │
│  │  - COM4: Hopper (ccTalk)                           │     │
│  │  - COM5: Card Dispenser (ccTalk/Pulse)            │     │
│  │  - COM6: Printer (ESC/POS)                         │     │
│  │  - COM7: RFID Reader                               │     │
│  └────────────────────────────────────────────────────┘     │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Electron POS Client                               │     │
│  │  - User interface (React + Vite)                   │     │
│  │  - Connects to remote backend API                  │     │
│  │  - Displays machine status & prices                │     │
│  │  - Handles customer interactions                   │     │
│  └────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
```

## Communication Flow

### 1. Customer Inserts Coin

```
[Coin Acceptor] 
    ↓ (serial)
[Hardware Agent] → detects coin → sends via WebSocket
    ↓
[Remote Backend] → updates client balance → broadcasts to all clients
    ↓
[POS Client] → updates UI
```

### 2. Customer Selects Machine & Pays

```
[POS Client] → user selects machine → POST /api/pos/sale
    ↓
[Remote Backend] → validates payment → sends activation command
    ↓ (WebSocket)
[Hardware Agent] → receives command → activates machine
    ↓ (serial)
[Interface/Machine] → starts washing/drying cycle
```

### 3. Machine Status Updates

```
[Interface/Machine] → sends status (door/occupied/fault)
    ↓ (serial)
[Hardware Agent] → parses status → sends to backend
    ↓ (WebSocket)
[Remote Backend] → updates database → broadcasts to clients
    ↓
[POS Client + Admin Dashboard] → updates machine status display
```

## File Structure

### Backend (Remote Server)

```
backend/
├── src/
│   ├── index.js                    # Main server entry point
│   ├── db.js                       # MongoDB connection
│   ├── wsServer.js                 # WebSocket server for clients
│   ├── hardwareAgentServer.js      # WebSocket server for hardware agents
│   ├── hardwareAgent.js            # Hardware agent class (runs on POS)
│   ├── agentServer.js              # Hardware agent entry point (runs on POS)
│   ├── models/                     # MongoDB schemas
│   │   ├── machine.js
│   │   ├── user.js
│   │   ├── sale.js
│   │   ├── peripheral.js
│   │   ├── interface.js
│   │   ├── price.js
│   │   └── setting.js
│   ├── routes/                     # API endpoints
│   │   ├── auth.js                 # Authentication
│   │   ├── admin.js                # Admin endpoints (requireAdmin)
│   │   ├── pos.js                  # POS/Kiosk endpoints (requireKiosk/public)
│   │   ├── gateways.js             # Payment gateway endpoints
│   │   └── middleware.js           # Hardware control endpoints
│   ├── middleware/
│   │   └── auth.js                 # JWT + API key authentication
│   └── services/
│       ├── coinMachine.js          # Main coordinator (legacy local, now remote)
│       ├── middleware.js           # Hardware abstraction layer
│       └── client.js               # Client state management
└── .env                            # Server configuration
```

### Hardware Agent (Local POS)

```
backend/
├── src/
│   ├── hardwareAgent.js            # Hardware agent class
│   └── agentServer.js              # Entry point for local execution
└── .env.agent                      # Local agent configuration
```

### Frontend (POS Client)

```
src/
├── services/
│   ├── api.js                      # API client
│   └── websocket.js                # WebSocket client
├── pages/
│   ├── Pos.jsx                     # POS interface
│   └── Admin*.jsx                  # Admin dashboard pages
└── components/
    ├── MachineCard.jsx             # Machine display card
    └── ...
```

## Setup Instructions

### Remote Server Setup

1. Install dependencies:
```bash
cd backend
npm install
```

2. Configure `.env`:
```bash
MONGODB_URL=mongodb://localhost:27017/washstore
JWT_SECRET=your-secret-key
PORT=3000
ENABLE_COIN_MACHINE=false  # Disable local hardware on server
```

3. Start server:
```bash
npm start
```

### Local POS Machine Setup

#### 1. Install Hardware Agent

1. Copy the backend folder to POS machine
2. Configure `backend/.env.agent`:
```bash
HARDWARE_SERVER_URL=ws://YOUR-SERVER-IP:3000/hardware-agent
HARDWARE_AGENT_API_KEY=your-kiosk-api-key
```

3. Edit `backend/src/agentServer.js` to configure COM ports:
```javascript
peripherals: {
  'COM1': { type: 'coin_acceptor', baudRate: 9600, address: 2 },
  'COM2': { type: 'bill_acceptor', baudRate: 9600, address: 40 },
  'COM3': { type: 'interface', baudRate: 9600, interfaceId: 'xxx' },
  // ... etc
}
```

4. Start hardware agent:
```bash
start-hardware-agent.bat
```

#### 2. Install Electron POS Client

1. Configure `.env.production`:
```bash
VITE_API_BASE=http://YOUR-SERVER-IP:3000/api
```

2. Build Electron app:
```bash
npm run build
```

3. Start POS:
```bash
start-store-kiosk.bat http://YOUR-SERVER-IP:3000
```

## Authentication

### Admin (JWT Token)
- Used by: Admin dashboard
- Header: `Authorization: Bearer <token>`
- Required for: Admin routes (`/api/admin/*`)

### Kiosk (API Key)
- Used by: POS client, Hardware agent
- Header: `Authorization: ApiKey <key>`
- Required for: Kiosk routes (`/api/pos/*` with requireKiosk)

### Public
- Used by: Price lookups, machine status
- No authentication required
- Routes: `/api/pos/prices/lookup`, `/api/machine-status`

## Hardware Protocols

### ccTalk (Coin/Bill/Hopper)
- Packet format: `[DEST][LEN][SRC][CMD][DATA...][CHECKSUM]`
- Baud rate: 9600
- Checksum: `(256 - (sum % 256)) % 256`

### KITSEC (Interface/Machines)
- Packet format: `STX(0x02) [CMD][DATA...][CHECKSUM] ETX(0x03)`
- Baud rate: 9600
- Commands: 0x41 (activate), 0x53 (status), 0x45 (error)

### ESC/POS (Printer)
- Text-based protocol
- Commands: ESC @ (init), ESC E (bold), GS V (cut), etc.
- Baud rate: 9600

### RFID Reader
- Line-based text protocol
- Delimiter: `\r\n`
- Baud rate: 9600

## WebSocket Messages

### Client → Backend (Admin/POS)
```json
{
  "type": "machine-status",
  "payload": { /* machine data */ }
}
```

### Hardware Agent → Backend
```json
{
  "type": "peripheral:credit",
  "payload": { "port": "COM1", "type": "coin_acceptor", "amount": 0.50 }
}

{
  "type": "interface:status",
  "payload": { "interfaceId": "xxx", "door": true, "occupied": false, "fault": false }
}

{
  "type": "rfid:card_detected",
  "payload": { "port": "COM7", "cardCode": "1234567890" }
}
```

### Backend → Hardware Agent
```json
{
  "type": "machine:activate",
  "payload": { "interfaceId": "xxx", "port": 1, "channel": 2, "impulses": 5, "tOn": 5, "tOff": 1 }
}

{
  "type": "hopper:dispense",
  "payload": { "port": "COM4", "coins": [{ "denomination": 0.50, "quantity": 2 }] }
}

{
  "type": "printer:print",
  "payload": { "port": "COM6", "lines": [{ "text": "Receipt", "align": "center", "bold": true }] }
}
```

## Troubleshooting

### Hardware Agent Won't Connect
1. Check `HARDWARE_SERVER_URL` in `.env.agent`
2. Verify API key exists in database (KIOSK role)
3. Check firewall allows WebSocket connection
4. Verify server is running

### Peripherals Not Responding
1. Check COM port configuration in `agentServer.js`
2. Verify COM ports in Windows Device Manager
3. Check baud rate matches hardware
4. Test with serial port monitor tool

### 401 Errors in POS
1. Price lookups should use `/api/pos/prices/lookup` (public)
2. Machine operations need kiosk API key
3. Check `Authorization: ApiKey <key>` header is set

## Migration from Old System

### Before (Monolithic Local)
- Everything ran on local POS machine
- Serial ports connected directly
- TCP controller at 192.168.2.201:16852
- No remote management

### After (Distributed Cloud)
- Backend on remote server
- Hardware agent bridges serial ports
- WebSocket communication
- Centralized management
- Multiple POS locations supported

## Security Considerations

1. **API Keys**: Store kiosk API keys securely in `.env.agent`
2. **WebSocket**: Use WSS (TLS) in production
3. **Firewall**: Restrict WebSocket port to known POS IPs
4. **Authentication**: Hardware agents must authenticate with valid KIOSK user
5. **Command Validation**: Backend validates all hardware commands before forwarding

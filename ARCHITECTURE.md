# WashBubbles Architecture

## Overview

WashBubbles uses an **offline-first distributed architecture** with two main tiers:

1. **Electron POS Client** (Local) — The autonomous POS brain. Runs local SQLite DB, embedded hardware agent, POS business logic, and a background sync engine. Operates fully offline.
2. **Cloud Server** (Remote) — Management hub for reporting, multi-site admin, price/config management. Receives synced data from POS clients.

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                    ELECTRON POS CLIENT (LOCAL)                    │
│                                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ SQLite DB   │  │ POS Engine   │  │ Sync Engine            │  │
│  │ (sql.js —   │  │ - Payments   │  │ - Outbound queue       │  │
│  │  WASM)      │  │ - Cards      │  │ - Inbound pull         │  │
│  │             │  │ - Machine    │  │ - Conflict resolver    │  │
│  │ • machines  │  │   activation │  │ - Connectivity monitor │  │
│  │ • cards     │  │ - Sessions   │  │                        │  │
│  │ • sales     │  │ - Receipts   │  └──────────┬─────────────┘  │
│  │ • prices    │  │ - Change     │             │                 │
│  │ • settings  │  │   dispensing │             │ HTTP (when      │
│  │ • sync_queue│  └──────┬───────┘             │  online)        │
│  └──────┬───────┘        │                      │                 │
│         │    ┌───────────┴──────────────┐       │                 │
│         │    │ Embedded Hardware Agent  │       │                 │
│         │    │ - Serial port management │       │                 │
│         │    │ - ccTalk (coins/bills)   │       │                 │
│         │    │ - KITSEC (interfaces)    │       │                 │
│         │    │ - ESC/POS (printer)      │       │                 │
│         │    │ - RFID reader            │       │                 │
│         │    └───────────┬──────────────┘       │                 │
│         │                │                      │                 │
│  ┌──────┴────────────────┴──────────────────────┴──────────────┐ │
│  │              IPC Bridge (contextBridge)                      │ │
│  └──────┬──────────────────────────────────────────────────────┘ │
│         │                                                        │
│  ┌──────┴──────────────────────────────────────────────────────┐ │
│  │  Renderer Process (React + Vite UI)                         │ │
│  │  - POS interface (machine selection, payment flow)          │ │
│  │  - Online/Offline indicator + sync status                   │ │
│  │  - All data via IPC from local DB                           │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Physical Peripherals (Serial Ports)                        │ │
│  │  COM1: Coin Acceptor  │  COM5: Card Dispenser              │ │
│  │  COM2: Bill Acceptor  │  COM6: Printer (ESC/POS)           │ │
│  │  COM3: Interface      │  COM7: RFID Reader                 │ │
│  │  COM4: Hopper         │                                     │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────┬───────────────────────────────────┘
                               │ periodic sync (when online)
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                    CLOUD SERVER (REMOTE)                          │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Backend API (Node.js + Express)                           │  │
│  │  - Admin dashboard & multi-site management                 │  │
│  │  - Reporting & analytics (from synced data)                │  │
│  │  - Price & config management (pushed to POS)               │  │
│  │  - Sync API (/api/sync/push, /api/sync/pull)              │  │
│  └───────────────────────────────────────────────────────────┘  │
│           │                                                      │
│           ▼                                                      │
│  ┌─────────────────┐  ┌─────────────────────────────────────┐  │
│  │   MongoDB       │  │  WebSocket Server                    │  │
│  │   Database      │  │  - Admin real-time updates           │  │
│  └─────────────────┘  │  - Legacy hardware agent support     │  │
│                        └─────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

## Offline-First Data Flow

### 1. Customer Inserts Coin (No Internet Required)

```
[Coin Acceptor] → serial → [Embedded HW Agent] → local event
    → [POS Engine] → updates session balance in SQLite
    → [IPC] → [React UI] → updates display
    → [Sync Queue] → pushes to server when online
```

### 2. Customer Pays & Machine Activates (No Internet Required)

```
[React UI] → user selects machine → IPC call
    → [POS Engine] → reads price from local SQLite
    → validates payment (cash or card from local DB)
    → creates Sale in local SQLite
    → sends activation command to HW Agent
    → [HW Agent] → KITSEC pulse to Interface → machine starts
    → [Sync Queue] → sale + machine status sync later
```

### 3. Card Scanned & Used (No Internet Required)

```
[RFID Reader] → serial → [HW Agent] → card code event
    → [POS Engine] → looks up card in local SQLite
    → [IPC] → [React UI] → shows card info + balance
```

### 4. Sync with Server (Background, When Online)

```
[Sync Engine] pings server every 30s → detects online
    → PUSH: sales, card balance deltas, machine status
    → PULL: prices, settings, machine config, cards
    → [Local SQLite] updated with server data
```

## File Structure

### Electron POS Client (Local Machine)

```
pos-client/
├── electron/
│   ├── main.cjs                    # Main process orchestrator
│   ├── preload.cjs                 # Context bridge (IPC API)
│   ├── database.cjs                # SQLite DB init, migrations, CRUD
│   ├── hardware-agent.cjs          # Embedded hardware agent
│   ├── pos-engine.cjs              # Local business logic
│   ├── sync-engine.cjs             # Background cloud sync
│   └── ipc-handlers.cjs            # IPC handler registrations
├── config.json                     # Hardware peripheral config
├── agent.js                        # Legacy standalone agent (deprecated)
├── package.json
└── data/                           # Auto-created at runtime
    └── washbubbles.db              # SQLite database
```

### Frontend (React)

```
src/
├── services/
│   ├── local-api.js                # Offline-first API (IPC when Electron)
│   ├── api.js                      # Remote HTTP API (fallback/admin)
│   └── websocket.js                # WebSocket client (admin dashboard)
├── pages/
│   ├── Pos.jsx                     # POS interface
│   └── Admin*.jsx                  # Admin dashboard pages
└── components/
    └── ...
```

### Backend (Cloud Server)

```
backend/
├── src/
│   ├── index.js                    # Server entry point
│   ├── routes/
│   │   ├── sync.js                 # NEW: Sync API endpoints
│   │   ├── auth.js                 # Authentication
│   │   ├── admin.js                # Admin endpoints
│   │   ├── pos.js                  # POS/Kiosk endpoints
│   │   ├── gateways.js             # Payment gateways
│   │   └── middleware.js           # Hardware control
│   ├── models/                     # MongoDB schemas
│   └── services/                   # Business logic
└── .env
```

## Sync Strategy

### Outbound (POS → Server)

| Data | Priority | Interval | Rule |
|------|----------|----------|------|
| Sales | 1 (highest) | 60s | Local always wins |
| Card balance | 2 | 60s | Delta-based merge |
| Machine status | 3 | 30s | POS wins for runtime |

### Inbound (Server → POS)

| Data | Interval | Rule |
|------|----------|------|
| Prices | 10 min | Server always wins |
| Settings | 10 min | Server always wins |
| Machine config | 10 min | Server wins for config |
| Cards | 5 min | Server provides authoritative balance |
| Interfaces | 30 min | Server wins |
| Peripherals | 30 min | Server wins |

## Authentication

### Admin (JWT Token)
- Used by: Admin dashboard
- Header: `Authorization: Bearer <token>`

### Kiosk (API Key)
- Used by: POS client sync engine
- Header: `Authorization: ApiKey <key>`

## Hardware Protocols

### ccTalk (Coin/Bill/Hopper)
- Packet: `[DEST][LEN][SRC][CMD][DATA...][CHECKSUM]`
- Baud rate: 9600

### KITSEC (Interface/Machines)
- Packet: `STX(0x02) [CMD][DATA...][CHECKSUM] ETX(0x03)`
- Commands: 0x41 (activate), 0x53 (status), 0x45 (error)

### ESC/POS (Printer)
- Standard ESC/POS text protocol
- Baud rate: 9600

### RFID Reader
- Line-based: `\r\n` delimited card codes
- Baud rate: 9600

## Setup Instructions

### POS Machine Setup

1. Install dependencies:
```bash
cd pos-client
npm install
```

2. Configure `config.json` with COM ports:
```json
{
  "peripherals": {
    "coin_acceptor": { "enabled": true, "port": "COM1" },
    "interface": { "enabled": true, "port": "COM3" }
  }
}
```

3. Set environment variables (or edit `start-pos.bat`):
```
ELECTRON_API_BASE=http://YOUR-SERVER:3000/api
ELECTRON_KIOSK_API_KEY=your-kiosk-key
ELECTRON_TENANT_ID=your-tenant-id
```

4. Start POS:
```bash
start-pos.bat
```

On first launch, the sync engine downloads all data from the server. After that, the POS runs fully offline.

### Cloud Server Setup

1. Install & configure:
```bash
cd backend
npm install
# Configure .env with MONGODB_URL, JWT_SECRET, PORT
```

2. Start server:
```bash
npm start
```

## Key Design Decisions

1. **SQLite over IndexedDB** — Runs in main process, synchronous, ACID, survives crashes
2. **Embedded hardware agent** — One process, no WebSocket hop for local hardware
3. **Delta-based card sync** — Multiple POS machines can charge the same card
4. **Sales are source of truth at POS** — The machine that took the money owns the record

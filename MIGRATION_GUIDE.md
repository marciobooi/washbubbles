# Migration Guide: Local to Cloud Architecture

## Overview

This guide helps you migrate from the old local system (where everything ran on the POS machine) to the new cloud architecture (with a remote backend server).

## Old System Architecture (Before)

```
┌─────────────────────────────────────┐
│         POS MACHINE                 │
│                                     │
│  ┌────────────────────────────┐    │
│  │  Node.js Backend           │    │
│  │  - Database (local)        │    │
│  │  - Serial Port Control     │    │
│  │  - Business Logic          │    │
│  └────────────────────────────┘    │
│            ↓                        │
│  ┌────────────────────────────┐    │
│  │  Physical Peripherals      │    │
│  │  - Coin Acceptor           │    │
│  │  - Bill Acceptor           │    │
│  │  - Washing Machines        │    │
│  │  - Printer, etc.           │    │
│  └────────────────────────────┘    │
└─────────────────────────────────────┘

Issues:
❌ No remote management
❌ No multi-store support
❌ Data stuck on local machine
❌ Difficult to update/maintain
```

## New System Architecture (After)

```
┌──────────────────────────────┐
│      REMOTE SERVER           │
│  - Centralized Database      │
│  - Business Logic            │
│  - Multi-store Management    │
│  - Real-time Updates         │
└──────────┬───────────────────┘
           │ (WebSocket)
           ▼
┌──────────────────────────────┐
│      POS MACHINE             │
│  ┌────────────────────────┐  │
│  │  Hardware Agent        │  │
│  │  (Local Service)       │  │
│  └──────────┬─────────────┘  │
│             ▼                │
│  ┌────────────────────────┐  │
│  │  Physical Peripherals  │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │  Electron POS UI       │  │
│  └────────────────────────┘  │
└──────────────────────────────┘

Benefits:
✅ Remote management from anywhere
✅ Multiple stores supported
✅ Centralized data & reporting
✅ Easy updates & maintenance
✅ Real-time monitoring
```

## Migration Steps

### Phase 1: Prepare Remote Server

#### 1.1 Install Server Software

```bash
# On your cloud/remote server
sudo apt update
sudo apt install nodejs npm mongodb-server nginx

# Or use a managed MongoDB (MongoDB Atlas)
```

#### 1.2 Deploy Backend

```bash
# Copy backend to server
scp -r backend/ user@server:/opt/washbubbles/

# On server
cd /opt/washbubbles/backend
npm install

# Configure environment
cp .env.example .env
nano .env
```

**Edit `.env`:**
```bash
MONGODB_URL=mongodb://localhost:27017/washstore
JWT_SECRET=your-random-secret-key-here
PORT=3000
ENABLE_COIN_MACHINE=false  # Important: disable local hardware on server
NODE_ENV=production
```

#### 1.3 Seed Database

```bash
# Initialize database with default data
node scripts/seed.cjs
```

This creates:
- Admin user: `admin` / `admin123`
- Kiosk user with API key
- Default settings
- Sample machines

#### 1.4 Start Backend

```bash
# Using PM2 (recommended)
npm install -g pm2
pm2 start src/index.js --name washbubbles
pm2 save
pm2 startup
```

#### 1.5 Configure Nginx (Optional)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location /api {
        proxy_pass http://localhost:3000/api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /ws {
        proxy_pass http://localhost:3000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }

    location /hardware-agent {
        proxy_pass http://localhost:3000/hardware-agent;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }
}
```

### Phase 2: Configure POS Machine

#### 2.1 Get Kiosk API Key

1. Access admin dashboard: `http://your-server:3000`
2. Login with admin credentials
3. Go to **Users** section
4. Find the KIOSK user
5. Copy the **API Key** (something like `ksk_abc123xyz456`)

#### 2.2 Install Hardware Agent

On the POS machine:

```bash
# Navigate to project
cd C:\washbubbles\backend

# Create agent configuration
copy .env.agent.example .env.agent
notepad .env.agent
```

**Edit `.env.agent`:**
```bash
# Replace with your server's IP/domain
HARDWARE_SERVER_URL=ws://192.168.1.100:3000/hardware-agent

# Paste the API key from step 2.1
HARDWARE_AGENT_API_KEY=ksk_abc123xyz456
```

#### 2.3 Configure COM Ports

Edit `backend/src/agentServer.js`:

```javascript
const config = {
  serverUrl: process.env.HARDWARE_SERVER_URL,
  apiKey: process.env.HARDWARE_AGENT_API_KEY,
  peripherals: {
    // Check Device Manager for actual COM ports
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
      interfaceId: '507f1f77bcf86cd799439011', // Get from admin
      address: 16,
    },
    'COM4': {
      type: 'hopper',
      baudRate: 9600,
      address: 3,
    },
    'COM5': {
      type: 'card_dispenser',
      baudRate: 9600,
      address: 4,
      protocol: 'cctalk',
    },
    'COM6': {
      type: 'printer',
      baudRate: 9600,
    },
    'COM7': {
      type: 'rfid_reader',
      baudRate: 9600,
    },
  },
}
```

**How to get Interface ID:**
1. Go to admin dashboard
2. Navigate to **Machines** → **Interfaces**
3. Copy the ID of your Interface device

#### 2.4 Test Hardware Agent

```bash
# Run in a terminal to see output
start-hardware-agent.bat
```

You should see:
```
[HardwareAgent] Starting...
[HardwareAgent] Connecting coin_acceptor on COM1...
[HardwareAgent] coin_acceptor connected on COM1
...
[HardwareAgent] Connected to server
```

If you see errors, check:
- COM port numbers in Device Manager
- Server URL is correct
- API key is valid
- Network/firewall allows connection

#### 2.5 Configure POS Client

Edit `.env.production`:
```bash
VITE_API_BASE=http://192.168.1.100:3000/api
```

Build the Electron app:
```bash
npm run build
```

### Phase 3: Data Migration (Optional)

If you have existing data in the old system:

#### 3.1 Export Old Data

```javascript
// On old system - run this script
import mongoose from 'mongoose'
import fs from 'fs'

await mongoose.connect('mongodb://localhost:27017/old-washstore')

const sales = await mongoose.connection.db.collection('sales').find().toArray()
const machines = await mongoose.connection.db.collection('machines').find().toArray()

fs.writeFileSync('sales-export.json', JSON.stringify(sales, null, 2))
fs.writeFileSync('machines-export.json', JSON.stringify(machines, null, 2))
```

#### 3.2 Import to New System

```javascript
// On new server - run this script
import mongoose from 'mongoose'
import fs from 'fs'

await mongoose.connect('mongodb://localhost:27017/washstore')

const sales = JSON.parse(fs.readFileSync('sales-export.json'))
const machines = JSON.parse(fs.readFileSync('machines-export.json'))

await mongoose.connection.db.collection('sales').insertMany(sales)
await mongoose.connection.db.collection('machines').insertMany(machines)
```

### Phase 4: Testing

#### 4.1 Test Remote Access

1. From another computer, access: `http://your-server:3000`
2. Login as admin
3. Verify dashboard loads

#### 4.2 Test Hardware Agent Connection

1. Check server logs: `pm2 logs washbubbles`
2. Look for: `[HardwareAgentServer] Agent connected`

#### 4.3 Test Coin Insertion

1. Insert a coin into acceptor
2. Check agent output: should show credit event
3. Check server logs: should receive credit event
4. Check POS UI: should update balance

#### 4.4 Test Machine Activation

1. In POS, select a machine
2. Pay for the service
3. Check agent output: should show activation command
4. Machine should start

#### 4.5 Test WebSocket Updates

1. Open admin dashboard on another device
2. In POS, occupy a machine
3. Dashboard should update in real-time

### Phase 5: Go Live

#### 5.1 Set Hardware Agent to Auto-Start

**Using Task Scheduler:**

1. Open Task Scheduler
2. Create Task:
   - Name: "WashBubbles Hardware Agent"
   - Trigger: At system startup
   - Action: `C:\washbubbles\start-hardware-agent.bat`
   - Start in: `C:\washbubbles`
   - Run whether user is logged on or not
   - Run with highest privileges

#### 5.2 Set POS Client to Auto-Start

1. Create shortcut to `start-store-kiosk.bat`
2. Move to: `%AppData%\Microsoft\Windows\Start Menu\Programs\Startup`

Or use Task Scheduler similar to above.

#### 5.3 Configure Firewall

**On Server:**
```bash
# Allow WebSocket connections
sudo ufw allow 3000/tcp
```

**On POS Machine (Windows):**
1. Windows Defender Firewall
2. Allow outbound connections to server IP port 3000

#### 5.4 Monitor & Maintain

**Server Monitoring:**
```bash
# Check backend status
pm2 status

# View logs
pm2 logs washbubbles

# Restart if needed
pm2 restart washbubbles
```

**Agent Monitoring:**
- Hardware agent runs in terminal window
- Check for connection errors
- Restart if disconnected

### Phase 6: Rollback Plan (If Needed)

If something goes wrong:

1. **Stop hardware agent** on POS machine
2. **Restart old local backend** on POS machine
3. **Switch POS client** back to `http://localhost:3000`
4. Everything works as before

No data is lost on the old system until you're confident the new system works.

## Common Migration Issues

### Issue: Hardware Agent Can't Connect

**Symptoms:**
```
[HardwareAgent] WebSocket error: connect ECONNREFUSED
```

**Solutions:**
1. Check server is running: `pm2 status`
2. Verify `HARDWARE_SERVER_URL` in `.env.agent`
3. Test connectivity: `ping your-server-ip`
4. Check firewall on server
5. Try: `telnet your-server-ip 3000`

### Issue: "Invalid API Key"

**Symptoms:**
```
[HardwareAgentServer] Invalid API key or not a KIOSK user
```

**Solutions:**
1. Get API key from admin dashboard
2. Verify user role is **KIOSK** not ADMIN
3. Copy/paste key carefully (no extra spaces)
4. Restart hardware agent after fixing

### Issue: Peripherals Not Working

**Symptoms:**
```
[HardwareAgent] Failed to connect peripheral on COM3
```

**Solutions:**
1. Check COM ports in Device Manager
2. Close any other programs using serial ports
3. Verify baud rate (usually 9600)
4. Test with PuTTY/serial monitor

### Issue: Real-time Updates Not Working

**Symptoms:**
- Dashboard doesn't update
- Machine status stale

**Solutions:**
1. Check WebSocket connection in browser console
2. Verify `/ws` endpoint accessible
3. Check nginx WebSocket proxy config
4. Try refreshing the page

## Performance Considerations

### Latency

- **Local (old):** ~0ms (direct serial)
- **Cloud (new):** ~50-200ms (WebSocket)

For most operations, this is negligible. Coin insertion feels instant.

### Bandwidth

- **Per machine:** ~1-5 KB/minute
- **10 machines:** ~50 KB/minute
- **Monthly:** ~2-5 GB/month

Very low bandwidth requirement.

### Reliability

- Hardware agent reconnects automatically if disconnected
- Backend queues commands if agent offline
- POS can operate offline (limited functionality)

## Support & Maintenance

### Regular Maintenance

**Monthly:**
- Check server disk space
- Review logs for errors
- Backup database
- Update Node.js security patches

**Weekly:**
- Monitor server uptime
- Check hardware agent connection
- Verify all peripherals working

### Backup Strategy

```bash
# Automated daily backup
mongodump --db washstore --out /backup/$(date +%Y%m%d)

# Keep 30 days of backups
find /backup -type d -mtime +30 -exec rm -rf {} \;
```

### Updates

**Backend Updates:**
```bash
pm2 stop washbubbles
git pull
npm install
pm2 start washbubbles
```

**Hardware Agent Updates:**
- Stop agent on POS machine
- Copy new files
- Restart agent

## Need Help?

1. Check [ARCHITECTURE.md](ARCHITECTURE.md) for system overview
2. Check [HARDWARE_AGENT_SETUP.md](HARDWARE_AGENT_SETUP.md) for detailed setup
3. Review server logs: `pm2 logs`
4. Review agent logs in terminal
5. Contact support with error messages

## Success Checklist

- [ ] Backend running on remote server
- [ ] Database seeded with default data
- [ ] Admin dashboard accessible remotely
- [ ] Hardware agent running on POS machine
- [ ] All peripherals connected and working
- [ ] Coin insertion updates server
- [ ] Machine activation works
- [ ] WebSocket updates in real-time
- [ ] Auto-start configured
- [ ] Backups scheduled
- [ ] Ready to serve customers! 🎉

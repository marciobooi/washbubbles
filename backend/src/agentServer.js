import HardwareAgent from './hardwareAgent.js'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

dotenv.config()

// Load configuration from config.json if provided as argument
let config = {
  serverUrl: process.env.HARDWARE_SERVER_URL || 'ws://localhost:3000/hardware-agent',
  apiKey: process.env.HARDWARE_AGENT_API_KEY,
  reconnectInterval: 5000,
  peripherals: {},
}

// Check for config.json argument
const configPath = process.argv[2]
if (configPath && fs.existsSync(configPath)) {
  console.log(`[AgentServer] Loading configuration from ${configPath}`)
  const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  
  // Override with file config
  config.serverUrl = fileConfig.serverUrl || config.serverUrl
  config.apiKey = fileConfig.apiKey || config.apiKey
  
  // Build peripherals from comPorts
  if (fileConfig.comPorts) {
    if (fileConfig.comPorts.coin) {
      config.peripherals[fileConfig.comPorts.coin] = {
        type: 'coin_acceptor',
        baudRate: 9600,
        address: 2,
      }
    }
    if (fileConfig.comPorts.bill) {
      config.peripherals[fileConfig.comPorts.bill] = {
        type: 'bill_acceptor',
        baudRate: 9600,
        address: 40,
      }
    }
    if (fileConfig.comPorts.interface) {
      config.peripherals[fileConfig.comPorts.interface] = {
        type: 'interface',
        baudRate: 9600,
        interfaceId: fileConfig.comPorts.interfaceId || 'your-interface-id-from-db',
        address: 16,
      }
    }
    if (fileConfig.comPorts.hopper) {
      config.peripherals[fileConfig.comPorts.hopper] = {
        type: 'hopper',
        baudRate: 9600,
        address: 3,
      }
    }
    if (fileConfig.comPorts.cardDispenser) {
      config.peripherals[fileConfig.comPorts.cardDispenser] = {
        type: 'card_dispenser',
        baudRate: 9600,
        address: 4,
        protocol: 'cctalk',
      }
    }
    if (fileConfig.comPorts.printer) {
      config.peripherals[fileConfig.comPorts.printer] = {
        type: 'printer',
        baudRate: 9600,
      }
    }
    if (fileConfig.comPorts.rfid) {
      config.peripherals[fileConfig.comPorts.rfid] = {
        type: 'rfid_reader',
        baudRate: 9600,
      }
    }
  }
} else {
  // Fallback to hardcoded config for development
  console.log('[AgentServer] No config file provided, using default configuration')
  config.peripherals = {
    // Example configuration - adjust COM ports and types based on actual hardware
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
      interfaceId: 'your-interface-id-from-db', // Get from database
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
      protocol: 'cctalk', // or 'pulse'
    },
    'COM6': {
      type: 'printer',
      baudRate: 9600,
    },
    'COM7': {
      type: 'rfid_reader',
      baudRate: 9600,
    },
  }
}

const agent = new HardwareAgent(config)

agent.start().catch((err) => {
  console.error('[AgentServer] Failed to start:', err)
  process.exit(1)
})

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('[AgentServer] Shutting down...')
  await agent.stop()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('[AgentServer] Shutting down...')
  await agent.stop()
  process.exit(0)
})

import HardwareAgent from './hardwareAgent.js'
import dotenv from 'dotenv'

dotenv.config()

const config = {
  serverUrl: process.env.HARDWARE_SERVER_URL || 'ws://localhost:3000/hardware-agent',
  apiKey: process.env.HARDWARE_AGENT_API_KEY,
  reconnectInterval: 5000,
  peripherals: {
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
  },
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

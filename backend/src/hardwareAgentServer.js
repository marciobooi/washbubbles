/**
 * Hardware Agent WebSocket Server
 * Handles communication between the remote backend and local hardware agents running on POS machines
 */

import { WebSocketServer } from 'ws'
import User from './models/user.js'
import EventEmitter from 'events'

class HardwareAgentServer extends EventEmitter {
  constructor() {
    super()
    this.wss = null
    this.agents = new Map() // agentId -> { socket, peripherals, connectedAt }
  }

  init(server) {
    this.wss = new WebSocketServer({ server, path: '/hardware-agent' })
    
    this.wss.on('connection', async (socket, request) => {
      // Authenticate hardware agent via API key
      const apiKeyHeader = request.headers['x-api-key'] || 
        (request.headers['authorization'] && request.headers['authorization'].startsWith('ApiKey ') 
          ? request.headers['authorization'].split(' ')[1] 
          : null)
      
      if (!apiKeyHeader) {
        console.warn('[HardwareAgentServer] No API key provided')
        socket.close(1008, 'Unauthorized: API key required')
        return
      }
      
      const userModel = await User.findOne({ apiKey: apiKeyHeader })
      if (!userModel || userModel.role !== 'KIOSK') {
        console.warn('[HardwareAgentServer] Invalid API key or not a KIOSK user')
        socket.close(1008, 'Unauthorized: Invalid API key')
        return
      }
      
      const agentId = userModel._id.toString()
      socket._agentId = agentId
      socket._connectedAt = new Date()
      socket.isAlive = true
      
      this.agents.set(agentId, {
        socket,
        peripherals: [],
        connectedAt: socket._connectedAt,
        userModel,
      })
      
      console.log(`[HardwareAgentServer] Agent connected: ${userModel.username} (${agentId})`)
      
      socket.on('pong', () => { socket.isAlive = true })
      
      socket.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString())
          this.handleAgentMessage(agentId, msg)
        } catch (err) {
          console.error('[HardwareAgentServer] Failed to parse agent message:', err)
        }
      })
      
      socket.on('close', () => {
        console.log(`[HardwareAgentServer] Agent disconnected: ${agentId}`)
        this.agents.delete(agentId)
      })
      
      socket.on('error', (err) => {
        console.error(`[HardwareAgentServer] Agent ${agentId} error:`, err.message)
      })
    })
    
    // Heartbeat monitor
    setInterval(() => {
      this.wss.clients.forEach((client) => {
        if (client.isAlive === false) {
          console.log(`[HardwareAgentServer] Terminating dead agent: ${client._agentId}`)
          client.terminate()
          return
        }
        client.isAlive = false
        client.ping()
      })
    }, 30000)
    
    console.log('[HardwareAgentServer] Hardware agent WebSocket server initialized')
  }
  
  handleAgentMessage(agentId, msg) {
    const { type, payload } = msg
    
    console.log(`[HardwareAgentServer] Received from ${agentId}: ${type}`, payload)
    
    switch (type) {
      case 'agent:connected':
        this.handleAgentConnected(agentId, payload)
        break
      case 'peripheral:credit':
        this.emit('peripheral:credit', { agentId, ...payload })
        break
      case 'interface:status':
        this.emit('interface:status', { agentId, ...payload })
        break
      case 'interface:error':
        this.emit('interface:error', { agentId, ...payload })
        break
      case 'hopper:dispensed':
        this.emit('hopper:dispensed', { agentId, ...payload })
        break
      case 'card_dispenser:dispensed':
        this.emit('card_dispenser:dispensed', { agentId, ...payload })
        break
      case 'printer:error':
        this.emit('printer:error', { agentId, ...payload })
        break
      case 'rfid:card_detected':
        this.emit('rfid:card_detected', { agentId, ...payload })
        break
      case 'machine:activation_sent':
        this.emit('machine:activation_sent', { agentId, ...payload })
        break
      case 'machine:activation_failed':
        this.emit('machine:activation_failed', { agentId, ...payload })
        break
      default:
        console.warn(`[HardwareAgentServer] Unknown message type: ${type}`)
    }
  }
  
  handleAgentConnected(agentId, payload) {
    const agent = this.agents.get(agentId)
    if (agent) {
      agent.peripherals = payload.peripherals || []
      console.log(`[HardwareAgentServer] Agent ${agentId} peripherals:`, agent.peripherals)
    }
    this.emit('agent:connected', { agentId, peripherals: payload.peripherals })
  }
  
  // Send command to specific agent
  sendToAgent(agentId, type, payload) {
    const agent = this.agents.get(agentId)
    if (!agent || !agent.socket || agent.socket.readyState !== agent.socket.OPEN) {
      console.warn(`[HardwareAgentServer] Agent ${agentId} not connected`)
      return false
    }
    
    const msg = JSON.stringify({ type, payload })
    agent.socket.send(msg)
    console.log(`[HardwareAgentServer] Sent to ${agentId}: ${type}`)
    return true
  }
  
  // Send command to all agents (broadcast)
  broadcast(type, payload) {
    const msg = JSON.stringify({ type, payload })
    let sent = 0
    
    this.agents.forEach((agent, agentId) => {
      if (agent.socket && agent.socket.readyState === agent.socket.OPEN) {
        agent.socket.send(msg)
        sent++
      }
    })
    
    console.log(`[HardwareAgentServer] Broadcast ${type} to ${sent} agents`)
    return sent
  }
  
  // Get list of connected agents
  getConnectedAgents() {
    return Array.from(this.agents.entries()).map(([agentId, agent]) => ({
      agentId,
      username: agent.userModel.username,
      connectedAt: agent.connectedAt,
      peripherals: agent.peripherals,
    }))
  }
  
  // Check if specific agent is connected
  isAgentConnected(agentId) {
    const agent = this.agents.get(agentId)
    return agent && agent.socket && agent.socket.readyState === agent.socket.OPEN
  }
}

// Singleton instance
const hardwareAgentServer = new HardwareAgentServer()

export default hardwareAgentServer

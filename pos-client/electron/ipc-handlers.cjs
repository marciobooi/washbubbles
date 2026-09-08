/**
 * WashBubbles IPC Handlers
 * Bridges the Electron main process with the React renderer
 */
const { ipcMain } = require('electron')

/**
 * Validation for anything the renderer sends over IPC.
 *
 * The renderer is a browser context loading remote content — treat everything it
 * sends as untrusted. These handlers used to forward `amount` verbatim: a
 * negative amount in `processSale` made the balance *increase* while still
 * passing the `< 0` check downstream, and `card:topUp` never checked the session
 * cash balance, so any renderer call could mint credit out of nothing.
 */
const MAX_TXN_AMOUNT = 1000

function assertAmount(value, label = 'amount') {
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number`)
  if (n <= 0) throw new Error(`${label} must be greater than zero`)
  if (n > MAX_TXN_AMOUNT) throw new Error(`${label} exceeds the ${MAX_TXN_AMOUNT} limit`)
  return Math.round(n * 100) / 100
}

function assertId(value, label = 'id') {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  if (value.length > 128) throw new Error(`${label} is too long`)
  return value.trim()
}

function assertMethod(value) {
  const m = String(value || 'cash')
  if (!['cash', 'card'].includes(m)) throw new Error('method must be cash or card')
  return m
}

function registerIpcHandlers(posEngine, syncEngine, hardwareAgent) {
  // ─── POS Engine ───
  ipcMain.handle('pos:getMachines', () => posEngine.getMachines())
  ipcMain.handle('pos:getMachine', (e, id) => posEngine.getMachine(id))
  ipcMain.handle('pos:getPrice', (e, type, weight) => posEngine.getPrice(type, weight))
  ipcMain.handle('pos:processSale', (e, machineId, amount, method, cardCode, batchId, items) =>
    posEngine.processSale(
      assertId(machineId, 'machineId'),
      assertAmount(amount),
      assertMethod(method),
      cardCode == null ? null : assertId(cardCode, 'cardCode'),
      batchId == null ? null : String(batchId).slice(0, 128),
      items
    ))
  ipcMain.handle('pos:getSession', () => posEngine.getSession())
  ipcMain.handle('pos:resetSession', () => posEngine.resetSession())
  ipcMain.handle('pos:getTransactions', (e, limit) => posEngine.getTransactions(limit))
  ipcMain.handle('pos:getSettings', () => posEngine.getAllSettings())
  ipcMain.handle('pos:performDayClose', (e, notes) => posEngine.performDayClose(notes))
  ipcMain.handle('wifi:issueVoucher', (e, batchId) => posEngine.issueWifiVoucher(assertId(batchId, 'batchId')))

  // ─── Card Operations ───
  ipcMain.handle('card:get', (e, code) => posEngine.getCard(assertId(code, 'card code')))
  ipcMain.handle('card:getHistory', (e, code) => posEngine.getCardHistory(assertId(code, 'card code')))
  ipcMain.handle('card:topUp', (e, code, amount) => {
    const cardCode = assertId(code, 'card code')
    const value = assertAmount(amount)
    // A top-up must be paid for. Without this the renderer could mint balance by
    // calling card:topUp directly — no cash need ever have been inserted.
    const session = posEngine.getSession()
    const available = Math.round(((session.cashBalance || 0) + (session.bonus || 0)) * 100) / 100
    if (value > available) {
      throw new Error(`Cannot top up ${value.toFixed(2)} — only ${available.toFixed(2)} has been inserted`)
    }
    return posEngine.topUpCard(cardCode, value)
  })
  ipcMain.handle('card:remove', () => posEngine.removeCard())

  // ─── Sync Engine ───
  ipcMain.handle('sync:getStatus', () => syncEngine.getStatus())
  ipcMain.handle('sync:forceSync', () => syncEngine.forceSync())

  // ─── Hardware Agent ───
  ipcMain.handle('hw:getStatus', () => hardwareAgent.getStatus())
  ipcMain.handle('hw:dispenseChange', (e, amount) => posEngine.dispenseChange(assertAmount(amount)))
  ipcMain.handle('hw:printReceipt', (e, content) => {
    if (typeof content !== 'string') throw new Error('receipt content must be a string')
    return posEngine.printReceipt(content.slice(0, 4000))
  })
  // Starting a machine for free is a staff action, so it must be authenticated.
  // This was callable by any renderer script with no check at all.
  ipcMain.handle('hw:adminStartMachine', (e, id, adminPin) => {
    requireAdminPin(posEngine, adminPin)
    return posEngine.adminStartMachine(assertId(id, 'machineId'))
  })
}

/**
 * Gate free-of-charge staff actions behind the operator's admin PIN.
 *
 * Compared in constant time so the check cannot be brute-forced by timing, and
 * refused outright when no PIN is configured — failing closed is the only safe
 * default for an action that starts machines without payment.
 */
function requireAdminPin(posEngine, providedPin) {
  // `getSetting` returns the settings ROW, not the value.
  const row = posEngine.getSetting ? posEngine.getSetting('adminPin') : null
  const expected = row ? (row.parsedValue ?? row.value) : null
  if (!expected) throw new Error('Admin PIN is not configured — refusing to start a machine for free')
  const a = Buffer.from(String(expected))
  const b = Buffer.from(String(providedPin || ''))
  const ok = a.length === b.length && require('crypto').timingSafeEqual(a, b)
  if (!ok) throw new Error('Invalid admin PIN')
}

function setupEventForwarding(posEngine, syncEngine, hardwareAgent, getWindow) {
  const forward = (channel, data) => {
    const win = getWindow()
    if (win) win.webContents.send(channel, data)
  }

  // POS events
  posEngine.on('session:updated', (session) => forward('pos:session-updated', session))
  posEngine.on('card:loaded', (data) => forward('card:loaded', data))
  posEngine.on('card:unknown', (data) => forward('card:unknown', data))
  posEngine.on('card:blocked', (data) => forward('card:blocked', data))
  posEngine.on('card:removed', () => forward('card:removed'))
  posEngine.on('credit:accepted', (data) => forward('pos:credit-accepted', data))
  posEngine.on('sale:completed', (data) => forward('pos:sale-completed', data))
  posEngine.on('machine:activated', (data) => forward('pos:machine-activated', data))

  // Sync events
  syncEngine.on('online', () => forward('sync:status-changed', { online: true }))
  syncEngine.on('offline', () => forward('sync:status-changed', { online: false }))
  syncEngine.on('sync:pushed', (data) => forward('sync:pushed', data))
  syncEngine.on('sync:pulled', (data) => forward('sync:pulled', data))

  // Hardware events
  hardwareAgent.on('rfid:card_detected', (data) => forward('hw:rfid-detected', data))
  hardwareAgent.on('credit', (data) => forward('hw:credit-received', data))
  hardwareAgent.on('hardware:error', (data) => forward('hw:error', data))
  hardwareAgent.on('hardware:reconnected', (data) => forward('hw:reconnected', data))
}

module.exports = { registerIpcHandlers, setupEventForwarding }

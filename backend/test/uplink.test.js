import { expect } from 'chai'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { startTestDb, stopTestDb } from './setup.test-helper.js'
import Tenant from '../src/models/tenant.js'
import Sale from '../src/models/sale.js'
import Card from '../src/models/card.js'
import Peripheral from '../src/models/peripheral.js'
import DayClose from '../src/models/dayClose.js'
import AuditLog from '../src/models/auditLog.js'
import SyncOutbox from '../src/models/syncOutbox.js'
import { Uplink } from '../src/services/uplink.js'
import { CashSessionStore } from '../src/services/cashSession.js'
import { CoinMachine } from '../src/services/coinMachine.js'
import { creditCard, debitCard } from '../src/services/cardBalance.js'

// The waits below are for background work (queueing a sale, a flush) to settle. A shared CI runner is several times
// slower than a laptop and the fixed waits flaked there (twice on GitHub, never locally): wait longer on CI.
const SLOWNESS = process.env.CI ? 6 : 1
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms * SLOWNESS))

/** A central server that can be offline, erroring, or fine — and records what it received. */
function fakeCentral() {
  const s = { calls: [], mode: 'ok', onCall: null }
  s.fetch = async (url, opts) => {
    const call = { path: new URL(url).pathname, body: JSON.parse(opts.body), auth: opts.headers.Authorization }
    if (s.mode === 'offline') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    s.calls.push(call)
    if (s.onCall) await s.onCall(call)
    const respond = (status, text = '') => ({ ok: status >= 200 && status < 300, status, text: async () => text })
    if (s.mode === 'http500') return respond(500, 'boom')
    if (s.mode === 'http400') return respond(400, 'bad payload')
    if (s.mode === 'http401') return respond(401, 'nope')
    if (call.path === '/api/sync/push/card' && call.body.status === 'active' && !call.body.create && call.body.balance === undefined) {
      return respond(409, 'Card is not awaiting activation') // the common "already active" answer
    }
    return respond(200)
  }
  s.pathsSent = () => s.calls.map((c) => c.path)
  return s
}

describe('Uplink — offline-first queue to the central server', function () {
  let tenant, central, uplink
  const outbox = (q = {}) => SyncOutbox.find({ tenantId: tenant._id, ...q }).sort({ createdAt: 1 }).lean()
  const mkUplink = (opts = {}) => new Uplink({
    tenantId: tenant._id, url: 'http://central.test/api', apiKey: 'test-key',
    intervalMs: 3_600_000, fetchImpl: central.fetch, ...opts,
  })
  const cashSale = (amount, inserted, change = 0) =>
    Sale.create({ tenantId: tenant._id, amount, type: 'payment', method: 'cash', inserted, change })

  before(async () => {
    await startTestDb()
    tenant = await Tenant.create({ name: 'Uplink Test', slug: `uplink-${Date.now()}` })
  })
  after(async () => {
    await Promise.all([Sale, Card, DayClose, AuditLog, SyncOutbox].map((M) => M.deleteMany({ tenantId: tenant._id })))
    await Tenant.deleteOne({ _id: tenant._id })
    await stopTestDb()
  })
  beforeEach(() => { central = fakeCentral(); uplink = mkUplink(); uplink.start() })
  afterEach(async () => {
    uplink.stop()
    await tick(60) // let a late queueing from this test finish BEFORE the clean-up, or it leaks into the next test
    await Promise.all([Sale, Card, DayClose, AuditLog, SyncOutbox].map((M) => M.deleteMany({ tenantId: tenant._id })))
  })

  describe('sales (coins, bills, cards)', () => {
    it('queues a cash sale in the same instant and sends the server\'s expected payload', async () => {
      central.mode = 'offline' // even before we have any connection
      const sale = await cashSale(2.5, 5, 2.5) // €5 in (coins/bills), €2.50 change
      await tick(40)
      const [q] = await outbox()
      expect(q).to.include({ entityType: 'sale', entityId: String(sale._id), status: 'pending' })
      expect(q.payload).to.include({ local_id: String(sale._id), type: 'payment', amount: 2.5, method: 'cash', inserted: 5, change_amount: 2.5 })
      // local ids that mean nothing centrally are never sent
      expect(q.payload).to.not.have.any.keys('machine_id', 'card_id', 'machineId', 'cardId')
    })

    it('OFFLINE: payments made with no connection are kept, then all sent in order when it returns', async () => {
      central.mode = 'offline'
      const a = await cashSale(1, 1)
      const b = await cashSale(2, 5, 3)
      const c = await cashSale(0.5, 0.5)
      await tick(60)
      uplink.nextTryAt = 0 // (the automatic attempt already backed off — correctly)
      expect((await uplink.flush()).status).to.equal('offline')
      expect(await outbox({ status: 'pending' })).to.have.length(3)
      expect((await outbox())[0].attempts).to.equal(0) // being offline is NOT a failure
      expect((await uplink.status())).to.include({ online: false, pending: 3, dead: 0 })

      central.mode = 'ok' // internet is back
      uplink.nextTryAt = 0
      const r = await uplink.flush()
      expect(r).to.include({ status: 'ok', sent: 3 })
      const sentIds = central.calls.filter((x) => x.path === '/api/sync/push/sale').map((x) => x.body.local_id)
      expect(sentIds).to.deep.equal([String(a._id), String(b._id), String(c._id)]) // oldest first
      expect(central.calls.every((x) => x.auth === 'ApiKey test-key')).to.equal(true)
      expect(await outbox({ status: 'pending' })).to.have.length(0)
      expect((await uplink.status())).to.include({ online: true, pending: 0 })
    })

    it('survives a restart: a new worker drains what the old one queued', async () => {
      central.mode = 'offline'
      await cashSale(3, 3)
      await tick(40)
      uplink.stop()

      central.mode = 'ok'
      const restarted = mkUplink()
      restarted.start() // drains on start
      await tick(150)
      expect(central.pathsSent()).to.include('/api/sync/push/sale')
      expect(await outbox({ status: 'pending' })).to.have.length(0)
      restarted.stop()
    })

    it('never sends a sale twice, and does not queue sales that came FROM the server', async () => {
      await cashSale(1, 1)
      await tick(80)
      await uplink.flush()
      await uplink.flush()
      expect(central.calls.filter((c) => c.path === '/api/sync/push/sale')).to.have.length(1)

      await Sale.create({ tenantId: tenant._id, amount: 9, metadata: { localId: 'from-server', syncedAt: new Date() } })
      await tick(60)
      expect(await outbox({ entityId: /.+/ })).to.have.length(1)
    })

    it('DOES queue an ordinary sale even though the kiosk UI tagged it with a localId retry key', async () => {
      central.mode = 'offline'
      const sale = await Sale.create({ tenantId: tenant._id, amount: 4, method: 'cash', inserted: 5, change: 1, metadata: { localId: 'ui-retry-key-123' } })
      await tick(60)
      const q = await outbox({ entityType: 'sale' })
      expect(q).to.have.length(1)
      expect(q[0].payload.local_id).to.equal(String(sale._id)) // the stable, globally unique id
    })

    it('does not queue when the central server is not configured', async () => {
      uplink.stop()
      const off = mkUplink({ url: '' })
      off.start()
      await cashSale(1, 1)
      await tick(50)
      expect(await outbox()).to.have.length(0)
      off.stop()
    })
  })

  describe('failure handling', () => {
    it('server errors (5xx) are retried and never abandoned', async () => {
      central.mode = 'http500'
      uplink.maxAttempts = 2
      await cashSale(1, 1)
      await tick(60)
      for (let i = 0; i < 4; i++) {
        await SyncOutbox.updateMany({ tenantId: tenant._id }, { $set: { nextAttemptAt: new Date(0) } })
        await uplink.flush()
      }
      const [q] = await outbox()
      expect(q.status).to.equal('pending')
      expect(q.attempts).to.be.greaterThan(2)
    })

    it('a permanently rejected record (4xx) goes to "dead" after the attempt limit, and can be retried', async () => {
      central.mode = 'http400'
      uplink.maxAttempts = 2
      await cashSale(1, 1)
      await tick(60)
      for (let i = 0; i < 3; i++) {
        await SyncOutbox.updateMany({ tenantId: tenant._id, status: 'pending' }, { $set: { nextAttemptAt: new Date(0) } })
        await uplink.flush()
      }
      const [q] = await outbox()
      expect(q.status).to.equal('dead')
      expect(q.lastError).to.match(/HTTP 400/)
      expect((await uplink.status()).dead).to.equal(1)

      central.mode = 'ok'
      expect((await uplink.retryDead()).requeued).to.equal(1)
      await tick(80)
      expect((await outbox())[0].status).to.equal('sent')
    })

    it('a rejected API key keeps every record and does not burn attempts', async () => {
      central.mode = 'http401'
      await cashSale(1, 1)
      await tick(60)
      uplink.nextTryAt = 0
      expect((await uplink.flush()).status).to.equal('auth-failed')
      const [q] = await outbox()
      expect(q).to.include({ status: 'pending', attempts: 0 })
      expect((await uplink.status()).authFailed).to.equal(true)
    })
  })

  describe('cards', () => {
    const mkCard = (code, balance, status = 'active') => Card.create({ tenantId: tenant._id, code, balance, status })

    it('many offline changes to one card become ONE update carrying the latest balance', async () => {
      central.mode = 'offline'
      await mkCard('U1', 10)
      await tick(40)
      for (const n of [1, 2, 3]) { await debitCard(Card, { tenantId: tenant._id, code: 'U1' }, n); await tick(20) }
      await tick(60)
      const pending = await outbox({ entityType: 'card', status: 'pending' })
      expect(pending).to.have.length(1)
      expect(pending[0].payload.balance).to.equal(4)

      central.mode = 'ok'
      uplink.nextTryAt = 0
      await uplink.flush()
      const balances = central.calls.filter((c) => c.body.balance !== undefined && !c.body.create).map((c) => c.body.balance)
      expect(balances).to.deep.equal([4])
    })

    it('creates the card centrally, activates it, then sets the balance', async () => {
      await mkCard('U2', 7.5)
      await tick(80)
      await uplink.flush()
      const c = central.calls.filter((x) => x.path === '/api/sync/push/card').map((x) => x.body)
      expect(c[0]).to.include({ create: true, code: 'U2', balance: 7.5, status: 'active' })
      expect(c[1]).to.deep.include({ code: 'U2', status: 'active' })
      expect(c[2]).to.deep.equal({ code: 'U2', balance: 7.5 })
      expect((await outbox({ entityType: 'card' }))[0].status).to.equal('sent') // the 409 "already active" was fine
    })

    it('a card still awaiting its write is created as pending_write only', async () => {
      await mkCard('U3', 5, 'pending_write')
      await tick(80)
      await uplink.flush()
      const c = central.calls.filter((x) => x.path === '/api/sync/push/card').map((x) => x.body)
      expect(c).to.have.length(1)
      expect(c[0]).to.include({ create: true, status: 'pending_write' })
    })

    it('a change that lands WHILE a push is in flight is not lost', async () => {
      await mkCard('U4', 10)
      await tick(100) // creation settles
      central.calls.length = 0

      let interrupted = false
      central.onCall = async (call) => {
        // while the first request of the next push is in flight, the customer spends again
        if (!interrupted && call.body.create) {
          interrupted = true
          await debitCard(Card, { tenantId: tenant._id, code: 'U4' }, 2) // -> 7, queued mid-flight
          await tick(40)
        }
      }
      await debitCard(Card, { tenantId: tenant._id, code: 'U4' }, 1) // -> 9: triggers the push
      await tick(400)

      expect(interrupted).to.equal(true)
      const balances = central.calls.filter((c) => c.body.balance !== undefined && !c.body.create).map((c) => c.body.balance)
      expect(balances.at(-1)).to.equal(7) // the newer state went out, the stale 9 did not stick
      expect(await outbox({ entityType: 'card', status: 'pending' })).to.have.length(0)
    })
  })

  describe('day close', () => {
    it('queues Z-reports but not float adjustments', async () => {
      await DayClose.create({ tenantId: tenant._id, source: 'dashboard', totalCash: 20, totalCard: 5, totalSales: 25, salesCount: 4, denominations: [] })
      await DayClose.create({ tenantId: tenant._id, source: 'adjustment', denominations: [] })
      await tick(80)
      const q = await outbox({ entityType: 'day_close' })
      expect(q).to.have.length(1)
      expect(q[0].payload).to.include({ total_cash: 20, total_card: 5, total_sales: 25, sale_count: 4 })
    })
  })
})

describe('CashSessionStore — inserted cash survives a restart', () => {
  let dir, file
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cashsess-')); file = path.join(dir, 'cash-session.json') })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('saves synchronously and restores after a "restart"', () => {
    new CashSessionStore({ file, tenantId: 't1' }).save({ balance: 7.5, bonus: 0.25 })
    expect(fs.existsSync(file)).to.equal(true)
    expect(fs.existsSync(`${file}.tmp`)).to.equal(false) // atomic: no temp file left behind
    const r = new CashSessionStore({ file, tenantId: 't1' }).take()
    expect(r).to.include({ balance: 7.5, bonus: 0.25 })
    expect(fs.existsSync(file)).to.equal(false) // taken
  })

  it('removes the file when the session is empty, and skips no-op writes', () => {
    const s = new CashSessionStore({ file, tenantId: 't1' })
    s.save({ balance: 2, bonus: 0 })
    s.save({ balance: 0, bonus: 0 })
    expect(fs.existsSync(file)).to.equal(false)
    expect(s.take()).to.equal(null)
  })

  it('does not hand cash to a stranger after a long gap: too old => reported as expired', () => {
    new CashSessionStore({ file, tenantId: 't1' }).save({ balance: 5, bonus: 0 })
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    raw.savedAt = Date.now() - 3 * 3_600_000 // 3 hours ago
    fs.writeFileSync(file, JSON.stringify(raw))
    const r = new CashSessionStore({ file, tenantId: 't1', maxAgeMinutes: 30 }).take()
    expect(r.expired).to.include({ balance: 5 })
  })

  it('ignores another tenant\'s file and a corrupt file', () => {
    new CashSessionStore({ file, tenantId: 'other' }).save({ balance: 9, bonus: 0 })
    expect(new CashSessionStore({ file, tenantId: 't1' }).take()).to.equal(null)
    fs.writeFileSync(file, '{ not json')
    expect(new CashSessionStore({ file, tenantId: 't1' }).take()).to.equal(null)
  })
})

describe('CoinMachine restores inserted cash after a restart', () => {
  let tenant, dir
  before(async () => { await startTestDb(); tenant = await Tenant.create({ name: 'Cash Test', slug: `cash-${Date.now()}` }) })
  after(async () => { await AuditLog.deleteMany({ tenantId: tenant._id }); await Tenant.deleteOne({ _id: tenant._id }); await stopTestDb() })
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cashsess2-')) })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  const machine = () => {
    const cm = new CoinMachine({ tenantId: tenant._id, middleware: { subscribe: () => ({ unsubscribe() {} }) } })
    cm.cashStore = new CashSessionStore({ file: path.join(dir, 'cash-session.json'), tenantId: tenant._id })
    return cm
  }

  it('a coin credited before a power cut is credited again after it — and keeps being saved', async () => {
    const before = machine()
    before.cashSub = before.client.subscribe((s) => before.cashStore.save({ balance: s.balance, bonus: s.bonus }))
    before.client.addToBalance(0.5) // customer inserts coins/bills...
    before.client.addToBalance(5)   // ...then power is cut (no graceful stop)
    expect(before.client.getState().balance).to.equal(5.5)

    const after = machine() // a fresh process
    expect(after.client.getState().balance).to.equal(0)
    await after.restoreCashSession()
    expect(after.client.getState().balance).to.equal(5.5)
    expect(after.client.getState().credits).to.equal(5.5)
    expect((await AuditLog.find({ tenantId: tenant._id, action: 'cash.session.recovered' })).length).to.equal(1)

    // starting to persist again must not wipe it (subscribe fires immediately)
    after.cashSub = after.client.subscribe((s) => after.cashStore.save({ balance: s.balance, bonus: s.bonus }))
    expect(new CashSessionStore({ file: path.join(dir, 'cash-session.json'), tenantId: tenant._id }).take().balance).to.equal(5.5)
  })

  it('cash spent before the restart is not restored', async () => {
    const before = machine()
    before.cashSub = before.client.subscribe((s) => before.cashStore.save({ balance: s.balance, bonus: s.bonus }))
    before.client.addToBalance(5)
    before.client.deductCredits(5)
    const after = machine()
    await after.restoreCashSession()
    expect(after.client.getState().balance).to.equal(0)
  })

  it('old cash is not restored but is recorded for the operator', async () => {
    const before = machine()
    before.cashSub = before.client.subscribe((s) => before.cashStore.save({ balance: s.balance, bonus: s.bonus }))
    before.client.addToBalance(4)
    const f = path.join(dir, 'cash-session.json')
    const raw = JSON.parse(fs.readFileSync(f, 'utf8')); raw.savedAt = Date.now() - 5 * 3_600_000
    fs.writeFileSync(f, JSON.stringify(raw))

    const after = machine()
    await after.restoreCashSession()
    expect(after.client.getState().balance).to.equal(0)
    expect((await AuditLog.find({ tenantId: tenant._id, action: 'cash.session.expired' })).length).to.be.greaterThan(0)
  })
})

describe('Uplink — peripheral status for the central admin', function () {
  let tenant, central, uplink
  before(async () => {
    await startTestDb()
    tenant = await Tenant.create({ name: 'Status Test', slug: `status-${Date.now()}` })
  })
  after(async () => {
    await Peripheral.deleteMany({ tenantId: tenant._id })
    await Tenant.deleteOne({ _id: tenant._id })
    await stopTestDb()
  })
  beforeEach(async () => {
    await Peripheral.deleteMany({ tenantId: tenant._id })
    central = fakeCentral()
    uplink = new Uplink({ tenantId: tenant._id, url: 'http://central.test/api', apiKey: 'k', intervalMs: 3_600_000, statusIntervalMs: 3_600_000, fetchImpl: central.fetch })
  })

  it('sends nothing when there are no peripherals', async () => {
    expect(await uplink.pushPeripheralStatus()).to.equal(false)
    expect(central.calls).to.have.length(0)
  })

  it('sends each peripheral id with its live status, only when something changed', async () => {
    const hopper = await Peripheral.create({ tenantId: tenant._id, name: 'Hopper', type: 'hopper', status: 'ok' })
    expect(await uplink.pushPeripheralStatus()).to.equal(true)
    expect(central.calls[0].path).to.equal('/api/sync/push/peripheral-status')
    expect(central.calls[0].body.peripherals).to.deep.equal([{ id: String(hopper._id), status: 'ok' }])
    expect(await uplink.pushPeripheralStatus()).to.equal(false) // unchanged: no repeat inside 5 min
    await Peripheral.updateOne({ _id: hopper._id }, { status: 'fault' })
    expect(await uplink.pushPeripheralStatus()).to.equal(true)
    expect(central.calls[1].body.peripherals[0].status).to.equal('fault')
  })

  it('is not an error to be offline: it just tries again next time', async () => {
    await Peripheral.create({ tenantId: tenant._id, name: 'Printer', type: 'printer', status: 'ok' })
    central.mode = 'offline'
    expect(await uplink.pushPeripheralStatus()).to.equal(false)
    central.mode = 'ok'
    expect(await uplink.pushPeripheralStatus()).to.equal(true)
  })
})

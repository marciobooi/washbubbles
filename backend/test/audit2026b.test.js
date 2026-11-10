import { expect } from 'chai'
import request from 'supertest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import mongoose from 'mongoose'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'

// Second batch of small fixes from the 2026-11 audit.
describe('Audit 2026-11 (b)', function () {
  this.timeout(20000)
  let app, tenant, admin, kiosk, Machine, Sale, Tenant, coinMachine, keepalive, saved
  const kioskAuth = () => ({ Authorization: `ApiKey ${kiosk.apiKey}` })
  const adminAuth = () => ({ Authorization: `Bearer ${signToken(admin)}` })

  before(async () => {
    await startTestDb()
    app = await buildTestApp()
    Machine = (await import('../src/models/machine.js')).default
    Sale = (await import('../src/models/sale.js')).default
    Tenant = (await import('../src/models/tenant.js')).default
    coinMachine = (await import('../src/services/coinMachine.js')).default
    keepalive = await import('../src/routes/middleware.js')
  })
  after(async () => { await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb()
    ;({ tenant, admin, kiosk } = await seedTenantAndUsers())
    saved = { running: coinMachine.running, tenantId: coinMachine.tenantId, client: { ...coinMachine.client.client } }
    keepalive._resetKeepalive()
  })
  afterEach(() => {
    coinMachine.running = saved.running
    coinMachine.tenantId = saved.tenantId
    Object.assign(coinMachine.client.client, saved.client)
    keepalive._setKeepaliveClock(null)
    keepalive._resetKeepalive()
  })

  describe('central key: the shop check fails closed', () => {
    const ID = 'a'.repeat(24)
    const key = 'b'.repeat(24)
    let applyCentralKey, envFile
    before(async () => { ({ applyCentralKey } = await import('../src/services/centralKey.js')) })
    beforeEach(() => {
      envFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ck-')), '.env')
      process.env.SHOP_TENANT_ID = ID
    })
    afterEach(() => { delete process.env.SHOP_TENANT_ID })
    const run = (fetchImpl) => applyCentralKey(key, { serverUrl: 'https://central.test/api', fetchImpl, envFile })
    const settingsOk = { ok: true, status: 200 }

    it('whoami offline: the key is not saved', async () => {
      const r = await run(async (u) => { if (u.endsWith('/installer/whoami')) throw new TypeError('fetch failed'); return settingsOk })
      expect(r).to.include({ ok: false, code: 'offline' })
      expect(fs.existsSync(envFile)).to.equal(false)
    })

    it('whoami answers 500: the key is not saved', async () => {
      const r = await run(async (u) => (u.endsWith('/installer/whoami') ? { ok: false, status: 500 } : settingsOk))
      expect(r).to.include({ ok: false, code: 'server-error' })
      expect(fs.existsSync(envFile)).to.equal(false)
    })

    it('whoami says 401, no tenant, or another shop: refused', async () => {
      const who = (res) => run(async (u) => (u.endsWith('/installer/whoami') ? res : settingsOk))
      expect(await who({ ok: false, status: 401 })).to.include({ ok: false, code: 'rejected' })
      expect(await who({ ok: true, status: 200, json: async () => ({}) })).to.include({ ok: false, code: 'rejected' })
      expect(await who({ ok: true, status: 200, json: async () => ({ tenantId: 'c'.repeat(24) }) })).to.include({ ok: false, code: 'rejected' })
      expect(fs.existsSync(envFile)).to.equal(false)
    })

    it('whoami with this shop\'s id: goes on and the key is saved', async () => {
      const old = process.env.SYNC_API_KEY
      try {
        const r = await run(async (u) => (u.endsWith('/installer/whoami') ? { ok: true, status: 200, json: async () => ({ tenantId: ID }) } : settingsOk))
        expect(r.ok).to.equal(true)
        expect(fs.readFileSync(envFile, 'utf8')).to.include(`SYNC_API_KEY=${key}`)
      } finally { if (old === undefined) delete process.env.SYNC_API_KEY; else process.env.SYNC_API_KEY = old }
    })
  })

  describe('sales reach the central server with their machine', () => {
    it('the uplink payload carries the machine id', async () => {
      const { salePayload } = await import('../src/services/uplink.js')
      const id = new mongoose.Types.ObjectId()
      expect(salePayload({ _id: new mongoose.Types.ObjectId(), amount: 1, machineId: id, cardId: id }).machine_id).to.equal(String(id))
      expect(salePayload({ _id: new mongoose.Types.ObjectId(), amount: 1 }).machine_id).to.equal(undefined)
      expect(salePayload({ _id: new mongoose.Types.ObjectId(), amount: 1, cardId: id })).to.not.have.property('card_id')
    })

    const push = (body) => request(app).post('/api/sync/push/sale').set(kioskAuth()).send({ amount: 2, method: 'cash', ...body })

    it('a machine of this shop is stored on the sale', async () => {
      const m = await Machine.create({ tenantId: tenant._id, name: 'L1', type: 'wash', status: 'free' })
      const r = await push({ local_id: 'loc-1', machine_id: String(m._id) })
      expect(r.status).to.equal(200)
      expect(String((await Sale.findOne({ 'metadata.localId': 'loc-1' })).machineId)).to.equal(String(m._id))
    })

    it('another shop\'s machine, an unknown id or garbage is ignored: the sale is still created', async () => {
      const other = await Tenant.create({ name: 'Other', slug: `other-${Date.now()}` })
      const foreign = await Machine.create({ tenantId: other._id, name: 'X1', type: 'wash', status: 'free' })
      const cases = [String(foreign._id), String(new mongoose.Types.ObjectId()), 'not-an-id']
      for (const [i, machine_id] of cases.entries()) {
        const r = await push({ local_id: `loc-x${i}`, machine_id })
        expect(r.status, machine_id).to.equal(200)
        const sale = await Sale.findOne({ 'metadata.localId': `loc-x${i}` })
        expect(sale, machine_id).to.exist
        expect(sale.machineId, machine_id).to.not.exist
      }
    })
  })

  describe('keepalive cannot hold cash for ever', () => {
    let now, touched
    beforeEach(() => {
      now = 1_000_000
      keepalive._setKeepaliveClock(() => now)
      touched = 0
      coinMachine.touchCredit = () => { touched++ } // an own property that hides the class method
      Object.assign(coinMachine.client.client, { balance: 5, hasCard: false })
    })
    afterEach(() => { delete coinMachine.touchCredit })
    const ping = () => request(app).post('/api/middleware/client/keepalive').set(kioskAuth())

    it('extends the wait while the balance is fresh, stops after 15 minutes, and a new coin restarts the clock', async () => {
      let r = await ping()
      expect(r.status).to.equal(200)
      expect(r.body).to.include({ ok: true, extended: true })
      now += 14 * 60_000
      expect((await ping()).body.extended).to.equal(true)
      expect(touched).to.equal(2)
      now += 2 * 60_000 // 16 minutes with the same balance
      r = await ping()
      expect(r.body).to.include({ ok: true, extended: false })
      expect(touched).to.equal(2) // the refund was not postponed again
      coinMachine.client.client.balance = 7 // another coin
      r = await ping()
      expect(r.body.extended).to.equal(true)
      expect(touched).to.equal(3)
    })
  })

  describe('admin list filters', () => {
    it('a repeated filter (an array) is ignored instead of breaking the query; a normal one still filters', async () => {
      await Sale.create({ tenantId: tenant._id, amount: 3, type: 'payment', method: 'cash' })
      await Sale.create({ tenantId: tenant._id, amount: 4, type: 'recharge', method: 'cash' })
      const rows = (r) => r.text.trim().split('\n').length - 1
      const all = await request(app).get('/api/admin/transactions/export.csv').set(adminAuth())
      expect(rows(all)).to.equal(2)
      const arr = await request(app).get('/api/admin/transactions/export.csv?type=payment&type=recharge').set(adminAuth())
      expect(arr.status).to.equal(200)
      expect(rows(arr)).to.equal(2) // ignored: nothing filtered
      const one = await request(app).get('/api/admin/transactions/export.csv?type=payment').set(adminAuth())
      expect(one.status).to.equal(200)
      expect(rows(one)).to.equal(1)
      expect((await request(app).get('/api/admin/search?q=a&q=b').set(adminAuth())).status).to.equal(200)
      expect((await request(app).get('/api/admin/audit-log?action=a&action=b').set(adminAuth())).status).to.equal(200)
    })
  })
})

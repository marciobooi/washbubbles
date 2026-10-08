import { expect } from 'chai'
import mongoose from 'mongoose'
import { startTestDb, stopTestDb } from './setup.test-helper.js'
import Tenant from '../src/models/tenant.js'
import Machine from '../src/models/machine.js'
import Price from '../src/models/price.js'
import Setting from '../src/models/setting.js'
import Peripheral from '../src/models/peripheral.js'
import { Downlink } from '../src/services/downlink.js'

const oid = () => new mongoose.Types.ObjectId().toString()

/** A central server answering the pull endpoints from an in-memory snapshot. */
function fakeCentral(data) {
  const s = { data, mode: 'ok', calls: [] }
  s.fetch = async (url, opts) => {
    const u = new URL(url)
    s.calls.push({ path: u.pathname, search: u.search, auth: opts.headers.Authorization })
    if (s.mode === 'offline') throw new TypeError('fetch failed')
    if (s.mode === 'http500') return { ok: false, status: 500, json: async () => ({}) }
    const name = u.pathname.split('/').pop()
    return { ok: true, status: 200, json: async () => s.data[name] ?? [] }
  }
  return s
}

describe('Downlink — central server is the source of truth', function () {
  let tenant, central
  const centralTenant = oid() // the ids on Hetzner belong to ANOTHER tenant
  const mk = () => new Downlink({ tenantId: tenant._id, url: 'http://central.test/api', apiKey: 'k', fetchImpl: central.fetch })
  const wipe = () => Promise.all([Machine, Price, Setting, Peripheral].map((M) => M.deleteMany({ tenantId: tenant._id })))

  before(async () => {
    await startTestDb()
    tenant = await Tenant.create({ name: 'Downlink Test', slug: `down-${Date.now()}` })
  })
  after(async () => { await wipe(); await Tenant.deleteOne({ _id: tenant._id }); await stopTestDb() })
  beforeEach(async () => {
    await wipe()
    central = fakeCentral({
      machines: [
        { _id: oid(), tenantId: centralTenant, name: 'Lavar 1', number: 1, type: 'wash', weight: 8, intId: 11, status: 'fault', cycle: 999 },
        { _id: oid(), tenantId: centralTenant, name: 'Secar 1', number: 2, type: 'dry', weight: 10, intId: 12 },
      ],
      prices: [{ _id: oid(), tenantId: centralTenant, type: 'wash', weight: 8, cashPrice: 4, cardPrice: 3.5 }],
      settings: [{ _id: oid(), tenantId: centralTenant, key: 'shopName', value: 'Fresh Bubbles' }],
    })
  })

  it('is disabled without URL and key, and makes no calls', async () => {
    const d = new Downlink({ tenantId: tenant._id, url: '', apiKey: '', fetchImpl: central.fetch })
    expect(await d.pullAll()).to.equal(false)
    expect(central.calls).to.have.length(0)
  })

  it('fills an empty site with the central machines, prices and settings under THIS tenant', async () => {
    expect(await mk().pullAll()).to.equal(true)
    const machines = await Machine.find({ tenantId: tenant._id }).sort({ number: 1 })
    expect(machines.map((m) => m.name)).to.deep.equal(['Lavar 1', 'Secar 1'])
    expect(String(machines[0].tenantId)).to.equal(String(tenant._id))
    expect(String(machines[0]._id)).to.equal(central.data.machines[0]._id) // central ids kept
    expect((await Price.findOne({ tenantId: tenant._id })).cashPrice).to.equal(4)
    expect((await Setting.findOne({ tenantId: tenant._id, key: 'shopName' })).value).to.equal('Fresh Bubbles')
    expect(central.calls.every((c) => c.auth === 'ApiKey k' && c.search === '')).to.equal(true) // full snapshots
  })

  it('never overwrites this site\'s runtime state, but does update configuration', async () => {
    await mk().pullAll()
    const id = central.data.machines[0]._id
    await Machine.updateOne({ _id: id }, { status: 'working', cycle: 41 })
    central.data.machines[0].name = 'Lavar 1 (renamed)'
    central.data.machines[0].status = 'free'
    await mk().pullAll()
    const m = await Machine.findById(id)
    expect(m.name).to.equal('Lavar 1 (renamed)')
    expect(m.status).to.equal('working')
    expect(m.cycle).to.equal(41)
  })

  it('removes rows central no longer has, and a local row cannot block a central price', async () => {
    await Price.create({ tenantId: tenant._id, type: 'wash', weight: 8, cashPrice: 99, cardPrice: 99 }) // clashes on type+weight
    await Machine.create({ tenantId: tenant._id, name: 'Old local', number: 7 })
    await mk().pullAll()
    expect((await Price.find({ tenantId: tenant._id })).map((p) => p.cashPrice)).to.deep.equal([4])
    expect(await Machine.countDocuments({ tenantId: tenant._id, name: 'Old local' })).to.equal(0)
  })

  it("never overwrites a peripheral's live status or the hopper's coin stock", async () => {
    const id = oid()
    central.data.peripherals = [{ _id: id, tenantId: centralTenant, name: 'Hopper', type: 'hopper', status: 'fault', hopperConfig: { coinValue: 1, currentCount: 0 } }]
    await mk().pullAll()
    expect((await Peripheral.findById(id)).status).to.equal('unknown') // new row: schema default, never central's "fault"
    await Peripheral.updateOne({ _id: id }, { status: 'ok', 'hopperConfig.currentCount': 120 })
    central.data.peripherals[0].hopperConfig = { coinValue: 2, currentCount: 0 }
    central.data.peripherals[0].name = 'Hopper 2'
    await mk().pullAll()
    const p = await Peripheral.findById(id)
    expect(p.name).to.equal('Hopper 2') // configuration still follows central
    expect(p.hopperConfig.coinValue).to.equal(2)
    expect(p.status).to.equal('ok') // live status stays
    expect(p.hopperConfig.currentCount).to.equal(120) // coin stock stays
  })

  it('keeps site-only settings (settings are never deleted)', async () => {
    await Setting.create({ tenantId: tenant._id, key: 'coinEqTable', value: { a: 1 } })
    await mk().pullAll()
    expect(await Setting.countDocuments({ tenantId: tenant._id, key: 'coinEqTable' })).to.equal(1)
  })

  it('does nothing destructive when central is offline, errors, or returns an empty list', async () => {
    await mk().pullAll()
    const before = await Machine.countDocuments({ tenantId: tenant._id })
    for (const mode of ['offline', 'http500']) {
      central.mode = mode
      expect(await mk().pullAll()).to.equal(false)
    }
    central.mode = 'ok'
    central.data.machines = []; central.data.prices = []
    expect(await mk().pullAll()).to.equal(true)
    expect(await Machine.countDocuments({ tenantId: tenant._id })).to.equal(before)
    expect(await Price.countDocuments({ tenantId: tenant._id })).to.equal(1)
  })
})

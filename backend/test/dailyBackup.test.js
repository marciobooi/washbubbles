import { expect } from 'chai'
import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'
import { execFileSync } from 'child_process'
import mongoose from 'mongoose'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers } from './setup.test-helper.js'
import { runShopBackup, verifyDump, writeDump, dueKey, tick, _reset } from '../src/services/dailyBackup.js'

describe('Daily copy of the data, kept on the shop PC and on the central server', function () {
  this.timeout(30000)
  let app, server, url, tenant, kiosk, Card, Sale, Tenant, tmp, shopDir, centralDir, savedDir
  const lines = (file) => zlib.gunzipSync(fs.readFileSync(file)).toString().trim().split('\n').map((l) => JSON.parse(l))

  before(async () => {
    await startTestDb()
    app = await buildTestApp()
    Card = (await import('../src/models/card.js')).default
    Sale = (await import('../src/models/sale.js')).default
    Tenant = (await import('../src/models/tenant.js')).default
    server = app.listen(0)
    url = `http://127.0.0.1:${server.address().port}/api`
    savedDir = process.env.BACKUP_DIR
  })
  after(async () => { server.close(); if (savedDir === undefined) delete process.env.BACKUP_DIR; else process.env.BACKUP_DIR = savedDir; await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb()
    ;({ tenant, kiosk } = await seedTenantAndUsers())
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-backup-'))
    shopDir = path.join(tmp, 'shop'); centralDir = path.join(tmp, 'central')
    process.env.BACKUP_DIR = centralDir // what the routes (the central server's side) use
    _reset()
    await Card.create({ tenantId: tenant._id, code: 'MINE', balance: 7, status: 'active' })
    await Sale.create({ tenantId: tenant._id, amount: 5, method: 'cash', type: 'payment', items: [{}] })
  })
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

  const run = (key) => runShopBackup({ key, dir: shopDir, url, apiKey: kiosk.apiKey })

  it('both copies end up in both places, and the central one holds only this shop', async () => {
    const other = await Tenant.create({ name: 'Other shop', slug: 'other-shop' })
    await Card.create({ tenantId: other._id, code: 'NOT-MINE', balance: 99, status: 'active' })
    const r = await run('20261110')
    expect(r.shop.docs).to.be.greaterThan(2)
    expect(r.sent.docs).to.equal(r.shop.docs)
    const mine = path.join(centralDir, String(tenant._id))
    expect(fs.readdirSync(shopDir).sort()).to.deep.equal(['central-20261110.json.gz', 'shop-20261110.json.gz'])
    expect(fs.readdirSync(mine).sort()).to.deep.equal(['central-20261110.json.gz', 'shop-20261110.json.gz'])
    // the same bytes on both sides
    for (const f of fs.readdirSync(shopDir)) expect(fs.readFileSync(path.join(shopDir, f)).equals(fs.readFileSync(path.join(mine, f)))).to.equal(true)
    const central = lines(path.join(shopDir, 'central-20261110.json.gz'))
    const cards = central.filter((l) => l.c === 'cards').map((l) => l.d.code)
    expect(cards).to.deep.equal(['MINE'])
    expect(central.filter((l) => l.c === 'tenants')).to.have.length(1)
  })

  it('a week of copies is kept, and an older one is deleted only when the new one is in place', async () => {
    for (let d = 3; d <= 11; d++) await run('202611' + String(d).padStart(2, '0')) // nine days
    const week = ['05', '06', '07', '08', '09', '10', '11']
    const expected = [...week.map((d) => `central-202611${d}.json.gz`), ...week.map((d) => `shop-202611${d}.json.gz`)]
    expect(fs.readdirSync(shopDir).sort()).to.deep.equal(expected)
    expect(fs.readdirSync(path.join(centralDir, String(tenant._id))).sort()).to.deep.equal(expected)
    // the central server cannot be reached: yesterday's central copy stays, today's shop copy is still made
    let failed = null
    try { await runShopBackup({ key: '20261112', dir: shopDir, url: 'http://127.0.0.1:9/api', apiKey: kiosk.apiKey }) } catch (e) { failed = e }
    expect(failed).to.be.an('error')
    const after = fs.readdirSync(shopDir)
    expect(after).to.include('shop-20261112.json.gz').and.to.include('central-20261111.json.gz').and.to.include('central-20261105.json.gz')
    expect(after).to.not.include('central-20261112.json.gz').and.to.not.include('shop-20261105.json.gz')
  })

  it('a copy that is cut short is refused, by the reader and by the central server', async () => {
    const file = path.join(shopDir, 'x.json.gz')
    await writeDump(file)
    const whole = lines(file)
    const cut = path.join(shopDir, 'cut.json.gz')
    fs.writeFileSync(cut, zlib.gzipSync(whole.slice(0, -1).map((l) => JSON.stringify(l)).join('\n') + '\n'))
    let err = null
    try { await verifyDump(cut) } catch (e) { err = e }
    expect(err?.message).to.match(/cut short/)
    const res = await fetch(`${url}/sync/backup/shop?stamp=20261110&part=0&parts=1`, { method: 'POST', headers: { Authorization: `ApiKey ${kiosk.apiKey}`, 'Content-Type': 'application/octet-stream' }, body: fs.readFileSync(cut) })
    expect(res.status).to.equal(400)
    expect(fs.existsSync(path.join(centralDir, String(tenant._id), 'shop-20261110.json.gz'))).to.equal(false)
    const anon = await fetch(`${url}/sync/backup/central?stamp=20261110`)
    expect(anon.status).to.equal(401)
  })

  it('a copy can be loaded back into an empty database', async () => {
    const file = path.join(shopDir, 'shop.json.gz')
    const { docs } = await writeDump(file)
    const target = 'mongodb://localhost:27017/washstore_test_restore'
    const out = execFileSync('node', ['scripts/restore-backup.mjs', file, target], { encoding: 'utf8' })
    expect(out).to.match(new RegExp(`restored ${docs} rows`))
    const other = mongoose.connection.getClient().db('washstore_test_restore') // the driver's own handle: useDb() would tie a second mongoose connection to this one
    try {
      const card = await other.collection('cards').findOne({ code: 'MINE' })
      expect(card.balance).to.equal(7)
      expect(String(card.tenantId)).to.equal(String(tenant._id))
      expect(card.createdAt).to.be.instanceOf(Date)
    } finally { await other.dropDatabase() }
  })

  it('the copy is due at 23:00 Lisbon time, and is made once', async () => {
    expect(dueKey(new Date('2026-11-10T22:59:00Z'))).to.equal('20261109')
    expect(dueKey(new Date('2026-11-10T23:00:00Z'))).to.equal('20261110')
    expect(dueKey(new Date('2026-07-10T22:00:00Z'))).to.equal('20260710') // summer: 23:00 in Lisbon is 22:00 UTC
    let runs = 0
    const deps = { now: () => new Date('2026-11-10T23:05:00Z'), run: async ({ key }) => { runs++; return { key, shop: { docs: 1, bytes: 1 } } } }
    expect(await tick(null, deps)).to.equal('ok')
    expect(await tick(null, deps)).to.equal('done')
    expect(runs).to.equal(1)
    expect(await tick(null, { ...deps, now: () => new Date('2026-11-11T23:05:00Z') })).to.equal('ok')
    expect(runs).to.equal(2)
  })
})

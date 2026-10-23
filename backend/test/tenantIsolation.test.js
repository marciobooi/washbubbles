import { expect } from 'chai'
import bcrypt from 'bcryptjs'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'

/**
 * Two shops (tenants) on one server: shop A's people must never see, change or delete shop B's data.
 * Shop B is filled with data carrying a marker; every listing the admin / kiosk of shop A can call is searched for it.
 */
const MARK = 'TENANT-B-SECRET'

describe('Tenant isolation: shop A cannot see or touch shop B', function () {
  this.timeout(60000)
  let app, tA, tB, adminA, kioskA, adminTokenA, M = {}
  before(async () => {
    await startTestDb(); await clearTestDb()
    app = await buildTestApp()
    ;({ tenant: tA, admin: adminA, kiosk: kioskA } = await seedTenantAndUsers())
    adminTokenA = signToken(adminA)
    const Tenant = (await import('../src/models/tenant.js')).default
    tB = await Tenant.create({ name: `${MARK} Loja B`, slug: 'loja-b' })
    const mod = async (n) => (await import(`../src/models/${n}.js`)).default
    const [User, Machine, Price, Card, Setting, Interface, Peripheral, Sale, Coupon, DayClose, Ticket, AuditLog] = await Promise.all(
      ['user', 'machine', 'price', 'card', 'setting', 'interface', 'peripheral', 'sale', 'coupon', 'dayClose', 'maintenanceTicket', 'auditLog'].map(mod))
    const pw = await bcrypt.hash('x', 10)
    M.adminB = await User.create({ tenantId: tB._id, username: `${MARK}-admin`, password: pw, role: 'ADMIN' })
    M.kioskB = await User.create({ tenantId: tB._id, username: `${MARK}-kiosk`, password: pw, role: 'KIOSK', apiKey: 'b'.repeat(48) })
    M.machine = await Machine.create({ tenantId: tB._id, name: `${MARK} Lavar`, type: 'wash', weight: 8 })
    M.price = await Price.create({ tenantId: tB._id, type: 'wash', weight: 99, price: 99 })
    M.card = await Card.create({ tenantId: tB._id, code: `${MARK}-CARD`, balance: 50, name: `${MARK} Cliente` })
    await Setting.create({ tenantId: tB._id, key: 'branding.companyName', value: `${MARK} Marca` })
    await Setting.create({ tenantId: tB._id, key: 'alerts.email', value: `${MARK}@b.test` })
    M.iface = await Interface.create({ tenantId: tB._id, name: `${MARK} Int`, address: '77', serialNumber: 'SN-B', status: 'active' })
    await Peripheral.create({ tenantId: tB._id, name: `${MARK} Leitor`, type: 'rfid_reader', enabled: true })
    M.sale = await Sale.create({ tenantId: tB._id, amount: 12.34, type: 'payment', method: 'cash', cardCode: `${MARK}-CARD` })
    await Coupon.create({ tenantId: tB._id, code: `${MARK}CUP`, discountType: 'percent', value: 10 }).catch(() => {})
    await DayClose.create({ tenantId: tB._id, totalSales: 1, totalCash: 1, notes: `${MARK} fecho` }).catch(() => {})
    await Ticket.create({ tenantId: tB._id, title: `${MARK} avaria`, machineId: M.machine._id }).catch(() => {})
    await AuditLog.create({ tenantId: tB._id, actorUsername: `${MARK}-admin`, action: 'x', details: { marker: MARK } })
  })
  after(async () => { await stopTestDb() })

  const leaks = (body) => JSON.stringify(body).includes(MARK) || JSON.stringify(body).includes('bbbbbbbbbbbb')

  it('every admin listing of shop A is free of shop B data', async () => {
    const paths = [
      '/users', '/machines', '/prices', '/cards', '/settings', '/interfaces', '/peripherals', '/transactions', '/coupons',
      '/audit-log', '/day-close', '/day-closes', '/maintenance', '/maintenance/tickets', '/analytics/revenue', '/search?q=TENANT',
      '/shop-status', '/overview', '/dashboard',
    ]
    const checked = []
    for (const p of paths) {
      const r = await request(app).get(`/api/admin${p}`).set('Authorization', `Bearer ${adminTokenA}`)
      if (r.status === 404) continue // that listing does not exist under this name
      checked.push(p)
      expect(leaks(r.body), `/admin${p} leaked shop B data`).to.equal(false)
    }
    expect(checked.length).to.be.greaterThan(8)
  })

  it('shop A cannot read, change or delete a single record of shop B by id', async () => {
    // every call must ANSWER: a request that never returns is a bug too (the error says which one)
    const A = (m, p, b) => request(app)[m](`/api/admin${p}`).set('Authorization', `Bearer ${adminTokenA}`).send(b).timeout(8000).catch((e) => { throw new Error(`${m.toUpperCase()} /admin${p} did not answer: ${e.message}`) })
    for (const [path, body] of [[`/machines/${M.machine._id}`, { name: 'hacked' }], [`/prices/${M.price._id}`, { price: 1 }], [`/interfaces/${M.iface._id}`, { name: 'hacked' }], [`/users/${M.adminB._id}`, { role: 'USER' }], [`/cards/${M.card._id}`, { name: 'hacked' }]]) {
      const get = await A('get', path)
      expect([404, 405], `GET ${path}`).to.include(get.status)
      const put = await A('put', path, body)
      expect([404, 405], `PUT ${path}`).to.include(put.status)
      const del = await A('delete', path)
      expect([404, 405, 200], `DELETE ${path}`).to.include(del.status)
    }
    const Machine = (await import('../src/models/machine.js')).default
    expect((await Machine.findById(M.machine._id)).name).to.equal(`${MARK} Lavar`) // untouched
    const User = (await import('../src/models/user.js')).default
    expect(await User.findById(M.adminB._id)).to.not.equal(null)
    expect((await User.findById(M.adminB._id)).role).to.equal('ADMIN')
  })

  it("shop A's kiosk key syncs only shop A's data (pull + push)", async () => {
    for (const p of ['cards', 'machines', 'prices', 'settings', 'interfaces', 'peripherals']) {
      const r = await request(app).get(`/api/sync/pull/${p}`).set('Authorization', `ApiKey ${kioskA.apiKey}`)
      expect(r.status).to.equal(200)
      expect(leaks(r.body), `pull ${p}`).to.equal(false)
    }
    // a push naming shop B's card code creates it under shop A only
    const push = await request(app).post('/api/sync/push/card').set('Authorization', `ApiKey ${kioskA.apiKey}`).send({ code: `${MARK}-CARD`, balance: 1 })
    const Card = (await import('../src/models/card.js')).default
    expect((await Card.findById(M.card._id)).balance).to.equal(50) // shop B's card untouched
    expect(push.status).to.be.oneOf([200, 400, 404])
  })

  it("an admin edit of a card saves the holder's details, and only for a card of the admin's own shop", async () => {
    const Card = (await import('../src/models/card.js')).default
    const own = await Card.create({ tenantId: tA._id, code: 'OWN-1', balance: 5 })
    const put = (id, body) => request(app).put(`/api/admin/cards/${id}`).set('Authorization', `Bearer ${adminTokenA}`).send(body).timeout(5000)
    const r = await put(own._id, { balance: 5, name: '  Ana Silva ', email: 'ana@x.pt', phone: '912345678', contribuinte: '123456789' })
    expect(r.status).to.equal(200)
    expect(await Card.findById(own._id).lean()).to.include({ name: 'Ana Silva', email: 'ana@x.pt', phone: '912345678', contribuinte: '123456789', balance: 5 })
    expect((await put(own._id, { name: 'Só o nome' })).status).to.equal(200) // no balance in the request: the balance is left alone
    expect((await Card.findById(own._id).lean()).balance).to.equal(5)
    expect((await put(own._id, { email: 'not-an-email' })).status).to.equal(400)
    expect((await put(M.card._id, { name: 'hacked' })).status).to.equal(404) // shop B's card
    expect((await Card.findById(M.card._id).lean()).name).to.equal(`${MARK} Cliente`)
  })

  it("the kiosk screen of shop A sees only its own machines, prices and settings", async () => {
    for (const p of ['/pos/machines', '/pos/machine-status', '/pos/prices/lookup?type=wash&weight=99', '/pos/settings/branding.companyName']) {
      const r = await request(app).get(`/api${p}`).set('Authorization', `ApiKey ${kioskA.apiKey}`)
      expect(leaks(r.body), p).to.equal(false)
    }
  })

  it('a header cannot make an authenticated user of shop A act as shop B', async () => {
    const r = await request(app).get('/api/admin/machines').set('Authorization', `Bearer ${adminTokenA}`).set('X-Tenant-Id', String(tB._id))
    expect(leaks(r.body)).to.equal(false)
  })

  // PENDING until docs/PLAN-MULTI-LOJA.md phase 1.3 is built: today the same username in two shops makes /auth/login ambiguous.
  it.skip('PLAN 1.3: the same username in two shops must not make /auth/login ambiguous', async () => {
    const User = (await import('../src/models/user.js')).default
    const pw = await bcrypt.hash('same-password-1', 10)
    // both shops have a user called "dono" with different passwords
    await User.create({ tenantId: tA._id, username: 'dono', password: await bcrypt.hash('password-of-A', 10), role: 'ADMIN' })
    await User.create({ tenantId: tB._id, username: 'dono', password: pw, role: 'ADMIN' })
    const a = await request(app).post('/api/auth/login').send({ username: 'dono', password: 'password-of-A' })
    const b = await request(app).post('/api/auth/login').send({ username: 'dono', password: 'same-password-1' })
    // whichever record the database returns first wins: one of the two shops' owners cannot log in
    expect([a.status, b.status].sort(), 'both owners of the same-named user should be able to log in').to.deep.equal([200, 200])
  })
})

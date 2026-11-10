import { expect } from 'chai'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'
import { tallySales } from '../src/services/dayClose.js'

describe('Gift card — a free card for a customer, credit zero by default', function () {
  this.timeout(30000)
  let app, tenant, kiosk, admin, adminToken, Card, Sale, CardPurchase, Peripheral, Setting, SyncCommand, User, coinMachine, dispensed
  const saved = {}
  const auth = () => ({ Authorization: `ApiKey ${kiosk.apiKey}` })
  const gift = (body) => request(app).post('/api/pos/card/gift').set(auth()).send(body)

  before(async () => {
    await startTestDb(); await clearTestDb()
    app = await buildTestApp()
    ;({ tenant, kiosk, admin } = await seedTenantAndUsers())
    adminToken = signToken(admin) // (not through /login: its rate limit is shared by the whole suite)
    Card = (await import('../src/models/card.js')).default
    Sale = (await import('../src/models/sale.js')).default
    CardPurchase = (await import('../src/models/cardPurchase.js')).default
    Peripheral = (await import('../src/models/peripheral.js')).default
    Setting = (await import('../src/models/setting.js')).default
    SyncCommand = (await import('../src/models/syncCommand.js')).default
    User = (await import('../src/models/user.js')).default
    coinMachine = (await import('../src/services/coinMachine.js')).default
    await Setting.create({ tenantId: tenant._id, key: 'adminPin', value: '4321' })
    await Peripheral.create({ tenantId: tenant._id, name: 'Distribuidor', type: 'card_dispenser', enabled: true })
    saved.running = coinMachine.running; saved.dispense = coinMachine.dispenseNewCard
    coinMachine.running = true
    coinMachine.tenantId = tenant._id
    dispensed = 0
    coinMachine.dispenseNewCard = async () => { dispensed++; return { success: true } }
  })
  after(async () => {
    coinMachine.running = saved.running; coinMachine.dispenseNewCard = saved.dispense
    await stopTestDb()
  })

  it('needs the staff PIN: none, wrong, or a kiosk key alone gets no card', async () => {
    expect((await gift({})).status).to.equal(400)
    expect((await gift({ pin: '0000' })).status).to.equal(401)
    expect(dispensed).to.equal(0)
    expect(await Card.countDocuments({ tenantId: tenant._id })).to.equal(0)
  })

  it('with the PIN: a card comes out with credit ZERO, charged nothing, recorded as a 0 EUR gift', async () => {
    const r = await gift({ pin: '4321' })
    expect(r.status).to.equal(200)
    expect(r.body.credit).to.equal(0)
    expect(dispensed).to.equal(1)
    const card = await Card.findOne({ code: r.body.cardCode })
    expect(card.balance).to.equal(0)
    expect(card.status).to.equal('pending_write') // not spendable until written at the reader
    const sale = await Sale.findOne({ cardCode: r.body.cardCode })
    expect(sale).to.include({ amount: 0, method: 'gift', type: 'gift_card', change: 0, inserted: 0 })
    expect(sale.metadata.initialCredit).to.equal(0)
    const cp = await CardPurchase.findOne({ cardCode: r.body.cardCode })
    expect(cp).to.include({ purchasePrice: 0, paymentMethod: 'gift' })
  })

  it('staff can give a starting credit; it is on the card and in the trail, but is not "paid money" in the books', async () => {
    const r = await gift({ pin: '4321', credit: 5, customerName: 'Ana' })
    expect(r.status).to.equal(200)
    const card = await Card.findOne({ code: r.body.cardCode })
    expect(card.balance).to.equal(5)
    expect(card.name).to.equal('Ana')
    const sale = await Sale.findOne({ cardCode: r.body.cardCode })
    expect(sale.metadata.giftCredit).to.equal(5)
    expect(sale.metadata.initialCredit).to.equal(0)
    // day close: no cash, no prepaid, no sales from a gift
    expect(tallySales([sale])).to.include({ totalCash: 0, totalRecharges: 0, totalSales: 0, totalChangeDispensed: 0 })
  })

  it('refuses a negative, silly or over-the-cap credit', async () => {
    for (const credit of [-1, 101, 'abc', 1e9]) {
      const r = await gift({ pin: '4321', credit })
      expect(r.status, `credit ${credit}`).to.equal(400)
    }
  })

  it('a dispenser that does not release a card leaves nothing behind', async () => {
    const before = await Card.countDocuments({ tenantId: tenant._id })
    const prev = coinMachine.dispenseNewCard
    coinMachine.dispenseNewCard = async () => { throw new Error('jam') }
    try {
      const r = await gift({ pin: '4321' })
      expect(r.status).to.equal(503)
      expect(await Card.countDocuments({ tenantId: tenant._id })).to.equal(before)
    } finally { coinMachine.dispenseNewCard = prev }
  })

  it('no dispenser configured: refused, nothing recorded', async () => {
    await Peripheral.updateMany({ tenantId: tenant._id, type: 'card_dispenser' }, { enabled: false })
    try { expect((await gift({ pin: '4321' })).status).to.equal(503) }
    finally { await Peripheral.updateMany({ tenantId: tenant._id, type: 'card_dispenser' }, { enabled: true }) }
  })

  it('the admin: on the shop it runs at once; on the central server it is queued for the shop (and refused while the shop is offline)', async () => {
    const post = (body) => request(app).post('/api/admin/cards/gift').set('Authorization', `Bearer ${adminToken}`).send(body)
    const direct = await post({ credit: 0 })
    expect(direct.status).to.equal(200)
    expect(direct.body.queued).to.equal(false)
    coinMachine.running = false // the central server has no hardware
    try {
      await User.findByIdAndUpdate(kiosk._id, { lastSeen: new Date(Date.now() - 10 * 60_000) })
      const off = await post({ credit: 0 })
      expect(off.status).to.equal(409)
      expect(off.body.code).to.equal('shop-offline')
      await User.findByIdAndUpdate(kiosk._id, { lastSeen: new Date() })
      const q = await post({ credit: 3 })
      expect(q.body.queued).to.equal(true)
      const cmd = await SyncCommand.findOne({ type: 'gift_card' })
      expect(cmd.payload.credit).to.equal(3)
      expect((await post({ credit: 5000 })).status).to.equal(400)
    } finally { coinMachine.running = true }
  })

  it('an operator (shop assistant) cannot hand out gift cards from the admin', async () => {
    const op = await User.create({ tenantId: tenant._id, username: 'op', email: 'op@test.local', password: 'x', role: 'OPERATOR' })
    const tok = signToken(op)
    const r = await request(app).post('/api/admin/cards/gift').set('Authorization', `Bearer ${tok}`).send({ credit: 5 })
    expect(r.status).to.be.oneOf([401, 403])
  })
})

describe('Gift card — shows up centrally (transactions, card history, audit trail)', function () {
  this.timeout(30000)
  let app, tenant, kiosk, adminToken
  before(async () => {
    await startTestDb(); await clearTestDb()
    app = await buildTestApp()
    let admin
    ;({ tenant, kiosk, admin } = await seedTenantAndUsers())
    adminToken = signToken(admin)
  })
  after(async () => { await stopTestDb() })

  it('a gift sale pushed by the shop is a transaction of type gift_card and leaves an audit entry with who and how much', async () => {
    const push = await request(app).post('/api/sync/push/sale').set({ Authorization: `ApiKey ${kiosk.apiKey}` }).send({
      local_id: 'g-1', type: 'gift_card', amount: 0, method: 'gift', card_code: '1234567890',
      items: [{ type: 'gift_card', name: 'Cartão de oferta (crédito 5.00 €)', amount: 0, credit: 5, cardCode: '1234567890', by: 'staff PIN (kiosk)' }],
    })
    expect(push.body.status).to.equal('created')
    const tx = await request(app).get('/api/admin/transactions').set('Authorization', `Bearer ${adminToken}`)
    const row = tx.body.find((t) => t.cardCode === '1234567890')
    expect(row).to.include({ type: 'gift_card', method: 'gift', amount: 0 })
    expect(row.items[0].credit).to.equal(5)
    const audit = await request(app).get('/api/admin/audit-log').set('Authorization', `Bearer ${adminToken}`)
    const entry = audit.body.find((a) => a.action === 'card.gift_issued')
    expect(entry.details).to.include({ cardCode: '1234567890', credit: 5, by: 'staff PIN (kiosk)' })
    // a retried push does not log it twice
    await request(app).post('/api/sync/push/sale').set({ Authorization: `ApiKey ${kiosk.apiKey}` }).send({ local_id: 'g-1', type: 'gift_card', amount: 0, method: 'gift' })
    const audit2 = await request(app).get('/api/admin/audit-log').set('Authorization', `Bearer ${adminToken}`)
    expect(audit2.body.filter((a) => a.action === 'card.gift_issued')).to.have.length(1)
  })
})

describe('Staff machines on the kiosk (PIN) — start with cycles / release by hand', function () {
  this.timeout(30000)
  let app, tenant, kiosk, coinMachine, Machine, Interface, Setting, Sale, sent
  const saved = {}
  // about WHICH blocks reach the machine (one command, n impulses); the separate-commands default has its own tests (dryerBlocks)
  beforeEach(() => { process.env.DRYER_IMPULSE_MODE = 'batch' })
  afterEach(() => { delete process.env.DRYER_IMPULSE_MODE })
  const auth = () => ({ Authorization: `ApiKey ${kiosk.apiKey}` })
  const call = (id, kind, body) => request(app).post(`/api/pos/staff/machines/${id}/${kind}`).set(auth()).send(body)

  before(async () => {
    await startTestDb(); await clearTestDb()
    app = await buildTestApp()
    ;({ tenant, kiosk } = await seedTenantAndUsers())
    Machine = (await import('../src/models/machine.js')).default
    Interface = (await import('../src/models/interface.js')).default
    Setting = (await import('../src/models/setting.js')).default
    Sale = (await import('../src/models/sale.js')).default
    coinMachine = (await import('../src/services/coinMachine.js')).default
    await Setting.create({ tenantId: tenant._id, key: 'adminPin', value: '4321' })
    saved.running = coinMachine.running; saved.send = coinMachine.middleware.sendMachineActivation
    coinMachine.running = true
    coinMachine.tenantId = tenant._id
    sent = []
    coinMachine.middleware.sendMachineActivation = async (m, iface, impulses) => { sent.push({ machine: m.name, impulses: impulses ?? null }) }
  })
  after(async () => { coinMachine.running = saved.running; coinMachine.middleware.sendMachineActivation = saved.send; await stopTestDb() })

  const mk = async (name, type, port) => {
    const iface = (await Interface.findOne({ tenantId: tenant._id })) || (await Interface.create({ tenantId: tenant._id, name: 'Int K', address: '14', serialNumber: 'SN-K', status: 'active' }))
    return Machine.create({ tenantId: tenant._id, name, type, weight: 8, interfaceId: iface._id, port, tImp: type === 'dry' ? 15 : null })
  }

  it('no PIN or a wrong PIN: nothing starts, nothing stops', async () => {
    const m = await mk('Secar K1', 'dry', 1)
    expect((await call(m._id, 'start', {})).status).to.equal(400)
    expect((await call(m._id, 'start', { pin: '0000' })).status).to.equal(401)
    expect(sent).to.have.length(0)
    expect((await Machine.findById(m._id)).status).to.equal('free')
  })

  it('with the PIN a dryer starts for the chosen cycles (1..8), is recorded as a 0 EUR admin start, and can be released', async () => {
    const m = await mk('Secar K2', 'dry', 2)
    const r = await call(m._id, 'start', { pin: '4321', blocks: 3 })
    expect(r.status).to.equal(200)
    expect(r.body.blocks).to.equal(3)
    expect(sent.at(-1)).to.deep.equal({ machine: 'Secar K2', impulses: 3 })
    expect((await Machine.findById(m._id)).status).to.equal('working')
    const sale = await Sale.findOne({ machineId: m._id, type: 'admin_start' })
    expect(sale.amount).to.equal(0)
    expect(sale.metadata.blocks).to.equal(3)
    expect((await call(m._id, 'start', { pin: '4321' })).status).to.equal(400) // already running: no second pulse
    expect((await call(m._id, 'end', { pin: '4321' })).status).to.equal(200)
    expect((await Machine.findById(m._id)).status).to.equal('free')
    const big = await mk('Secar K3', 'dry', 3)
    expect((await call(big._id, 'start', { pin: '4321', blocks: 99 })).body.blocks).to.equal(8)
  })

  it('a washer starts with one click, and a machine out of service is refused', async () => {
    const w = await mk('Lavar K1', 'wash', 4)
    expect((await call(w._id, 'start', { pin: '4321', blocks: 5 })).status).to.equal(200)
    expect(sent.at(-1).impulses).to.equal(null)
    const bad = await mk('Lavar K2', 'wash', 5)
    await Machine.findByIdAndUpdate(bad._id, { outOfService: true })
    expect((await call(bad._id, 'start', { pin: '4321' })).status).to.equal(400)
  })

  it('five wrong PINs lock the actions for that kiosk; a right PIN before that never does', async () => {
    const m = await mk('Secar K9', 'dry', 6)
    for (let i = 0; i < 5; i++) expect((await call(m._id, 'start', { pin: '1111' })).status).to.equal(401)
    expect((await call(m._id, 'start', { pin: '4321' })).status).to.equal(429)
  })
})

describe('Admin transactions — period filter', function () {
  this.timeout(30000)
  let app, tenant, adminToken, Sale
  before(async () => {
    await startTestDb(); await clearTestDb()
    app = await buildTestApp()
    let admin
    ;({ tenant, admin } = await seedTenantAndUsers())
    adminToken = signToken(admin)
    Sale = (await import('../src/models/sale.js')).default
    const mk = (amount, createdAt) => Sale.create({ tenantId: tenant._id, amount, type: 'payment', method: 'cash', createdAt })
    await mk(1, new Date('2026-10-19T10:00:00Z'))
    await mk(2, new Date('2026-10-20T10:00:00Z'))
    await mk(3, new Date('2026-10-21T10:00:00Z'))
  })
  after(async () => { await stopTestDb() })
  const get = (qs = '') => request(app).get(`/api/admin/transactions${qs}`).set('Authorization', `Bearer ${adminToken}`)

  it('without a period it lists the newest; with from/to it returns only that period, whatever its age', async () => {
    expect((await get()).body.map((t) => t.amount)).to.deep.equal([3, 2, 1])
    const day = await get('?from=2026-10-20T00:00:00.000Z&to=2026-10-20T23:59:59.999Z')
    expect(day.body.map((t) => t.amount)).to.deep.equal([2])
    const open = await get('?from=2026-10-20T00:00:00.000Z')
    expect(open.body.map((t) => t.amount)).to.deep.equal([3, 2])
    expect((await get('?from=garbage')).body).to.have.length(3) // an unreadable date is ignored, not a 500
  })
})

describe('A blank card put in the reader with no purchase waiting is registered (balance 0)', function () {
  this.timeout(30000)
  let tenant, coin, Card, Peripheral, written
  const saved = {}
  before(async () => {
    await startTestDb(); await clearTestDb()
    ;({ tenant } = await seedTenantAndUsers())
    Card = (await import('../src/models/card.js')).default
    Peripheral = (await import('../src/models/peripheral.js')).default
    coin = (await import('../src/services/coinMachine.js')).default
    await Peripheral.create({ tenantId: tenant._id, name: 'Leitor', type: 'rfid_reader', enabled: true })
    saved.tenantId = coin.tenantId; saved.write = coin.middleware.writeCardData
    coin.tenantId = tenant._id
    written = []
    coin.middleware.writeCardData = async (_id, data) => { written.push(data); return { ok: true } }
  })
  after(async () => { coin.tenantId = saved.tenantId; coin.middleware.writeCardData = saved.write; coin.recentlyBlanked = new Map(); await stopTestDb() })
  beforeEach(() => { written.length = 0 })

  it('creates the card under the chip id with ZERO balance, writes it, and activates it', async () => {
    const r = await coin.activatePendingCard('-385895493')
    expect(r.status).to.equal('active')
    const c = await Card.findOne({ tenantId: tenant._id, code: '-385895493' })
    expect(c).to.include({ balance: 0, status: 'active' })
    expect(c.metadata.autoRegistered.from).to.equal('blank-card-at-reader')
    expect(written).to.have.length(1)
    expect(written[0]).to.include({ code: '-385895493', balance: 0 })
  })

  it('a chip of a card we already know (data lost) gets its record written back, not a second card', async () => {
    await Card.create({ tenantId: tenant._id, code: 'KNOWN-1', balance: 4.2, status: 'active' })
    await coin.activatePendingCard('KNOWN-1')
    expect(await Card.countDocuments({ tenantId: tenant._id, code: 'KNOWN-1' })).to.equal(1)
    expect(written[0]).to.include({ code: 'KNOWN-1', balance: 4.2 })
  })

  it('a chip staff just wiped is NOT registered again by the reader echo', async () => {
    coin.recentlyBlanked = new Map([['WIPED-1', Date.now()]])
    const r = await coin.activatePendingCard('WIPED-1')
    expect(r).to.equal(null)
    expect(await Card.countDocuments({ tenantId: tenant._id, code: 'WIPED-1' })).to.equal(0)
    expect(written).to.have.length(0)
  })

  it('a purchase that is waiting still wins: the blank card goes to the purchase, no extra card', async () => {
    const pending = await Card.create({ tenantId: tenant._id, code: 'PURCHASE-1', balance: 5, status: 'pending_write' })
    await coin.activatePendingCard('CHIP-77')
    expect((await Card.findById(pending._id)).code).to.equal('CHIP-77')
    expect(await Card.countDocuments({ tenantId: tenant._id, code: 'CHIP-77' })).to.equal(1)
    expect(written[0]).to.include({ code: 'CHIP-77', balance: 5 })
  })

  it('a purchase left unwritten for more than 10 minutes is NOT given to whoever presents a blank card later', async () => {
    const old = await Card.create({ tenantId: tenant._id, code: 'PURCHASE-OLD', balance: 5, status: 'pending_write', createdAt: new Date(Date.now() - 12 * 60_000) })
    await coin.activatePendingCard('STRANGER-1')
    expect((await Card.findById(old._id)).code).to.equal('PURCHASE-OLD') // still waiting for its buyer (or the staff)
    expect((await Card.findById(old._id)).status).to.equal('pending_write')
    expect(await Card.findOne({ tenantId: tenant._id, code: 'STRANGER-1' })).to.include({ balance: 0 }) // registered empty
  })

  it('a card that registered itself and failed to be written is never taken for a purchase by another chip', async () => {
    await Card.create({ tenantId: tenant._id, code: 'SELF-1', balance: 0, status: 'pending_write', metadata: { autoRegistered: { at: new Date(), from: 'blank-card-at-reader' } } })
    await coin.activatePendingCard('OTHER-CHIP')
    expect(await Card.countDocuments({ tenantId: tenant._id, code: 'SELF-1' })).to.equal(1) // not renamed to the other chip
    expect(await Card.countDocuments({ tenantId: tenant._id, code: 'OTHER-CHIP' })).to.equal(1)
  })

  it('can be switched off (AUTO_REGISTER_BLANK_CARDS=false): nothing is created', async () => {
    process.env.AUTO_REGISTER_BLANK_CARDS = 'false'
    try {
      expect(await coin.activatePendingCard('OFF-1')).to.equal(null)
      expect(await Card.countDocuments({ tenantId: tenant._id, code: 'OFF-1' })).to.equal(0)
    } finally { delete process.env.AUTO_REGISTER_BLANK_CARDS }
  })
})

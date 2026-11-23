import { expect } from 'chai'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'

// The fixes of the 2026-11 audit (todo.md): each of these was a way to take money, balance or an account.
describe('Audit 2026-11', function () {
  this.timeout(20000)
  let app, tenant, admin, kiosk, Card, Machine, Sale, User, coinMachine, saved
  const kioskAuth = () => ({ Authorization: `ApiKey ${kiosk.apiKey}` })
  const adminAuth = () => ({ Authorization: `Bearer ${signToken(admin)}` })

  before(async () => {
    await startTestDb()
    app = await buildTestApp()
    Card = (await import('../src/models/card.js')).default
    Machine = (await import('../src/models/machine.js')).default
    Sale = (await import('../src/models/sale.js')).default
    User = (await import('../src/models/user.js')).default
    coinMachine = (await import('../src/services/coinMachine.js')).default
  })
  after(async () => { await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb()
    ;({ tenant, admin, kiosk } = await seedTenantAndUsers())
    saved = { running: coinMachine.running, tenantId: coinMachine.tenantId, start: coinMachine.startPaidMachine, client: { ...coinMachine.client.client } }
  })
  afterEach(() => {
    coinMachine.running = saved.running
    coinMachine.tenantId = saved.tenantId
    coinMachine.startPaidMachine = saved.start
    Object.assign(coinMachine.client.client, saved.client)
  })

  describe('password reset', () => {
    it('refuses a token that is a query operator, and the account keeps its password', async () => {
      await User.updateOne({ _id: admin._id }, { $set: { resetPasswordToken: 'a'.repeat(64), resetPasswordExpires: Date.now() + 3600e3 } })
      const r = await request(app).post('/api/auth/reset-password').send({ token: { $ne: null }, newPassword: 'hacked-password' })
      expect(r.status).to.equal(400)
      const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin1234' })
      expect(login.status).to.equal(200)
    })

    it('refuses any body or query carrying a $ operator', async () => {
      const r = await request(app).post('/api/auth/login').send({ username: { $gt: '' }, password: 'x' })
      expect(r.status).to.equal(400)
    })

    it('a session opened before the password changed stops working', async () => {
      const old = signToken(admin)
      await User.updateOne({ _id: admin._id }, { $set: { passwordChangedAt: new Date(Date.now() + 60e3) } })
      const r = await request(app).get('/api/admin/machines').set({ Authorization: `Bearer ${old}` })
      expect(r.status).to.equal(401)
    })
  })

  describe('old session routes are closed to the kiosk key', () => {
    for (const [path, body] of [
      ['/api/middleware/client/add-cash', { amount: 50 }],
      ['/api/middleware/client/load-card', { cardNumber: 'X' }],
      ['/api/middleware/client/reset', {}],
      ['/api/middleware/payment', { machineId: '1', amount: 1 }],
      ['/api/middleware/activate-machine', { machineId: '1' }],
      ['/api/pos/sale', { machineId: '1', items: [{}], amount: 1 }],
    ]) {
      it(path, async () => {
        const r = await request(app).post(path).set(kioskAuth()).send(body)
        expect(r.status).to.equal(403)
      })
    }
  })

  describe('paying with a card', () => {
    let machine, started
    beforeEach(async () => {
      machine = await Machine.create({ tenantId: tenant._id, name: 'Lavar 1', type: 'wash', weight: 10, number: 1, status: 'free' })
      await (await import('../src/models/price.js')).default.create({ tenantId: tenant._id, type: 'wash', weight: 10, cashPrice: 5, cardPrice: 5 })
      started = []
      coinMachine.startPaidMachine = async (id) => { started.push(String(id)) }
    })

    it('/pos/cards/:code/spend does not start the machine when the card cannot pay', async () => {
      await Card.create({ tenantId: tenant._id, code: 'C-POOR', balance: 1, status: 'active' })
      const r = await request(app).post('/api/pos/cards/C-POOR/spend').set(kioskAuth()).send({ machineId: String(machine._id), amount: 5, items: [{}] })
      expect(r.status).to.equal(400)
      expect(started).to.deep.equal([])
      expect((await Card.findOne({ code: 'C-POOR' })).balance).to.equal(1)
    })

    it('/pos/cards/:code/spend gives the money back when the machine does not start', async () => {
      await Card.create({ tenantId: tenant._id, code: 'C-OK', balance: 10, status: 'active' })
      coinMachine.startPaidMachine = async () => { throw new Error('controller down') }
      const r = await request(app).post('/api/pos/cards/C-OK/spend').set(kioskAuth()).send({ machineId: String(machine._id), amount: 5, items: [{}] })
      expect(r.status).to.equal(502)
      expect((await Card.findOne({ code: 'C-OK' })).balance).to.equal(10)
      expect(await Sale.countDocuments({})).to.equal(0)
    })

    it('on the shop PC the card must be in the reader (both routes)', async () => {
      await Card.create({ tenantId: tenant._id, code: 'C-AWAY', balance: 10, status: 'active' })
      coinMachine.tenantId = tenant._id
      coinMachine.running = true
      Object.assign(coinMachine.client.client, { hasCard: false, cardNumber: null })
      const items = [{ _id: String(machine._id), name: 'Lavar 1', price: 5 }]
      const a = await request(app).post('/api/gateways/card/pay').set(kioskAuth()).send({ cardCode: 'C-AWAY', batchId: 'r1', items })
      expect(a.status).to.equal(409)
      expect(a.body.code).to.equal('card-not-in-reader')
      const b = await request(app).post('/api/pos/cards/C-AWAY/spend').set(kioskAuth()).send({ machineId: String(machine._id), amount: 5, items: [{}] })
      expect(b.status).to.equal(409)
      expect(started).to.deep.equal([])
      expect((await Card.findOne({ code: 'C-AWAY' })).balance).to.equal(10)

      Object.assign(coinMachine.client.client, { hasCard: true, cardNumber: 'C-AWAY' })
      const ok = await request(app).post('/api/gateways/card/pay').set(kioskAuth()).send({ cardCode: 'C-AWAY', batchId: 'r2', items })
      expect(ok.status, JSON.stringify(ok.body)).to.equal(200)
      expect(started).to.have.length(1)
    })
  })

  describe('refunds', () => {
    const refund = (id, body) => request(app).post(`/api/admin/transactions/${id}/refund`).set(adminAuth()).send({ reason: 'teste', ...body })

    it('refunding a recharge takes the balance off the card instead of adding it again', async () => {
      const card = await Card.create({ tenantId: tenant._id, code: 'C-RECH', balance: 10, status: 'active' })
      const sale = await Sale.create({ tenantId: tenant._id, amount: 10, method: 'cash', type: 'recharge', cardId: card._id, cardCode: card.code, items: [{}] })
      const r = await refund(sale._id, {})
      expect(r.status).to.equal(200)
      expect((await Card.findById(card._id)).balance).to.equal(0)
    })

    it('a recharge already spent is not refunded', async () => {
      const card = await Card.create({ tenantId: tenant._id, code: 'C-SPENT', balance: 2, status: 'active' })
      const sale = await Sale.create({ tenantId: tenant._id, amount: 10, method: 'cash', type: 'recharge', cardId: card._id, cardCode: card.code, items: [{}] })
      const r = await refund(sale._id, {})
      expect(r.status).to.equal(409)
      expect((await Card.findById(card._id)).balance).to.equal(2)
      expect((await Sale.findById(sale._id)).status).to.not.equal('refunded')
    })

    it('a part refund leaves the sale open for the rest, and never more than the sale', async () => {
      const sale = await Sale.create({ tenantId: tenant._id, amount: 5, method: 'cash', type: 'payment', items: [{}] })
      const a = await refund(sale._id, { amount: 2 })
      expect(a.status).to.equal(200)
      expect((await Sale.findById(sale._id)).status).to.not.equal('refunded')
      const tooMuch = await refund(sale._id, { amount: 4 })
      expect(tooMuch.status).to.equal(400)
      const b = await refund(sale._id, { amount: 3 })
      expect(b.status).to.equal(200)
      expect((await Sale.findById(sale._id)).status).to.equal('refunded')
      expect((await refund(sale._id, {})).status).to.equal(400)
    })
  })
  describe('a top-up paid with a note', () => {
    it('the sale says what went in and what came back as change, and a repeated request says the truth about the change', async () => {
      const AuditLog = (await import('../src/models/auditLog.js')).default
      coinMachine.running = true; coinMachine.tenantId = tenant._id
      const card = await Card.create({ tenantId: tenant._id, code: 'C-NOTE', balance: 1.6, status: 'active' })
      Object.assign(coinMachine.client.client, { balance: 10, hasCard: true, cardNumber: 'C-NOTE', balanceCard: 1.6 })
      const body = { items: [{ id: 'recharge-1', type: 'Recarga de Cartão', price: 5, amount: 5 }], inserted: 10, batchId: 'note-1', cardCode: card.code }
      const r = await request(app).post('/api/gateways/cash/pay').set(kioskAuth()).send(body)
      expect(r.status, JSON.stringify(r.body)).to.equal(200)
      const sale = await Sale.findOne({ batchId: 'note-1', type: 'recharge' })
      expect(sale.amount).to.equal(5)
      expect(sale.inserted).to.equal(10)
      expect(sale.change).to.equal(5)
      // no hopper in this test: the change was not paid, it is owed and written down
      expect(r.body.changeDispensed).to.equal(false)
      for (let i = 0; i < 20 && !(await AuditLog.exists({ action: 'cash.change.owed' })); i++) await new Promise((res) => setTimeout(res, 25))
      const again = await request(app).post('/api/gateways/cash/pay').set(kioskAuth()).send(body)
      expect(again.body.replayed).to.equal(true)
      expect(again.body.changeDispensed).to.equal(false)
      expect((await Card.findById(card._id)).balance).to.equal(6.6)
    })
  })

  describe('card top-up at the kiosk', () => {
    const topup = (code, body) => request(app).post(`/api/gateways/cards/${code}/topup`).set(kioskAuth()).send(body)
    beforeEach(() => { coinMachine.running = true; coinMachine.tenantId = tenant._id })

    it('a code that is not a card is refused and the cash stays in the session', async () => {
      coinMachine.client.client.balance = 10
      const r = await topup('NO-SUCH-CARD', { amount: 10, batchId: 'b-1' })
      expect(r.status).to.equal(404)
      expect(await Card.countDocuments({})).to.equal(0)
      expect(coinMachine.client.getState().balance).to.equal(10)
    })

    it('the same request sent twice loads the card once', async () => {
      await Card.create({ tenantId: tenant._id, code: 'C-TOP', balance: 0, status: 'active' })
      coinMachine.client.client.balance = 20
      const first = await topup('C-TOP', { amount: 10, batchId: 'b-2' })
      expect(first.status).to.equal(200)
      const again = await topup('C-TOP', { amount: 10, batchId: 'b-2' })
      expect(again.status).to.equal(200)
      expect(again.body.replayed).to.equal(true)
      expect((await Card.findOne({ code: 'C-TOP' })).balance).to.equal(10)
      expect(await Sale.countDocuments({ type: 'recharge' })).to.equal(1)
      expect(coinMachine.client.getState().balance).to.equal(10)
    })
  })

  describe('MB WAY paid and never delivered', () => {
    it('is closed as failed after a few minutes, never started again; a recent one is left alone', async () => {
      const MbwayPayment = (await import('../src/models/mbwayPayment.js')).default
      const { sweep } = await import('../src/services/mbway.js')
      const base = { tenantId: tenant._id, amount: 5, reference: 'R', expiresAt: new Date(Date.now() + 60e3), status: 'paid' }
      const old = await MbwayPayment.create({ ...base, identifier: 'old', paidAt: new Date(Date.now() - 10 * 60e3) })
      const fresh = await MbwayPayment.create({ ...base, identifier: 'fresh', paidAt: new Date() })
      await sweep()
      expect((await MbwayPayment.findById(old._id)).status).to.equal('start_failed')
      expect((await MbwayPayment.findById(fresh._id)).status).to.equal('paid')
    })
  })

  describe('the updater asks before restarting', () => {
    const busy = () => request(app).get('/api/pos/busy').set(kioskAuth())
    it('free when nothing is going on, busy with cash in the machine or an MB WAY payment open', async () => {
      const flows = await import('../src/services/flows.js')
      flows._reset() // flows open from earlier tests would make it busy (that is the new 'flow' reason, checked below)
      coinMachine.running = true
      coinMachine.client.client.balance = 0
      const free = await busy()
      expect(free.status).to.equal(200)
      expect(free.body.busy).to.equal(false)
      coinMachine.client.client.balance = 2
      expect((await busy()).body.reasons).to.include('cash')
      coinMachine.client.client.balance = 0
      const MbwayPayment = (await import('../src/models/mbwayPayment.js')).default
      await MbwayPayment.create({ tenantId: tenant._id, identifier: 'p', amount: 5, expiresAt: new Date(Date.now() + 60e3), status: 'pending' })
      expect((await busy()).body.reasons).to.deep.equal(['mbway'])
      await MbwayPayment.deleteMany({})
      // a customer's flow still open (it closes ~90 s after the last step): the updater waits for it
      flows.step(tenant._id, 'cash_inserted', 'Moeda de 2,00 € inserida', null, { inserted: 2 })
      expect((await busy()).body.reasons).to.deep.equal(['flow'])
      flows._reset()
    })
    it('is not for the public', async () => {
      expect((await request(app).get('/api/pos/busy')).status).to.be.oneOf([401, 403])
    })
  })

  describe('admin', () => {
    it('revenue counts cash and MB WAY; what is spent from a card was counted when it was loaded', async () => {
      const mk = (method, amount, type = 'payment') => Sale.create({ tenantId: tenant._id, amount, method, type, items: [{}] })
      await mk('cash', 10, 'recharge'); await mk('card', 4); await mk('mbway', 3); await mk('cash', 2)
      const r = await request(app).get('/api/admin/analytics/revenue').set(adminAuth())
      expect(r.status).to.equal(200)
      const sum = (k) => r.body.reduce((t, d) => t + d[k], 0)
      expect(sum('total')).to.equal(15)
      expect(sum('cash')).to.equal(12)
      expect(sum('mbway')).to.equal(3)
      expect(sum('card')).to.equal(4)
    })

    it('the link with the central server cannot be changed from the settings form', async () => {
      const r = await request(app).post('/api/admin/settings').set(adminAuth()).send({ key: 'sync.centralKey', value: 'x' })
      expect(r.status).to.equal(400)
      const obj = await request(app).post('/api/admin/settings').set(adminAuth()).send({ key: ['a'], value: 'x' })
      expect(obj.status).to.equal(400)
    })

    it('an id that is not an id answers 404, not 500', async () => {
      const r = await request(app).put('/api/admin/cards/not-an-id').set(adminAuth()).send({ balance: 1 })
      expect(r.status).to.equal(404)
    })

    it('a card balance must be a sane amount', async () => {
      const post = (balance) => request(app).post('/api/admin/cards').set(adminAuth()).send({ code: 'C-' + String(balance), balance })
      expect((await post(-5)).status).to.equal(400)
      expect((await post('abc')).status).to.equal(400)
      expect((await post(100000)).status).to.equal(400)
      expect((await post(12.5)).status).to.equal(200)
      const card = await Card.findOne({ code: 'C-12.5' })
      const put = (balance) => request(app).put(`/api/admin/cards/${card._id}`).set(adminAuth()).send({ balance })
      expect((await put(-1)).status).to.equal(400)
      expect((await Card.findById(card._id)).balance).to.equal(12.5)
    })
  })

  describe('a start the controller did not answer', () => {
    let AuditLog, Setting
    before(async () => { AuditLog = (await import('../src/models/auditLog.js')).default; Setting = (await import('../src/models/setting.js')).default })
    const actions = async () => (await AuditLog.find({ tenantId: tenant._id }).lean()).map((r) => r.action)
    let savedStatus
    beforeEach(() => { coinMachine.tenantId = tenant._id; savedStatus = coinMachine.lastStatusLogged; coinMachine.lastStatusLogged = new Map() })
    afterEach(() => { coinMachine.lastStatusLogged = savedStatus })

    it('is e-mailed only when nothing says the machine is running; Secar 10 is only written down', async () => {
      expect(await coinMachine.reportUnconfirmedStart({ machine: 'Secar 8', interface: '14', channel: '2' })).to.equal('alerted')
      expect(await coinMachine.reportUnconfirmedStart({ machine: 'Secar 10', interface: '15', channel: '2' })).to.equal('log-only')
      expect((await actions()).filter((x) => x === 'machine.start.unconfirmed')).to.have.length(2) // both are in the audit trail
    })

    it('the controller reporting the machine running settles it: nothing is reported', async () => {
      coinMachine.lastStatusLogged.set('Secar 8', JSON.stringify({ fault: false, occupied: true, doorLocked: false, doorClosed: true }))
      expect(await coinMachine.reportUnconfirmedStart({ machine: 'Secar 8', interface: '14', channel: '2' })).to.equal('running')
      expect(await actions()).to.include('machine.start.confirmed.late').and.to.not.include('machine.start.unconfirmed')
    })

    it('the list of log-only machines can be changed in the settings', async () => {
      await Setting.create({ tenantId: tenant._id, key: 'alerts.startUnconfirmed.logOnly', value: ['Secar 7'] })
      expect(await coinMachine.reportUnconfirmedStart({ machine: 'secar 7', interface: '16', channel: '1' })).to.equal('log-only')
      expect(await coinMachine.reportUnconfirmedStart({ machine: 'Secar 10', interface: '15', channel: '2' })).to.equal('alerted')
    })
  })

  describe('master cards open the staff area with no PIN', () => {
    const save = (value) => request(app).post('/api/admin/settings').set(adminAuth()).send({ key: 'staffCards', value })
    const tryPin = (pin) => request(app).post('/api/pos/admin/verify-pin').set(kioskAuth()).send({ pin })
    beforeEach(async () => { (await import('../src/routes/pos.js'))._resetPinGuards(); (await import('../src/services/staffCards.js'))._resetStaffTokens() })

    it('the list is cleaned on save; a card in the list gets a token that stands in for the PIN; wrong or foreign tokens do not', async () => {
      const r = await save({ enabled: true, cards: [{ code: ' 1234 ', label: 'Ana' }, { code: '1234' }, { code: '' }, { code: 'x'.repeat(100) }] })
      expect(r.status).to.equal(200)
      const Setting = (await import('../src/models/setting.js')).default
      const stored = (await Setting.findOne({ tenantId: tenant._id, key: 'staffCards' }).lean()).value
      expect(stored.cards.map((c) => c.code)).to.deep.equal(['1234', 'x'.repeat(64)])
      const { staffCardFor, issueStaffToken } = await import('../src/services/staffCards.js')
      expect((await staffCardFor(tenant._id, '1234')).label).to.equal('Ana')
      expect(await staffCardFor(tenant._id, '9999')).to.equal(null)
      expect((await tryPin('card:nope')).status).to.equal(401)
      const token = issueStaffToken(tenant._id)
      expect((await tryPin(`card:${token}`)).status).to.equal(200)
      const other = issueStaffToken('64b000000000000000000000') // a token of another shop is no good here
      expect((await tryPin(`card:${other}`)).status).to.equal(401)
    })

    it('writing a master card: a blank card gets a new code; a card with data is refused and nothing is written; a master card at the reader never reaches the customer path', async () => {
      const Peripheral = (await import('../src/models/peripheral.js')).default
      const reader = await Peripheral.create({ tenantId: tenant._id, name: 'rfid', type: 'rfid_reader', enabled: true, port: 'COM9' })
      const mw = coinMachine.middleware
      const keep = { last: mw.lastCard, write: mw.writeCardData, tid: coinMachine.tenantId }
      const writes = []
      coinMachine.tenantId = tenant._id
      mw.writeCardData = async (id, d) => { writes.push(d); return { success: true } }
      try {
        mw.lastCard = { cardId: '5550001111', name: 'Joana', nif: '', balance: '500' } // a customer's card
        let err = null
        await coinMachine.writeStaffCard().catch((e) => { err = e })
        expect(err?.message).to.match(/já tem dados/)
        expect(writes).to.have.length(0)
        mw.lastCard = { new: 'true', cardId: '', name: '', nif: '', balance: '' }
        const r = await coinMachine.writeStaffCard()
        expect(r.code).to.match(/^\d{10}$/)
        expect(writes).to.have.length(1)
        expect(writes[0]).to.include({ code: r.code, balance: 0 })
        // the card was written but is not in the list yet: it is still never registered as a customer card
        await coinMachine.handleCardRead({ cardNumber: r.code, card: { cardId: r.code, name: 'Cartão-mestre', balance: '0' } })
        expect(await Card.findOne({ tenantId: tenant._id, code: r.code })).to.equal(null)
        // in the list, at the reader: it gives out a token and loads nothing
        await save({ enabled: true, cards: [{ code: r.code, label: 'Ana' }] })
        let loaded = false
        const sub = coinMachine.client.setClientInfoByCard
        coinMachine.client.setClientInfoByCard = async () => { loaded = true; return false }
        coinMachine.staffCodesIgnored.clear()
        await coinMachine.handleCardRead({ cardNumber: r.code, card: { cardId: r.code, name: 'Cartão-mestre', balance: '0' } })
        coinMachine.client.setClientInfoByCard = sub
        expect(loaded).to.equal(false)
      } finally { mw.lastCard = keep.last; mw.writeCardData = keep.write; coinMachine.tenantId = keep.tid; await reader.deleteOne() }
    })

    it('with the PIN switched off a right PIN is refused, but a master card token still works', async () => {
      await request(app).post('/api/admin/settings').set(adminAuth()).send({ key: 'adminPin', value: '4821' })
      expect((await tryPin('4821')).status).to.equal(200)
      await request(app).post('/api/admin/settings').set(adminAuth()).send({ key: 'staffPinEnabled', value: false })
      const off = await tryPin('4821')
      expect(off.status).to.equal(403)
      expect(off.body.code).to.equal('pin-disabled')
      const { issueStaffToken } = await import('../src/services/staffCards.js')
      expect((await tryPin(`card:${issueStaffToken(tenant._id)}`)).status).to.equal(200)
    })

    it('erasing a master card: only the card that is in the reader and matches the code is wiped', async () => {
      const mw = coinMachine.middleware
      const keep = { last: mw.lastCard, blank: coinMachine.blankCardAtReader }
      let wiped = 0
      coinMachine.blankCardAtReader = async () => { wiped++; return { code: '1234567890' } }
      try {
        mw.lastCard = { cardId: '5550001111', name: 'Joana', balance: '500' } // somebody else's card
        let err = null
        await coinMachine.blankStaffCard('1234567890').catch((e) => { err = e })
        expect(err?.message).to.match(/não é este cartão-mestre/)
        expect(wiped).to.equal(0)
        mw.lastCard = { cardId: '1234567890', name: 'Cartão-mestre', balance: '0' }
        await coinMachine.blankStaffCard('1234567890')
        expect(wiped).to.equal(1)
      } finally { mw.lastCard = keep.last; coinMachine.blankCardAtReader = keep.blank }
    })

    it('switched off, no card is a master card', async () => {
      await save({ enabled: false, cards: [{ code: '1234', label: 'Ana' }] })
      const { staffCardFor } = await import('../src/services/staffCards.js')
      expect(await staffCardFor(tenant._id, '1234')).to.equal(null)
    })
  })

  describe('the staff PIN is renewed every Monday', () => {
    let Setting
    const setPin = (value) => request(app).post('/api/admin/settings').set(adminAuth()).send({ key: 'adminPin', value })
    const tryPin = (pin) => request(app).post('/api/pos/admin/verify-pin').set(kioskAuth()).send({ pin })
    const madeDaysAgo = (d) => Setting.updateOne({ tenantId: tenant._id, key: 'adminPin.setAt' }, { $set: { value: new Date(Date.now() - d * 24 * 3600e3).toISOString() } })
    before(async () => { Setting = (await import('../src/models/setting.js')).default })
    beforeEach(async () => { (await import('../src/routes/pos.js'))._resetPinGuards() }) // the PIN attempts limit is per kiosk key

    it('a new PIN works, and once a Monday has passed the kiosk answers that it has expired', async () => {
      expect((await setPin('4821')).status).to.equal(200)
      expect((await tryPin('4821')).status).to.equal(200)
      await madeDaysAgo(8) // a week ago and a day: a Monday has gone by whatever the day today is
      const old = await tryPin('4821')
      expect(old.status).to.equal(410)
      expect(old.body.code).to.equal('pin-expired')
      expect((await tryPin('0000')).status).to.equal(401) // a wrong PIN is still just wrong
      const info = await request(app).get('/api/admin/settings/adminPin').set(adminAuth())
      expect(info.body.expired).to.equal(true)
      expect(info.body.value).to.equal(null)
    })

    it('the new PIN must be a different one, and it starts a new week', async () => {
      await setPin('4821')
      await madeDaysAgo(8)
      expect((await setPin('4821')).status).to.equal(400)
      expect((await tryPin('4821')).status).to.equal(410)
      expect((await setPin('7733')).status).to.equal(200)
      expect((await tryPin('7733')).status).to.equal(200)
      const info = await request(app).get('/api/admin/settings/adminPin').set(adminAuth())
      expect(info.body.expired).to.equal(false)
      expect(info.body.daysLeft).to.be.within(1, 7) // until the coming Monday
    })

    it('the date cannot be pushed forward by hand, and a PIN from before this rule gets its week at start-up', async () => {
      expect((await request(app).post('/api/admin/settings').set(adminAuth()).send({ key: 'adminPin.setAt', value: new Date().toISOString() })).status).to.equal(400)
      const { hashPin, datePins } = await import('../src/services/staffPin.js')
      await Setting.create({ tenantId: tenant._id, key: 'adminPin', value: await hashPin('1234') })
      expect((await tryPin('1234')).status).to.equal(200) // no date yet: not locked out
      expect(await datePins(Setting)).to.equal(1)
      expect(await datePins(Setting)).to.equal(0)
      expect((await tryPin('1234')).status).to.equal(200)
    })
  })

  describe('the staff menu cannot hand the shop to another server', () => {
    it('only the server already in use, or one listed on the PC, is accepted', async () => {
      const { applyCentralKey, serverAllowed } = await import('../src/services/centralKey.js')
      const env = { url: process.env.SYNC_SERVER_URL, allowed: process.env.SYNC_SERVER_ALLOWED }
      try {
        process.env.SYNC_SERVER_URL = 'https://freshbubbles.pt/api'
        delete process.env.SYNC_SERVER_ALLOWED
        let asked = 0
        const fetchImpl = async () => { asked++; return { ok: true, status: 200, json: async () => ({}) } }
        const r = await applyCentralKey('a'.repeat(24), { serverUrl: 'https://evil.example/api', fetchImpl, envFile: '/nonexistent/.env' })
        expect(r.ok).to.equal(false)
        expect(r.code).to.equal('server-not-allowed')
        expect(asked).to.equal(0) // the key is never sent to the unknown server
        expect(serverAllowed('https://freshbubbles.pt/api/')).to.equal(true)
        process.env.SYNC_SERVER_ALLOWED = 'novo.example, outro.example'
        expect(serverAllowed('https://novo.example/api')).to.equal(true)
        expect(serverAllowed('https://evil.example/api')).to.equal(false)
      } finally {
        if (env.url === undefined) delete process.env.SYNC_SERVER_URL; else process.env.SYNC_SERVER_URL = env.url
        if (env.allowed === undefined) delete process.env.SYNC_SERVER_ALLOWED; else process.env.SYNC_SERVER_ALLOWED = env.allowed
      }
    })
  })

  describe('what the central server accepts from a shop', () => {
    it('a remote command is handed out once, reported only by the post it was given to, and closed if never reported', async () => {
      const SyncCommand = (await import('../src/models/syncCommand.js')).default
      const cmd = await SyncCommand.create({ tenantId: tenant._id, kioskId: kiosk._id, type: 'sync_now' })
      const notSent = await request(app).post(`/api/sync/commands/${cmd._id}/done`).set(kioskAuth()).send({})
      expect(notSent.status).to.equal(409) // never handed out: cannot be reported as done
      const [a, b] = await Promise.all([request(app).get('/api/sync/commands').set(kioskAuth()), request(app).get('/api/sync/commands').set(kioskAuth())])
      expect(a.body.length + b.body.length).to.equal(1)
      // ten minutes with no report: closed, saying nobody knows whether it ran
      await SyncCommand.updateOne({ _id: cmd._id }, { $set: { claimedAt: new Date(Date.now() - 11 * 60e3) } })
      await request(app).get('/api/sync/commands').set(kioskAuth())
      const closed = await SyncCommand.findById(cmd._id)
      expect(closed.status).to.equal('failed')
      expect(closed.error).to.match(/não respondeu/)
      // the report arrives late after all: it counts
      expect((await request(app).post(`/api/sync/commands/${cmd._id}/done`).set(kioskAuth()).send({})).status).to.equal(200)
      expect((await SyncCommand.findById(cmd._id)).status).to.equal('done')
      expect((await request(app).post(`/api/sync/commands/${cmd._id}/fail`).set(kioskAuth()).send({ error: 'x' })).status).to.equal(409)
    })

    it('a card cannot be created from a shop with an absurd balance', async () => {
      const r = await request(app).post('/api/sync/push/card').set(kioskAuth()).send({ create: true, code: 'BIG', balance: 50000 })
      expect(r.status).to.equal(400)
      expect(await Card.countDocuments({ code: 'BIG' })).to.equal(0)
    })

    it('the money routes of the kiosk do not exist on the central server', async () => {
      const saved = process.env.ENABLE_COIN_MACHINE
      process.env.ENABLE_COIN_MACHINE = 'false'
      try {
        for (const [path, body] of [['/api/gateways/cash/pay', { items: [], inserted: 50 }], ['/api/gateways/card/pay', {}], ['/api/pos/card/purchase', { inserted: 50 }], ['/api/pos/recharge', {}], ['/api/pos/cards/X/spend', {}], ['/api/gateways/cards/X/topup', { amount: 5 }]]) {
          const r = await request(app).post(path).set(kioskAuth()).send(body)
          expect(r.status, path).to.equal(403)
          expect(r.body.code).to.equal('shop-only')
        }
      } finally { if (saved === undefined) delete process.env.ENABLE_COIN_MACHINE; else process.env.ENABLE_COIN_MACHINE = saved }
    })

    it('a machine status outside the known ones is refused', async () => {
      const m = await Machine.create({ tenantId: tenant._id, name: 'L1', type: 'wash', status: 'free' })
      const push = (status) => request(app).post('/api/sync/push/machine').set(kioskAuth()).send({ id: String(m._id), status })
      expect((await push('hacked')).status).to.equal(400)
      expect((await Machine.findById(m._id)).status).to.equal('free')
      expect((await push('offline')).status).to.equal(200)
    })
  })
})

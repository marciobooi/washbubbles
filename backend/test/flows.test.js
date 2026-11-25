import { expect } from 'chai'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'
import * as flows from '../src/services/flows.js'
import Flow from '../src/models/flow.js'
import Tenant from '../src/models/tenant.js'
import modelEvents from '../src/services/modelEvents.js'

const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms))

describe('Flows: every customer action as one log with its steps', function () {
  this.timeout(30000)
  let app, tenant, adminTok, kioskKey
  before(async () => {
    await startTestDb(); await clearTestDb(); app = await buildTestApp()
    const s = await seedTenantAndUsers(); tenant = s.tenant; adminTok = signToken(s.admin); kioskKey = 'test-kiosk-api-key'
    await Flow.init()
  })
  after(async () => { await stopTestDb() })
  beforeEach(async () => { flows._reset(); await Flow.deleteMany({}) })
  const t = () => tenant._id

  it('puts selecting, money, payment, impulse and change into ONE flow with a readable title', async () => {
    flows.step(t(), 'cash_in', 'Nota de 10,00 € inserida (total 10,00 €)', { value: 10 }, { inserted: 10 })
    flows.step(t(), 'pay_requested', 'Pedido de pagamento em dinheiro: Lavar 4', null, { method: 'cash', machine: 'Lavar 4' })
    flows.step(t(), 'impulse_sent', 'Impulso enviado à Lavar 4', null, { machine: 'Lavar 4' })
    flows.step(t(), 'sale_recorded', 'Venda registada · 7,00 € · dinheiro', null, { amount: 7, method: 'cash' })
    flows.step(t(), 'change_paid', 'Troco de 3,00 € pago', null, { change: 3 })
    await wait()
    const rows = await Flow.find({ tenantId: t() }).lean()
    expect(rows).to.have.length(1)
    const f = rows[0]
    expect(f.kind).to.equal('machine_payment')
    expect(f.title).to.equal('Lavar 4 · pago com dinheiro · 7,00 € · troco 3,00 €')
    expect(f).to.include({ inserted: 10, amount: 7, change: 3, method: 'cash', status: 'open' })
    expect(f.machines).to.deep.equal(['Lavar 4'])
    expect(f.steps.map((s) => s.type)).to.deep.equal(['cash_in', 'pay_requested', 'impulse_sent', 'sale_recorded', 'change_paid'])
  })

  // what happened on 2026-11-12 10:51: 2 EUR in, the same payment asked for twice, and a dryer impulse the staff had started earlier arrived meanwhile
  it('a payment asked for twice is counted once, and the impulse of a machine the customer did not ask for stays out of the header', async () => {
    // two requests in flight at once (the second sent while the first was still waiting), answered one after the other
    const ask = () => {
      const req = { tenantId: t(), body: { items: [{ name: 'Secar 7' }], inserted: 2 } }
      const res = { statusCode: 200, json() { return res } }
      flows.flowRoute('Pedido de pagamento em dinheiro', { method: 'cash' })(req, res, () => {})
      return res
    }
    flows.step(t(), 'cash_in', 'Moeda de 2,00 € inserida (total 2,00 €)', { value: 2 }, { inserted: 2 })
    const sale = [{ _id: 'S1', amount: 2, method: 'cash' }]
    const first = ask()
    flows.step(t(), 'impulse_sent', 'Impulso 2 enviado à Secar 8', { machine: 'Secar 8' }, { machine: 'Secar 8' }) // the staff's earlier start
    const second = ask()
    flows.step(t(), 'impulse_sent', 'Impulso enviado à Secar 7', { machine: 'Secar 7' }, { machine: 'Secar 7' })
    first.json({ sales: sale })
    second.json({ sales: sale }) // the same sale again
    await wait()
    const f = (await Flow.find({ tenantId: t() }).lean())[0]
    expect(f.amount).to.equal(2) // not 4
    expect(f.machines).to.deep.equal(['Secar 7'])
    expect(f.title).to.contain('Secar 7').and.to.not.contain('Secar 8')
    const types = f.steps.map((s) => s.type)
    expect(types.filter((x) => x === 'sale_recorded')).to.have.length(1)
    expect(types).to.include('sale_replayed')
    const foreign = f.steps.find((s) => s.data?.foreign)
    expect(foreign.text).to.contain('Secar 8')
  })

  it('a new customer after a paid flow starts a NEW flow; an idle flow is closed and announced for the uplink', async () => {
    flows.step(t(), 'cash_in', 'Nota', null, { inserted: 5 })
    flows.step(t(), 'sale_recorded', 'Venda', null, { amount: 5, method: 'cash' })
    flows.step(t(), 'cash_in', 'Nota do cliente seguinte', null, { inserted: 20 })
    await wait()
    expect(await Flow.countDocuments({ tenantId: t() })).to.equal(2)
    const closed = []
    const on = (e) => closed.push(e.flowId); modelEvents.on('flow:closed', on)
    await flows.closeIdle({ all: true }); await wait()
    modelEvents.off('flow:closed', on)
    expect(closed).to.have.length(1)
    const done = await Flow.find({ tenantId: t(), status: { $ne: 'open' } }).lean()
    expect(done.length).to.be.greaterThan(0)
    expect(done[0].endedAt).to.be.instanceOf(Date)
  })

  it('a cash card recharge is a recharge (not a machine), and a refusal the customer corrected is not a problem', async () => {
    flows.step(t(), 'cash_in', 'Nota de 10,00 € inserida', null, { inserted: 10 })
    flows.step(t(), 'pay_requested', 'Pedido de pagamento em dinheiro: Recarga de Cartão - 12€', { items: ['Recarga de Cartão - 12€'] }, { method: 'cash' })
    flows.step(t(), 'pay_refused', 'Recusado: Insert the card in the reader to recharge it', null, { ok: false })
    flows.step(t(), 'card_in', 'Cartão •••5456 no leitor', null, { cardCode: '5456' })
    flows.step(t(), 'pay_requested', 'Pedido de pagamento em dinheiro: Recarga de Cartão - 12€', { items: ['Recarga de Cartão - 12€'] }, { method: 'cash' })
    flows.step(t(), 'sale_recorded', 'Venda registada · 12,00 € · dinheiro', null, { amount: 12, method: 'cash' })
    await flows.closeIdle({ all: true }); await wait()
    const [row] = await Flow.find({ tenantId: t() }).lean()
    expect(row.kind).to.equal('recharge')
    expect(row.title).to.match(/^Carregamento de cartão •••5456/)
    expect(row.status).to.equal('done')
  })

  it('a failed step marks the flow as having a problem (status "problem" when it closes)', async () => {
    flows.step(t(), 'cash_in', 'Nota', null, { inserted: 5 })
    flows.step(t(), 'change_short', 'Troco incompleto: pago 0 €, faltam 3 €', null, { ok: false })
    await flows.closeIdle({ all: true }); await wait()
    const f = await Flow.findOne({ tenantId: t() }).lean()
    expect(f.status).to.equal('problem')
    expect(f.problems).to.equal(1)
  })

  it('the pay routes record what was asked and why it was refused', async () => {
    const r = await request(app).post('/api/gateways/cash/pay').set('Authorization', `ApiKey ${kioskKey}`).send({ items: [{ name: 'Lavar 1', _id: 'x' }], inserted: 0 })
    expect(r.status).to.be.at.least(400)
    await wait(150)
    const f = await Flow.findOne({ tenantId: t() }).lean()
    const types = f.steps.map((s) => s.type)
    expect(types).to.include('pay_requested')
    expect(types).to.include('pay_refused')
    expect(f.steps.find((s) => s.type === 'pay_refused').ok).to.equal(false)
  })

  describe('central server: receiving and showing the shop\'s flows', () => {
    const payload = (id, extra = {}) => ({ flowId: id, kind: 'machine_payment', status: 'done', startedAt: new Date().toISOString(), lastAt: new Date().toISOString(), endedAt: new Date().toISOString(), title: 'Lavar 4 · pago com dinheiro · 7,00 €', machines: ['Lavar 4'], method: 'cash', amount: 7, inserted: 10, change: 3, problems: 0, steps: [{ at: new Date().toISOString(), type: 'cash_in', text: 'Nota de 10 €', ok: true }], ...extra })

    it('stores a pushed flow once (idempotent) and only for the key\'s own shop', async () => {
      const push = (b) => request(app).post('/api/sync/push/flow').set('Authorization', `ApiKey ${kioskKey}`).send(b)
      expect((await push(payload('f-1'))).status).to.equal(200)
      expect((await push(payload('f-1', { title: 'changed' }))).status).to.equal(200)
      expect(await Flow.countDocuments({})).to.equal(1)
      expect((await Flow.findOne({})).tenantId.toString()).to.equal(t().toString())
      expect((await push({ ...payload('f-2'), tenantId: '000000000000000000000000' })).status).to.equal(200)
      expect((await Flow.findOne({ flowId: 'f-2' })).tenantId.toString()).to.equal(t().toString()) // the body cannot name another shop
      expect((await push({ kind: 'x' })).status).to.equal(400)
      expect((await request(app).post('/api/sync/push/flow').send(payload('f-3'))).status).to.equal(401)
    })

    it('lists with filters, opens one with its steps, and never shows another shop\'s flows', async () => {
      const other = await Tenant.create({ name: 'Other', slug: 'other-flows' })
      await Flow.create({ tenantId: other._id, flowId: 'o-1', kind: 'recharge', startedAt: new Date(), lastAt: new Date(), title: 'Carregamento secreto', steps: [] })
      const push = (b) => request(app).post('/api/sync/push/flow').set('Authorization', `ApiKey ${kioskKey}`).send(b)
      await push(payload('a-1'))
      await push(payload('a-2', { kind: 'recharge', title: 'Carregamento de cartão •••1234 · 10,00 €', machines: [], cardCode: '1234', method: 'mbway' }))
      const bad = (type) => ({ at: new Date().toISOString(), type, text: type, ok: false })
      await push(payload('a-4', { status: 'problem', title: 'MB WAY cancelado', method: 'mbway', machines: [], steps: [bad('mbway_cancelled'), bad('cash_rejected')] }))
      await push(payload('a-3', { status: 'problem', steps: [bad('start_failed'), bad('change_short')], title: 'Secar 9 · pago com cartão', machines: ['Secar 9'], method: 'card' }))
      const get = (qs = '') => request(app).get(`/api/admin/flows${qs}`).set('Authorization', `Bearer ${adminTok}`)
      const all = await get()
      expect(all.body.total).to.equal(4)
      expect(all.body.flows.map((f) => f.flowId)).to.not.include('o-1')
      expect(all.body.flows[0]).to.not.have.property('steps') // the list is light
      expect((await get('?kind=recharge')).body.flows.map((f) => f.flowId)).to.deep.equal(['a-2'])
      expect((await get('?problems=1')).body.flows.map((f) => f.flowId)).to.deep.equal(['a-3']) // warnings alone are not problems
      const warnOnly = all.body.flows.find((f) => f.flowId === 'a-4')
      expect([warnOnly.problems, warnOnly.warnings, warnOnly.status]).to.deep.equal([0, 2, 'done'])
      expect(all.body.flows.find((f) => f.flowId === 'a-3').problems).to.equal(2)
      expect((await get('?machine=Secar%209')).body.total).to.equal(1)
      expect((await get('?method=mbway')).body.total).to.equal(2)
      expect((await get('?q=1234')).body.total).to.equal(1)
      expect((await get('?q=secreto')).body.total).to.equal(0)
      expect((await get('?from=2999-01-01')).body.total).to.equal(0)
      const one = await request(app).get('/api/admin/flows/a-1').set('Authorization', `Bearer ${adminTok}`)
      expect(one.status).to.equal(200)
      expect(one.body.steps).to.have.length(1)
      expect((await request(app).get('/api/admin/flows/o-1').set('Authorization', `Bearer ${adminTok}`)).status).to.equal(404)
    })
  })

  it('an open flow makes the updater wait (hasRecentOpen), and closeAll closes it normally and saves it', async () => {
    flows._reset()
    expect(flows.hasRecentOpen()).to.equal(false)
    flows.step(t(), 'cash_inserted', 'Moeda de 2,00 € inserida', null, { inserted: 2 })
    expect(flows.hasRecentOpen()).to.equal(true)
    await flows.closeAll()
    expect(flows.hasRecentOpen()).to.equal(false)
    const Flow = (await import('../src/models/flow.js')).default
    const saved = await Flow.findOne({ tenantId: t() }).lean()
    expect(saved.status).to.not.equal('open')
    expect(saved.status).to.not.equal('interrupted')
  })
})

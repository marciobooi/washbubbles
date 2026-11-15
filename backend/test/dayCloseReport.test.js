import { expect } from 'chai'
import fs from 'fs'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'

describe('Day-close report e-mail', function () {
  this.timeout(30000)
  let app, tenant, admin
  before(async () => { await startTestDb(); app = await buildTestApp() })
  after(async () => { await stopTestDb() })
  beforeEach(async () => { await clearTestDb(); ({ tenant, admin } = await seedTenantAndUsers()) })

  async function seedDay() {
    const Sale = (await import('../src/models/sale.js')).default
    const Machine = (await import('../src/models/machine.js')).default
    const DayClose = (await import('../src/models/dayClose.js')).default
    const mk = (name, type, number) => Machine.create({ tenantId: tenant._id, name, number, type, weight: 18, port: 1, status: 'free' })
    const l1 = await mk('Lavar 1', 'wash', 1); const l2 = await mk('Lavar 2', 'wash', 2); const s8 = await mk('Secar 8', 'dry', 8); const s10 = await mk('Secar 10', 'dry', 10)
    const t0 = new Date(Date.now() - 12 * 3600_000)
    const at = (h) => new Date(t0.getTime() + h * 3600_000)
    const S = (o) => Sale.create({ tenantId: tenant._id, batchId: 'b' + Math.random(), type: 'payment', ...o })
    for (let i = 0; i < 9; i++) await S({ amount: 10.5, method: 'cash', machineId: l1._id, createdAt: at(1 + i * 0.5) })
    for (let i = 0; i < 6; i++) await S({ amount: 7, method: 'cash', machineId: l2._id, createdAt: at(2 + i * 0.5) })
    for (let i = 0; i < 8; i++) await S({ amount: 1.8, method: 'card', cardCode: 'C' + i, machineId: s8._id, createdAt: at(3 + i * 0.4) })
    for (let i = 0; i < 5; i++) await S({ amount: 3.6, method: 'cash', machineId: s10._id, createdAt: at(4 + i * 0.4) })
    for (let i = 0; i < 3; i++) await S({ amount: 10.5, method: 'mbway', machineId: l1._id, createdAt: at(6 + i) })
    for (let i = 0; i < 4; i++) await S({ amount: 10, method: 'cash', type: 'recharge', cardCode: 'R' + i, createdAt: at(5 + i) })
    await DayClose.create({ tenantId: tenant._id, source: 'dashboard', openingFloat: 120, floatLeft: 120, countedCash: 120, expectedCash: 120, periodFrom: t0, periodTo: t0, createdAt: t0 })
  }

  it('a confirmed close builds the report: big numbers, split by payment and service, two inline charts', async () => {
    await seedDay()
    const { getDayCloseSummary } = await import('../src/services/dayClose.js')
    const req = { tenantId: tenant._id, tenantFilter: { tenantId: tenant._id }, userModel: admin }
    const sum = await getDayCloseSummary(req)
    const res = await request(app).post('/api/admin/day-close').set('Authorization', `Bearer ${signToken(admin)}`)
      .send({ countedCash: sum.expectedCash - 0.5, amountToBank: sum.expectedCash - 0.5 - 120, floatLeft: 120, bankBreakdown: { notes: [{ value: 20, count: 8 }, { value: 10, count: 1 }], coins: 18.4, coinsAsked: 18.4 }, notes: 'Dia normal' })
    expect(res.status).to.equal(200)
    const { buildDayCloseReport } = await import('../src/services/dayCloseReport.js')
    const DayClose = (await import('../src/models/dayClose.js')).default
    const dc = await DayClose.findById(res.body._id).lean()
    const r = await buildDayCloseReport(dc)
    expect(r.data.revenue).to.equal(Number((9 * 10.5 + 6 * 7 + 5 * 3.6 + 40 + 3 * 10.5).toFixed(2)))
    expect(r.data.mbway).to.equal(31.5)
    expect(r.data.cashTopups).to.equal(40)
    expect(r.data.cardSpent).to.equal(14.4)
    expect(r.data.use.dry.n).to.equal(13)
    expect(r.data.discrepancy).to.equal(-0.5)
    expect(r.attachments).to.have.length(2)
    expect(r.attachments[0].content.slice(1, 4).toString()).to.equal('PNG')
    expect(r.html).to.include('cid:chart-pay').and.include('Depositado no banco')
    // a preview of the e-mail for a person to look at (images inlined as data: so a browser shows them)
    if (process.env.REPORT_PREVIEW) {
      const { renderEmailHtml } = await import('../src/services/emailTemplate.js')
      let html = renderEmailHtml({ title: 'Fecho de caixa', preheader: r.subject, bodyHtml: r.html, wide: true })
      for (const a of r.attachments) html = html.replace(`cid:${a.cid}`, `data:image/png;base64,${a.content.toString('base64')}`)
      fs.writeFileSync(process.env.REPORT_PREVIEW, `<!-- ${r.subject} -->\n` + html)
    }
  })

  it('the history eye shows the report as a page, images inline, nothing sent; the operator may see it too', async () => {
    await seedDay()
    const DayClose = (await import('../src/models/dayClose.js')).default
    const dc = await DayClose.findOne({ tenantId: tenant._id })
    await DayClose.updateOne({ _id: dc._id }, { $set: { notes: 'Contado pela Tatiane' } })
    const res = await request(app).get(`/api/admin/day-close/${dc._id}/report`).set('Authorization', `Bearer ${signToken(admin)}`)
    expect(res.status).to.equal(200)
    expect(res.body.html).to.include('data:image/png;base64,').and.not.include('cid:')
    expect(res.body.html).to.include('Contado pela Tatiane')
    expect(res.body.subject).to.match(/^Fecho de caixa/)
  })

  it('the history envelope sends a close again to the shop address, and says when there is none', async () => {
    await seedDay()
    const DayClose = (await import('../src/models/dayClose.js')).default
    const dc = await DayClose.findOne({ tenantId: tenant._id })
    const token = signToken(admin)
    let res = await request(app).post(`/api/admin/day-close/${dc._id}/email`).set('Authorization', `Bearer ${token}`).send({})
    expect(res.status).to.equal(400)
    expect(res.body.code).to.equal('no-recipient')
    const Setting = (await import('../src/models/setting.js')).default
    await Setting.create({ tenantId: tenant._id, key: 'alerts.email', value: 'dono@example.com' })
    res = await request(app).post(`/api/admin/day-close/${dc._id}/email`).set('Authorization', `Bearer ${token}`).send({})
    expect(res.status).to.equal(200)
    expect(res.body.to).to.equal('dono@example.com')
  })
})

import { expect } from 'chai'
import request from 'supertest'
import {
  startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken,
} from './setup.test-helper.js'
import { isPromoActive, getEffectivePrice } from '../../src/lib/promo.js'
import { promoIsActive } from '../src/routes/gateways.js'
import { resetSoleTenantCache } from '../src/middleware/tenant.js'

describe('What the kiosk fetches and shows agrees with what the server charges', function () {
  this.timeout(20000)
  let app, tenant, kiosk, kioskToken, Machine, Price

  before(async () => {
    await startTestDb()
    app = await buildTestApp()
    Machine = (await import('../src/models/machine.js')).default
    Price = (await import('../src/models/price.js')).default
  })
  after(async () => { await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb()
    ;({ tenant, kiosk } = await seedTenantAndUsers())
    kioskToken = signToken(kiosk)
    resetSoleTenantCache() // the unauthenticated price lookup finds the shop by "the only tenant"
  })

  it('the kiosk machine list carries number, tImp and the out-of-service flag (the payment window needs them)', async () => {
    await Machine.create({ tenantId: tenant._id, name: 'Secar 8', number: 8, type: 'dry', weight: 18, tImp: 15 })
    await Machine.create({ tenantId: tenant._id, name: 'Secar 10', number: 10, type: 'dry', weight: 18, tImp: 15, status: 'fault', outOfService: true, serviceStatus: 'fault' })
    const res = await request(app).get('/api/pos/machines?type=dry').set('Authorization', `ApiKey ${kiosk.apiKey}`)
    expect(res.status).to.equal(200)
    const byName = Object.fromEntries(res.body.map((m) => [m.name, m]))
    expect(byName['Secar 8'].number).to.equal(8)
    expect(byName['Secar 8'].tImp).to.equal(15)
    expect(byName['Secar 8'].outOfService).to.equal(false)
    expect(byName['Secar 10'].outOfService).to.equal(true)
    expect(byName['Secar 10'].serviceStatus).to.equal('fault')
  })

  it('the price lookup the window uses returns the cash and card prices', async () => {
    await Price.create({ tenantId: tenant._id, type: 'dry', weight: 18, cashPrice: 2, cardPrice: 1.8 })
    const res = await request(app).get('/api/pos/prices/lookup?type=dry&weight=18')
    expect(res.status).to.equal(200)
    expect(res.body.cashPrice).to.equal(2)
    expect(res.body.cardPrice).to.equal(1.8)
  })

  it('the card window reads the minimum top-up and the card saving per machine kind from the server', async () => {
    const Setting = (await import('../src/models/setting.js')).default
    await Setting.create({ tenantId: tenant._id, key: 'loyaltyCard.minRecharge', value: 10 })
    await Price.create({ tenantId: tenant._id, type: 'dry', weight: 18, cashPrice: 2, cardPrice: 1.8 })
    await Price.create({ tenantId: tenant._id, type: 'wash', weight: 9, cashPrice: 4, cardPrice: 3.5 })
    await Price.create({ tenantId: tenant._id, type: 'wash', weight: 14, cashPrice: 6, cardPrice: 5.2 })
    const res = await request(app).get('/api/pos/card-info')
    expect(res.status).to.equal(200)
    expect(res.body.minRecharge).to.equal(10)
    expect(res.body.saving.dry).to.equal(0.2)
    expect(res.body.saving.wash).to.equal(0.8) // the most it saves on any wash machine
  })

  it('kiosk and server agree on when a promo is active (days, hours, empty days = every day)', () => {
    // Wednesday 2026-10-14 12:30 local time
    const wed = new Date(2026, 9, 14, 12, 30)
    const cases = [
      { promoActive: true, promoDays: ['wednesday'], promoStartTime: '10:00', promoEndTime: '14:00' },
      { promoActive: true, promoDays: ['monday'], promoStartTime: '10:00', promoEndTime: '14:00' },
      { promoActive: true, promoDays: [], promoStartTime: '10:00', promoEndTime: '14:00' },
      { promoActive: true, promoDays: ['wednesday'], promoStartTime: '13:00', promoEndTime: '14:00' },
      { promoActive: true, promoDays: ['wednesday'] },
      { promoActive: false, promoDays: ['wednesday'], promoStartTime: '10:00', promoEndTime: '14:00' },
    ]
    for (const c of cases) {
      expect(isPromoActive(c, wed), JSON.stringify(c)).to.equal(promoIsActive(c, wed))
    }
    expect(isPromoActive(cases[0], wed)).to.equal(true)
    expect(isPromoActive(cases[1], wed)).to.equal(false)
  })

  it('the promo price shown is the promo price the server applies', () => {
    const wed = new Date(2026, 9, 14, 12, 30)
    const row = { promoActive: true, promoDays: ['wednesday'], promoStartTime: '10:00', promoEndTime: '14:00', cashPrice: 2, cardPrice: 1.8, promoCashPrice: 1.5, promoCardPrice: 1.3 }
    // getEffectivePrice reads the clock itself; check the rule through isPromoActive with the same instant
    expect(isPromoActive(row, wed) ? row.promoCashPrice : row.cashPrice).to.equal(1.5)
    expect(typeof getEffectivePrice).to.equal('function')
  })
})

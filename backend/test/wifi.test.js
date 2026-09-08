import { expect } from 'chai'
import request from 'supertest'
import {
  startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken
} from './setup.test-helper.js'
import unifiVoucher from '../src/services/unifiVoucher.js'

describe('WiFi voucher route', () => {
  let app, kioskApiKey, adminToken, tenantId

  // Mint the admin token directly (signToken) rather than a real HTTP login —
  // /api/auth/login is rate-limited to 6/15min per IP, process-wide (the
  // limiter is a module singleton, shared across every test file in the same
  // `npm test` run). A beforeEach login here once exhausted it against other
  // files' own logins and every "enable the feature" call below then silently
  // failed as an unauthenticated 401, which is why these tests only ever saw
  // the disabled (403) response — not a bug in the route itself.
  before(async () => {
    await startTestDb()
    await clearTestDb()
    app = await buildTestApp()
    const seeded = await seedTenantAndUsers()
    kioskApiKey = seeded.kiosk.apiKey
    tenantId = seeded.tenant._id
    adminToken = signToken(seeded.admin)
  })
  after(stopTestDb)
  beforeEach(() => {
    // Stub the controller call — these tests exercise the route's own
    // validation and idempotency, not a real UniFi controller.
    unifiVoucher.createVoucher = async () => 'ABCD-1234'
  })

  async function enableWifi(durationMinutes = 60) {
    await request(app).post('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key: 'wifi.enabled', value: true })
    await request(app).post('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key: 'wifi.durationMinutes', value: durationMinutes })
  }

  it('rejects a request with no batchId', async () => {
    const res = await request(app).post('/api/wifi/voucher')
      .set('Authorization', `ApiKey ${kioskApiKey}`)
      .send({})
    expect(res.status).to.equal(400)
  })

  it('refuses to issue a voucher when the feature is disabled', async () => {
    const res = await request(app).post('/api/wifi/voucher')
      .set('Authorization', `ApiKey ${kioskApiKey}`)
      .send({ batchId: 'batch-1' })
    expect(res.status).to.equal(403)
  })

  it('refuses a batch with no matching machine sale, even when enabled', async () => {
    await enableWifi()
    const res = await request(app).post('/api/wifi/voucher')
      .set('Authorization', `ApiKey ${kioskApiKey}`)
      .send({ batchId: 'no-such-batch' })
    expect(res.status).to.equal(404)
  })

  it('issues a voucher for a batch with a real machine payment, and is idempotent on retry', async () => {
    await enableWifi(45)
    const Sale = (await import('../src/models/sale.js')).default
    const Machine = (await import('../src/models/machine.js')).default
    const machine = await Machine.create({ tenantId, name: 'M1', status: 'free' })
    await Sale.create({ tenantId, machineId: machine._id, amount: 3.5, type: 'payment', method: 'cash', batchId: 'batch-real' })

    let calls = 0
    unifiVoucher.createVoucher = async () => { calls++; return 'WIFI-CODE' }

    const first = await request(app).post('/api/wifi/voucher')
      .set('Authorization', `ApiKey ${kioskApiKey}`)
      .send({ batchId: 'batch-real' })
    expect(first.status).to.equal(200)
    expect(first.body.code).to.equal('WIFI-CODE')
    expect(first.body.durationMinutes).to.equal(45)

    const second = await request(app).post('/api/wifi/voucher')
      .set('Authorization', `ApiKey ${kioskApiKey}`)
      .send({ batchId: 'batch-real' })
    expect(second.status).to.equal(200)
    expect(second.body.code).to.equal('WIFI-CODE')
    // The controller must only be asked once per batch — a retry reuses the stored voucher.
    expect(calls).to.equal(1)
  })
})

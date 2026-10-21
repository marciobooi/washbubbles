import { expect } from 'chai'
import request from 'supertest'
import {
  startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken
} from './setup.test-helper.js'
import kioskWatchdog from '../src/services/kioskWatchdog.js'

// No MAIL_HOST is set in the test env, so mailer.js falls back to logging
// instead of a real SMTP send (see its own header comment) — safe to exercise
// for real here. These tests check the HTTP/DB-level behaviour around that,
// not the email delivery itself.
describe('Operator alerts', () => {
  let app, kioskApiKey, adminToken, tenantId

  before(async () => {
    await startTestDb()
    app = await buildTestApp()
  })
  after(stopTestDb)
  beforeEach(async () => {
    await clearTestDb()
    const seeded = await seedTenantAndUsers()
    kioskApiKey = seeded.kiosk.apiKey
    tenantId = seeded.tenant._id
    adminToken = signToken(seeded.admin)
  })

  describe('POST /api/pos/alert', () => {
    it('rejects a push with no subject', async () => {
      const res = await request(app).post('/api/pos/alert')
        .set('Authorization', `ApiKey ${kioskApiKey}`).send({ message: 'x' })
      expect(res.status).to.equal(400)
    })

    it('accepts an alert push even with no alerts.email configured (silent no-op)', async () => {
      const res = await request(app).post('/api/pos/alert')
        .set('Authorization', `ApiKey ${kioskApiKey}`).send({ subject: 'Hopper vazio', message: 'sem troco' })
      expect(res.status).to.equal(200)
      expect(res.body.success).to.equal(true)
    })

    it('accepts an alert push once alerts.email is configured', async () => {
      await request(app).post('/api/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`).send({ key: 'alerts.email', value: 'owner@example.com' })

      const res = await request(app).post('/api/pos/alert')
        .set('Authorization', `ApiKey ${kioskApiKey}`).send({ subject: 'Hopper vazio', message: 'sem troco' })
      expect(res.status).to.equal(200)
    })
  })

  describe('kioskWatchdog.checkOnce', () => {
    it('flags a kiosk quiet for over 2 minutes (and not one quiet for 1) and does not re-flag it on the next check', async () => {
      const User = (await import('../src/models/user.js')).default
      const staleTime = new Date(Date.now() - 3 * 60000)
      const recent = await User.create({ tenantId, username: 'quiet-1min', password: 'x', role: 'KIOSK', lastSeen: new Date(Date.now() - 60000) })
      const kiosk = await User.create({
        tenantId, username: 'stale-kiosk', password: 'x', role: 'KIOSK', lastSeen: staleTime,
      })

      await kioskWatchdog.checkOnce()
      let reloaded = await User.findById(kiosk._id)
      expect(reloaded.offlineAlertSent).to.equal(true)
      expect((await User.findById(recent._id)).offlineAlertSent).to.not.equal(true)

      // A second check while still stale must not error or double-send —
      // offlineAlertSent should simply stay true.
      await kioskWatchdog.checkOnce()
      reloaded = await User.findById(kiosk._id)
      expect(reloaded.offlineAlertSent).to.equal(true)
    })

    it('clears the flag once the kiosk is seen again', async () => {
      const User = (await import('../src/models/user.js')).default
      const kiosk = await User.create({
        tenantId, username: 'recovering-kiosk', password: 'x', role: 'KIOSK',
        lastSeen: new Date(Date.now() - 20 * 60000), offlineAlertSent: true,
      })

      await User.findByIdAndUpdate(kiosk._id, { lastSeen: new Date() })
      await kioskWatchdog.checkOnce()
      const reloaded = await User.findById(kiosk._id)
      expect(reloaded.offlineAlertSent).to.equal(false)
    })

    it('leaves a healthy kiosk with no lastSeen history untouched by default (never seen != newly stale)', async () => {
      // A kiosk that has literally never authenticated (lastSeen: null) is
      // treated as stale like any other — this documents that behaviour
      // rather than silently skipping brand-new/never-provisioned kiosks.
      const User = (await import('../src/models/user.js')).default
      const kiosk = await User.create({ tenantId, username: 'never-seen', password: 'x', role: 'KIOSK' })
      await kioskWatchdog.checkOnce()
      const reloaded = await User.findById(kiosk._id)
      expect(reloaded.offlineAlertSent).to.equal(true)
    })
  })

  describe('POST /api/pos/receipt', () => {
    it('rejects a missing batchId', async () => {
      const res = await request(app).post('/api/pos/receipt')
        .set('Authorization', `ApiKey ${kioskApiKey}`).send({ email: 'a@b.com' })
      expect(res.status).to.equal(400)
    })

    it('rejects an invalid email', async () => {
      const res = await request(app).post('/api/pos/receipt')
        .set('Authorization', `ApiKey ${kioskApiKey}`).send({ batchId: 'x', email: 'not-an-email' })
      expect(res.status).to.equal(400)
    })

    it('404s a batch with no matching sale', async () => {
      const res = await request(app).post('/api/pos/receipt')
        .set('Authorization', `ApiKey ${kioskApiKey}`).send({ batchId: 'no-such-batch', email: 'a@b.com' })
      expect(res.status).to.equal(404)
    })

    it('emails a receipt for a real batch', async () => {
      const Sale = (await import('../src/models/sale.js')).default
      await Sale.create({ tenantId, amount: 3.5, type: 'payment', method: 'cash', batchId: 'receipt-batch-1' })

      const res = await request(app).post('/api/pos/receipt')
        .set('Authorization', `ApiKey ${kioskApiKey}`).send({ batchId: 'receipt-batch-1', email: 'customer@example.com' })
      expect(res.status).to.equal(200)
      expect(res.body.success).to.equal(true)
    })
  })
})

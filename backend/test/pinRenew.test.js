import { expect } from 'chai'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers } from './setup.test-helper.js'
import { pinAge, hashPin, PIN_SET_AT } from '../src/services/staffPin.js'

describe('The staff PIN expires every Monday (shop time)', () => {
  it('a PIN made on any day ends at the next Monday 00:00, winter and summer', () => {
    const t = (made, now) => pinAge(made, new Date(now))
    expect(t('2026-11-10T10:41:28Z', '2026-11-13T12:00:00Z')).to.include({ expiresAt: '2026-11-16T00:00:00.000Z', expired: false, daysLeft: 3 })
    expect(t('2026-11-10T10:41:28Z', '2026-11-16T00:00:01Z').expired).to.equal(true)
    expect(t('2026-11-15T22:00:00Z', '2026-11-16T00:00:01Z').expired).to.equal(true)          // made on a Sunday evening: gone at midnight
    expect(t('2026-11-16T09:00:00Z', '2026-11-22T23:59:00Z')).to.include({ expired: false, daysLeft: 1 }) // made on a Monday: lasts the week
    expect(t('2026-07-08T09:00:00Z', '2026-07-12T22:59:00Z').expired).to.equal(false)          // summer: Monday 00:00 in Lisbon is 23:00 UTC
    expect(t('2026-07-08T09:00:00Z', '2026-07-12T23:00:01Z').expired).to.equal(true)
    expect(pinAge(null).expired).to.equal(false) // no date yet: not locked out
  })
})

describe('A new PIN made at the kiosk when the old one has expired', function () {
  this.timeout(20000)
  let app, tenant, kiosk, admin, Setting, link
  const kioskAuth = () => ({ Authorization: `ApiKey ${kiosk.apiKey}` })
  const val = async (key) => (await Setting.findOne({ tenantId: tenant._id, key }).lean())?.value
  const expire = () => Setting.updateOne({ tenantId: tenant._id, key: PIN_SET_AT }, { $set: { value: new Date(Date.now() - 9 * 24 * 3600e3).toISOString() } })
  let sent, centralAnswer, saved
  before(async () => { await startTestDb(); app = await buildTestApp(); Setting = (await import('../src/models/setting.js')).default; link = await import('../src/services/pinRenewClient.js') })
  after(async () => { link._setFetch(null); await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb(); ;({ tenant, kiosk, admin } = await seedTenantAndUsers())
    ;(await import('../src/routes/pos.js'))._resetPinGuards()
    await Setting.create({ tenantId: tenant._id, key: 'adminPin', value: await hashPin('4821') })
    await Setting.create({ tenantId: tenant._id, key: PIN_SET_AT, value: new Date().toISOString() })
    saved = { u: process.env.SYNC_SERVER_URL, k: process.env.SYNC_API_KEY }
    delete process.env.SYNC_SERVER_URL; delete process.env.SYNC_API_KEY
    sent = []; centralAnswer = { status: 200, body: { ok: true } }
    link._setFetch(async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: centralAnswer.status < 400, status: centralAnswer.status, json: async () => centralAnswer.body } })
  })
  afterEach(() => { process.env.SYNC_SERVER_URL = saved.u; process.env.SYNC_API_KEY = saved.k; if (saved.u === undefined) delete process.env.SYNC_SERVER_URL; if (saved.k === undefined) delete process.env.SYNC_API_KEY })
  const reset = async () => (await import('../src/routes/pos.js'))._resetPinGuards() // the attempts limit is per kiosk key
  const renew = (b) => request(app).post('/api/pos/admin/renew-pin').set(kioskAuth()).send(b)
  const tryPin = (pin) => request(app).post('/api/pos/admin/verify-pin').set(kioskAuth()).send({ pin })

  it('a valid PIN is not changed here, a wrong old PIN is refused, and the two new PINs must match and be 4 to 8 digits', async () => {
    expect((await renew({ pin: '4821', newPin: '7733', confirm: '7733' })).body.code).to.equal('pin-valid') // still valid: the admin changes it
    await expire()
    expect((await renew({ pin: '0000', newPin: '7733', confirm: '7733' })).status).to.equal(401)
    await reset()
    expect((await renew({ pin: '4821', newPin: '7733', confirm: '7734' })).body.code).to.equal('mismatch')
    expect((await renew({ pin: '4821', newPin: '12', confirm: '12' })).body.code).to.equal('bad-format')
    expect((await renew({ pin: '4821', newPin: '4821', confirm: '4821' })).body.code).to.equal('same-pin')
    await reset()
    expect((await tryPin('4821')).status).to.equal(410) // nothing changed
  })

  it('on a standalone PC the new PIN is written here and works at once; the old one no longer does', async () => {
    await expire()
    expect((await tryPin('4821')).status).to.equal(410)
    expect((await renew({ pin: '4821', newPin: '7733', confirm: '7733' })).status).to.equal(200)
    expect((await tryPin('7733')).status).to.equal(200)
    expect((await tryPin('4821')).status).to.equal(401)
    expect(sent).to.have.length(0) // no central server configured: nothing relayed
    expect(await val('adminPin')).to.not.equal('7733') // stored as a hash
  })

  it('with a central server it is asked first: refused or unreachable changes nothing, accepted writes it here', async () => {
    process.env.SYNC_SERVER_URL = 'https://central.test/api'; process.env.SYNC_API_KEY = 'k'
    await expire()
    centralAnswer = { status: 401, body: { error: 'PIN atual inválido', code: 'invalid-pin' } }
    expect((await renew({ pin: '4821', newPin: '7733', confirm: '7733' })).status).to.equal(401)
    expect((await tryPin('4821')).status).to.equal(410)
    await reset()
    link._setFetch(async () => { throw new Error('down') })
    const off = await renew({ pin: '4821', newPin: '7733', confirm: '7733' })
    expect(off.status).to.equal(502); expect(off.body.code).to.equal('offline')
    expect((await tryPin('4821')).status).to.equal(410)
    await reset()
    link._setFetch(async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ ok: true }) } })
    expect((await renew({ pin: '4821', newPin: '7733', confirm: '7733' })).status).to.equal(200)
    expect(sent[0].url).to.equal('https://central.test/api/sync/pin-renew')
    expect(sent[0].body).to.deep.equal({ oldPin: '4821', newPin: '7733' })
    expect((await tryPin('7733')).status).to.equal(200)
  })

  it('the central server makes the same checks and writes the new PIN, which goes down to the shops', async () => {
    const post = (b) => request(app).post('/api/sync/pin-renew').set(kioskAuth()).send(b)
    expect((await post({ oldPin: '4821', newPin: '7733' })).status).to.equal(409) // not expired
    await expire()
    expect((await post({ oldPin: '0000', newPin: '7733' })).status).to.equal(401)
    expect((await post({ oldPin: '4821', newPin: 'abc' })).status).to.equal(400)
    expect((await post({ oldPin: '4821', newPin: '7733' })).status).to.equal(200)
    const { verifyPin } = await import('../src/services/staffPin.js')
    expect(await verifyPin(await val('adminPin'), '7733')).to.equal(true)
    expect(pinAge(await val(PIN_SET_AT)).expired).to.equal(false)
    const AuditLog = (await import('../src/models/auditLog.js')).default
    expect(await AuditLog.countDocuments({ action: 'staff_pin.renewed_at_kiosk' })).to.equal(1)
  })

  it('a new PIN may not repeat any of the last 3 PINs used; the 4th one back is free again', async () => {
    const post = (oldPin, newPin) => request(app).post('/api/sync/pin-renew').set(kioskAuth()).send({ oldPin, newPin })
    const step = async (oldPin, newPin) => { await expire(); return post(oldPin, newPin) }
    expect((await step('4821', '4821')).status).to.equal(400)       // the current one
    expect((await step('4821', '1111')).status).to.equal(200)       // 4821 -> 1111
    expect((await step('1111', '4821')).status).to.equal(400)       // 4821 was one of the last 3
    expect((await step('1111', '2222')).status).to.equal(200)       // 1111 -> 2222
    expect((await step('2222', '4821')).status).to.equal(400)       // current 2222, before it 1111 and 4821: still among the last 3
    expect((await step('2222', '1111')).status).to.equal(400)
    expect((await step('2222', '3333')).status).to.equal(200)       // 2222 -> 3333: the last 3 are now 3333, 2222, 1111
    expect((await step('3333', '1111')).status).to.equal(400)
    expect((await step('3333', '4821')).status).to.equal(200)       // 4821 is the 4th one back: allowed again
    const hist = await val('adminPin.history')
    expect(hist.length).to.be.at.most(5)
    expect(JSON.stringify(hist)).to.not.contain('4821')             // only hashes
  })

  it('the admin can change the PIN at any time, even to one used before; the kiosk still counts it among the last 3', async () => {
    const { signToken } = await import('./setup.test-helper.js')
    const a = admin
    const set = (value) => request(app).post('/api/admin/settings').set('Authorization', `Bearer ${signToken(a)}`).send({ key: 'adminPin', value })
    expect((await set('4821')).status).to.equal(400)   // the same as the current one: nothing to change
    expect((await set('1111')).status).to.equal(200)   // 4821 -> 1111, valid, not expired: allowed at any time
    expect((await set('4821')).status).to.equal(200)   // back to a previous one: the admin is not held to the last-3 rule
    await expire()
    // at the kiosk, 1111 (changed from by the admin) is one of the last 3, so it cannot be chosen again
    const r = await request(app).post('/api/sync/pin-renew').set(kioskAuth()).send({ oldPin: '4821', newPin: '1111' })
    expect(r.status).to.equal(400)
  })
})

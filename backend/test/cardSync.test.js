import { expect } from 'chai'
import EventEmitter from 'events'
import mongoose from 'mongoose'
import { startTestDb, stopTestDb } from './setup.test-helper.js'
import Tenant from '../src/models/tenant.js'
import Card from '../src/models/card.js'
import AuditLog from '../src/models/auditLog.js'
import { CardSync, decideReconcile } from '../src/services/cardSync.js'
import { debitCard, creditCard } from '../src/services/cardBalance.js'
import { Middleware } from '../src/services/middleware.js'

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

/** Stand-in middleware: a card "at the reader" that records what is written to it. */
function fakeMiddleware() {
  const mw = new EventEmitter()
  mw.lowLevel = {}          // controller mode
  mw.present = null         // {cardId, ...} currently at the reader
  mw.writes = []
  mw.failNext = 0           // simulate N hardware write failures
  mw.writeCardBalance = async (card) => {
    if (mw.failNext > 0) { mw.failNext--; throw new Error('controller write failed') }
    if (!mw.present) return { written: false, reason: 'card-not-present' }
    if (mw.present.cardId !== card.code) return { written: false, reason: 'different-card-present' }
    mw.writes.push({ code: card.code, balance: card.balance })
    mw.emit('card-written', { cardData: { code: card.code, balance: card.balance } })
    return { written: true }
  }
  return mw
}

/** The controller's `card-inserted` payload: balance is in CENTS, everything a string. */
const onCard = (cardId, euros, extra = {}) => ({
  cardId, balance: String(Math.round(euros * 100)), name: '', nif: '', admin: 'false', ...extra,
})

describe('Card balances are always whole cents', function () {
  before(async () => { await startTestDb() })
  after(async () => { await stopTestDb() })
  let tenant
  beforeEach(async () => { tenant = await Tenant.create({ name: 'Cents', slug: `cents-${Date.now()}-${Math.random()}` }) })
  afterEach(async () => { await Card.deleteMany({ tenantId: tenant._id }); await Tenant.deleteOne({ _id: tenant._id }) })

  it('debits and credits leave no float dust (4.7 - 0.1, 3.2 - 1.8, 0.1 + 0.2)', async () => {
    const c = await Card.create({ tenantId: tenant._id, code: 'R1', balance: 4.7 })
    expect((await debitCard(Card, { _id: c._id }, 0.1)).balance).to.equal(4.6)
    await Card.updateOne({ _id: c._id }, { $set: { balance: 3.2 } })
    expect((await debitCard(Card, { _id: c._id }, 1.8)).balance).to.equal(1.4)
    await Card.updateOne({ _id: c._id }, { $set: { balance: 0.1 } })
    expect((await creditCard(Card, { _id: c._id }, 0.2)).balance).to.equal(0.3)
  })

  it('a balance set with float dust is stored as whole cents; the start-up clean-up rounds older values and leaves exact ones', async () => {
    const c = await Card.create({ tenantId: tenant._id, code: 'R2', balance: 4.700000000000001 })
    expect((await Card.findById(c._id).lean()).balance).to.equal(4.7)
    // an old record written before the rule: force the dust in with a raw write
    await Card.collection.updateOne({ _id: c._id }, { $set: { balance: 1.4000000000000001 } })
    await Card.create({ tenantId: tenant._id, code: 'R3', balance: 2.5 })
    const { normalizeBalances } = await import('../src/services/cardBalance.js')
    expect(await normalizeBalances(Card)).to.be.at.least(1)
    expect((await Card.findById(c._id).lean()).balance).to.equal(1.4)
    expect(await normalizeBalances(Card)).to.equal(0) // idempotent
  })
})

describe('decideReconcile', () => {
  const d = (db, card, synced) => decideReconcile({ dbBalance: db, cardBalance: card, syncedBalance: synced })

  it('equal balances are in sync, whatever the marker says', () => {
    expect(d(5, 5, 5).action).to.equal('in-sync')
    expect(d(5, 5, null).action).to.equal('in-sync')
    expect(d(5, 5, 9).action).to.equal('in-sync')
  })

  it('card equals the last confirmed value => the card missed our update => database wins', () => {
    expect(d(7.5, 10, 10)).to.deep.equal({ action: 'db-wins', balance: 7.5 })
  })

  it('database equals the last confirmed value => card changed elsewhere / DB restored => card wins', () => {
    expect(d(10, 6, 10)).to.deep.equal({ action: 'card-wins', balance: 6 })
    expect(d(10, 30, 10)).to.deep.equal({ action: 'card-wins', balance: 30 }) // top-ups made after the backup
  })

  it('anything ambiguous keeps the LOWER figure — never creates money', () => {
    expect(d(8, 6, 10)).to.deep.equal({ action: 'conflict', balance: 6 })
    expect(d(4, 10, null)).to.deep.equal({ action: 'conflict', balance: 4 })
    expect(d(10, 4, null)).to.deep.equal({ action: 'conflict', balance: 4 })
  })

  it('compares in cents, so float drift is not a mismatch', () => {
    expect(d(0.1 + 0.2, 0.3, 0.3).action).to.equal('in-sync')
  })
})

describe('CardSync (real Mongo test DB, fake controller)', function () {
  let tenant, mw, sync
  const cardIn = (code) => Card.findOne({ tenantId: tenant._id, code }).lean()
  const auditActions = async () => (await AuditLog.find({ tenantId: tenant._id }).lean()).map((a) => a.action)

  before(async () => {
    await startTestDb()
    tenant = await Tenant.create({ name: 'CardSync Test', slug: `cardsync-${Date.now()}` })
  })
  after(async () => {
    await Card.deleteMany({ tenantId: tenant._id })
    await AuditLog.deleteMany({ tenantId: tenant._id })
    await Tenant.deleteOne({ _id: tenant._id })
    await stopTestDb()
  })
  beforeEach(() => {
    mw = fakeMiddleware()
    sync = new CardSync({ middleware: mw, tenantId: tenant._id, retryMs: 5, retries: 2 })
    sync.start()
  })
  afterEach(async () => {
    sync.stop()
    await Card.deleteMany({ tenantId: tenant._id })
    await AuditLog.deleteMany({ tenantId: tenant._id })
  })

  describe('adoption (card meets an unknown database)', () => {
    it('creates the record from what the card carries: id, balance, name, tax id, owner', async () => {
      const r = await sync.reconcile(onCard('LEG-1', 12.5, { name: 'Ana', nif: '123456789', ownerId: 'OWN-7' }))
      expect(r).to.include({ status: 'adopted', balance: 12.5 })
      const c = await cardIn('LEG-1')
      expect(c).to.include({ balance: 12.5, name: 'Ana', contribuinte: '123456789', status: 'active', cardSyncedBalance: 12.5 })
      expect(c.metadata.adopted).to.include({ from: 'controller-card', ownerId: 'OWN-7' })
      expect(await auditActions()).to.include('card.adopt')
    })

    it('a chip that reports 79.9999999999980 cents (old software float dust) is adopted as exactly EUR 0.80', async () => {
      const r = await sync.reconcile({ cardId: 'LEG-DUST', balance: '79.9999999999980', name: '', nif: '', admin: '', ownerId: 'OWN-9' })
      expect(r.balance).to.equal(0.8)
      expect((await cardIn('LEG-DUST')).balance).to.equal(0.8)
      const r2 = await sync.reconcile({ cardId: 'LEG-DUST2', balance: '309.999999999724', name: '', nif: '', admin: 'false' })
      expect(r2.balance).to.equal(3.1)
    })

    it('does not write back to the card it just adopted (no echo loop)', async () => {
      mw.present = { cardId: 'LEG-2' }
      await sync.reconcile(onCard('LEG-2', 5))
      await tick(80)
      expect(mw.writes).to.have.length(0)
    })

    it('two simultaneous adopters create exactly one card, without error', async () => {
      const [a, b] = await Promise.all([sync.reconcile(onCard('LEG-3', 9)), sync.reconcile(onCard('LEG-3', 9))])
      expect(await Card.countDocuments({ tenantId: tenant._id, code: 'LEG-3' })).to.equal(1)
      expect([a.status, b.status].sort()).to.include('adopted')
    })

    it('refuses a balance above the ceiling and audits it', async () => {
      const r = await sync.reconcile(onCard('BIG-1', 1500))
      expect(r.status).to.equal('invalid')
      expect(await cardIn('BIG-1')).to.equal(null)
      expect(await auditActions()).to.include('card.reject')
    })

    it('refuses unreadable data, skips admin cards and blank cards', async () => {
      expect((await sync.reconcile({ cardId: 'X', balance: 'garbage' })).status).to.equal('invalid')
      expect((await sync.reconcile({ cardId: 'X', balance: '-5' })).status).to.equal('invalid')
      expect(await sync.reconcile(onCard('ADM', 0, { admin: 'true' }))).to.include({ status: 'skipped', reason: 'admin-card' })
      expect(await sync.reconcile({ cardId: '', balance: '0' })).to.include({ status: 'skipped', reason: 'blank-card' })
      expect(await Card.countDocuments({ tenantId: tenant._id })).to.equal(0)
    })

    it('does nothing at all when not in controller mode', async () => {
      delete mw.lowLevel
      expect(await sync.reconcile(onCard('OFF-1', 5))).to.deep.equal({ status: 'disabled' })
      expect(await cardIn('OFF-1')).to.equal(null)
    })
  })

  describe('reconciliation (card meets a known database)', () => {
    const seed = (fields) => Card.collection.insertOne({
      tenantId: tenant._id, status: 'active', name: '', email: '', phone: '', contribuinte: '',
      bonus: 0, appliedDeltas: [], createdAt: new Date(), updatedAt: new Date(), ...fields,
    })

    it('in sync: no write, marker recorded', async () => {
      mw.present = { cardId: 'K1' }
      await seed({ code: 'K1', balance: 8 })
      const r = await sync.reconcile(onCard('K1', 8))
      expect(r.status).to.equal('in-sync')
      expect(mw.writes).to.have.length(0)
      expect((await cardIn('K1')).cardSyncedBalance).to.equal(8)
    })

    it('DB is newer (card missed a change, e.g. cash moved on after removal): card is brought up to date', async () => {
      mw.present = { cardId: 'K2' }
      await seed({ code: 'K2', balance: 7.5, cardSyncedBalance: 10 })
      const r = await sync.reconcile(onCard('K2', 10))
      expect(r.status).to.equal('db-wins')
      expect(mw.writes).to.deep.equal([{ code: 'K2', balance: 7.5 }])
      expect((await cardIn('K2')).cardSyncedBalance).to.equal(7.5)
    })

    it('card is newer (database restored from an old backup): database takes the card\'s balance', async () => {
      mw.present = { cardId: 'K3' }
      await seed({ code: 'K3', balance: 10, cardSyncedBalance: 10 })
      const r = await sync.reconcile(onCard('K3', 6))
      expect(r).to.include({ status: 'card-wins', balance: 6 })
      const c = await cardIn('K3')
      expect(c).to.include({ balance: 6, cardSyncedBalance: 6 })
      expect(mw.writes).to.have.length(0)
      expect(await auditActions()).to.include('card.reconcile')
    })

    it('conflict, database lower: keeps the lower figure and writes it to the card', async () => {
      mw.present = { cardId: 'K4' }
      await seed({ code: 'K4', balance: 4, cardSyncedBalance: null })
      const r = await sync.reconcile(onCard('K4', 10))
      expect(r).to.include({ status: 'conflict', balance: 4 })
      expect(mw.writes).to.deep.equal([{ code: 'K4', balance: 4 }])
      expect((await cardIn('K4')).balance).to.equal(4)
    })

    it('conflict, card lower: keeps the card\'s figure, no write needed', async () => {
      mw.present = { cardId: 'K5' }
      await seed({ code: 'K5', balance: 8, cardSyncedBalance: 10 })
      const r = await sync.reconcile(onCard('K5', 6))
      expect(r).to.include({ status: 'conflict', balance: 6 })
      expect(mw.writes).to.have.length(0)
      expect(await cardIn('K5')).to.include({ balance: 6, cardSyncedBalance: 6 })
    })

    it('uses the card\'s name and tax id to FILL BLANKS, never to overwrite', async () => {
      await seed({ code: 'K6', balance: 3, cardSyncedBalance: 3, name: '', contribuinte: '999' })
      await sync.reconcile(onCard('K6', 3, { name: 'Ana', nif: '111' }))
      expect(await cardIn('K6')).to.include({ name: 'Ana', contribuinte: '999' }) // name filled, existing tax id kept
      await seed({ code: 'K7', balance: 3, cardSyncedBalance: 3, name: 'Rui' })
      await sync.reconcile(onCard('K7', 3, { name: 'Somebody Else' }))
      expect((await cardIn('K7')).name).to.equal('Rui')
    })

    it('leaves pending_write and blocked cards alone', async () => {
      mw.present = { cardId: 'K8' }
      await seed({ code: 'K8', balance: 5, status: 'pending_write' })
      expect((await sync.reconcile(onCard('K8', 99))).status).to.equal('skipped')
      expect((await cardIn('K8')).balance).to.equal(5)
    })
  })

  describe('every database change is written to the card (Mongoose hook)', () => {
    async function adopted(code, euros) {
      await sync.reconcile(onCard(code, euros))
      mw.writes.length = 0
    }
    const nextUpdate = () => new Promise((res) => sync.once('card-updated', res))

    it('a spend writes the new balance onto the card at the reader', async () => {
      await adopted('H1', 10)
      mw.present = { cardId: 'H1' }
      const done = nextUpdate()
      await debitCard(Card, { tenantId: tenant._id, code: 'H1' }, 2.5)
      await done
      expect(mw.writes).to.deep.equal([{ code: 'H1', balance: 7.5 }])
      expect((await cardIn('H1')).cardSyncedBalance).to.equal(7.5)
    })

    it('a top-up does too', async () => {
      await adopted('H2', 1)
      mw.present = { cardId: 'H2' }
      const done = nextUpdate()
      await creditCard(Card, { tenantId: tenant._id, code: 'H2' }, 20)
      await done
      expect(mw.writes.at(-1)).to.deep.equal({ code: 'H2', balance: 21 })
    })

    it('a burst of changes ends with the card holding the FINAL balance', async () => {
      await adopted('H3', 10)
      mw.present = { cardId: 'H3' }
      for (let i = 0; i < 4; i++) await debitCard(Card, { tenantId: tenant._id, code: 'H3' }, 1)
      await tick(150)
      expect(mw.writes.at(-1)).to.deep.equal({ code: 'H3', balance: 6 })
      expect((await cardIn('H3')).cardSyncedBalance).to.equal(6)
    })

    it('card not at the reader: nothing is written, and the next insert repairs it (self-healing)', async () => {
      await adopted('H4', 10)
      mw.present = null // customer already took the card
      await debitCard(Card, { tenantId: tenant._id, code: 'H4' }, 3)
      await tick(60)
      expect(mw.writes).to.have.length(0)
      expect((await cardIn('H4')).cardSyncedBalance).to.equal(10) // card still says 10, DB says 7

      mw.present = { cardId: 'H4' } // next visit: card still carries 10
      const r = await sync.reconcile(onCard('H4', 10))
      expect(r.status).to.equal('db-wins')
      expect(mw.writes).to.deep.equal([{ code: 'H4', balance: 7 }])
    })

    it('never writes one card\'s balance onto a different card at the reader', async () => {
      await adopted('H5', 10)
      mw.present = { cardId: 'SOMEONE-ELSE' }
      await debitCard(Card, { tenantId: tenant._id, code: 'H5' }, 1)
      await tick(60)
      expect(mw.writes).to.have.length(0)
    })

    it('retries a failing write, then succeeds', async () => {
      await adopted('H6', 10)
      mw.present = { cardId: 'H6' }
      mw.failNext = 2
      const done = nextUpdate()
      await debitCard(Card, { tenantId: tenant._id, code: 'H6' }, 1)
      await done
      expect(mw.writes).to.deep.equal([{ code: 'H6', balance: 9 }])
    })

    it('reports a persistent write failure instead of hiding it', async () => {
      await adopted('H7', 10)
      mw.present = { cardId: 'H7' }
      mw.failNext = 99
      const failed = new Promise((res) => sync.once('card-write-failed', res))
      await debitCard(Card, { tenantId: tenant._id, code: 'H7' }, 1)
      expect((await failed).code).to.equal('H7')
    })

    it('a card activation write (pending_write -> active) is recorded as a sync point, without a second write', async () => {
      await Card.create({ tenantId: tenant._id, code: 'H8', balance: 5, status: 'pending_write' })
      mw.present = { cardId: 'H8' }
      // what POST /pos/card/write does: write, then flip to active
      mw.emit('card-written', { cardData: { code: 'H8', balance: 5 } })
      const c = await Card.findOne({ tenantId: tenant._id, code: 'H8' })
      c.status = 'active'
      await c.save()
      await tick(80)
      expect((await cardIn('H8')).cardSyncedBalance).to.equal(5)
      expect(mw.writes).to.have.length(0)
    })

    it('does nothing outside controller mode', async () => {
      await adopted('H9', 10)
      mw.present = { cardId: 'H9' }
      delete mw.lowLevel
      await debitCard(Card, { tenantId: tenant._id, code: 'H9' }, 1)
      await tick(60)
      expect(mw.writes).to.have.length(0)
    })
  })
})

describe('Middleware.writeCardBalance (the real one)', () => {
  function realMiddleware() {
    const mw = new Middleware()
    mw.sent = []
    mw.lowLevel = { isConnected: true, send: (p) => { mw.sent.push(p); return true }, stop() {} }
    return mw
  }
  const answer201 = (mw) => setTimeout(() => mw.handlePackage({ op: 'write-card', code: '201' }), 10)

  it('writes the balance in cents to the card that is at the reader', async () => {
    const mw = realMiddleware()
    mw.handlePackage({ op: 'card-inserted', data: { cardId: 'C1', balance: '1000', name: 'Ana', nif: '1', admin: 'false' } })
    answer201(mw)
    const r = await mw.writeCardBalance({ code: 'C1', balance: 7.5, name: 'Ana', contribuinte: '1' })
    expect(r).to.deep.equal({ written: true })
    expect(mw.sent.at(-1).data).to.include({ cardId: 'C1', balance: '750' })
  })

  it('keeps the card\'s own name, tax id and owner when our record has none', async () => {
    const mw = realMiddleware()
    mw.handlePackage({ op: 'card-inserted', data: { cardId: 'C2', balance: '500', name: 'Ana', nif: '123456789', ownerId: 'OWN-9', admin: 'false' } })
    answer201(mw)
    await mw.writeCardBalance({ code: 'C2', balance: 4, name: '', contribuinte: '' })
    expect(mw.sent.at(-1).data).to.include({ name: 'Ana', nif: '123456789', ownerId: 'OWN-9', balance: '400' })
  })

  it('refuses when no card, a different card, or no controller', async () => {
    const mw = realMiddleware()
    expect(await mw.writeCardBalance({ code: 'C3', balance: 1 })).to.include({ written: false, reason: 'card-not-present' })
    mw.handlePackage({ op: 'card-inserted', data: { cardId: 'OTHER', balance: '100' } })
    expect(await mw.writeCardBalance({ code: 'C3', balance: 1 })).to.include({ written: false, reason: 'different-card-present' })
    mw.lowLevel.isConnected = false
    expect(await mw.writeCardBalance({ code: 'OTHER', balance: 1 })).to.include({ written: false, reason: 'controller-offline' })
    expect(mw.sent.filter((p) => p.op === 'write-card')).to.have.length(0)
  })

  it('forgets the card when it is removed', async () => {
    const mw = realMiddleware()
    mw.handlePackage({ op: 'card-inserted', data: { cardId: 'C4', balance: '100' } })
    mw.handlePackage({ op: 'card-removed' })
    expect(await mw.writeCardBalance({ code: 'C4', balance: 1 })).to.include({ reason: 'card-not-present' })
  })
})

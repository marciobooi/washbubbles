import { expect } from 'chai'
import net from 'net'
import { startTestDb, stopTestDb } from './setup.test-helper.js'
import Tenant from '../src/models/tenant.js'
import Interface from '../src/models/interface.js'
import Machine from '../src/models/machine.js'
import AuditLog from '../src/models/auditLog.js'
import { Middleware } from '../src/services/middleware.js'
import { CoinMachine } from '../src/services/coinMachine.js'
import { LowLevelStreamParser, LowLevelLink } from '../src/services/lowLevel.js'

describe('Audit 2026c', function () {
  this.timeout(20000)
  let tenant, cm, mwCalls
  before(async () => {
    await startTestDb()
    tenant = await Tenant.create({ name: 'Audit C', slug: `auditc-${Date.now()}` })
  })
  after(async () => {
    await Promise.all([Machine, Interface, AuditLog].map((M) => M.deleteMany({ tenantId: tenant._id })))
    await Tenant.deleteOne({ _id: tenant._id })
    await stopTestDb()
  })
  beforeEach(async () => {
    await Promise.all([Machine, Interface, AuditLog].map((M) => M.deleteMany({ tenantId: tenant._id })))
    mwCalls = 0
    cm = new CoinMachine({
      tenantId: tenant._id,
      middleware: {
        subscribe: () => ({ unsubscribe() {} }),
        sendMachineActivation: async () => { mwCalls++; throw new Error('controller offline') },
      },
    })
  })

  it('the remembered card is forgotten when the controller link drops', async () => {
    const mw = new Middleware()
    mw.handlePackage({ op: 'card-inserted', data: { cardId: '123', balance: 500 } })
    expect(mw.lastCard).to.include({ cardId: '123' })
    await mw.onLowLevelDisconnected()
    expect(mw.lastCard).to.equal(null)
  })

  it('a block that is late is reported once per late episode, not on every tick', async () => {
    const iface = await Interface.create({ tenantId: tenant._id, name: 'INT 5', address: 15, serialNumber: 'S15', status: 'active' })
    await Machine.create({
      tenantId: tenant._id, name: 'Secar 9', type: 'dry', weight: 18, tImp: 15, interfaceId: iface._id, port: 1,
      pendingImpulses: 1, nextImpulseAt: new Date(Date.now() - 6 * 60_000),
    })
    await cm.tickImpulses()
    await cm.tickImpulses()
    await cm.tickImpulses()
    expect(mwCalls).to.equal(3)
    expect(await AuditLog.countDocuments({ tenantId: tenant._id, action: 'machine.block.late' })).to.equal(1)
  })

  it('two change shortfalls in a row leave two audit entries (only the e-mail and broadcast are rate limited)', async () => {
    const quiet = console.warn
    console.warn = () => {}
    try {
      await cm.reportChangeShortfall(2, { remaining: 2, error: 'jam' })
      await cm.reportChangeShortfall(1, { remaining: 1, error: 'jam' })
    } finally { console.warn = quiet }
    expect(await AuditLog.countDocuments({ tenantId: tenant._id, action: 'change.shortfall' })).to.equal(2)
  })

  it('stop() carries on with the shutdown when saving the card balance fails', async () => {
    let unsubscribed = false
    cm.running = true
    cm.client.saveCardBalance = async () => { throw new Error('db down') }
    cm.middleware.disconnectAll = async () => {}
    cm.subscriptions.push({ unsubscribe() { unsubscribed = true } })
    const quiet = console.error
    console.error = () => {}
    try { await cm.stop() } finally { console.error = quiet }
    expect(unsubscribed).to.equal(true)
  })

  it('the receive buffer is still dropped past 1 MB, and says so', () => {
    const p = new LowLevelStreamParser()
    const errs = []
    const quiet = console.error
    console.error = (m) => errs.push(m)
    try { p.push(Buffer.from('{"a":"' + 'x'.repeat(1024 * 1024 + 10))) } finally { console.error = quiet }
    expect(p.buf).to.equal('')
    expect(errs.join(' ')).to.match(/dropped \d+ bytes/)
  })

  it('the socket to the controller has TCP keepalive on', async () => {
    const server = net.createServer((s) => s.on('error', () => {}))
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const link = new LowLevelLink({ host: '127.0.0.1', port: server.address().port })
    try {
      link.start()
      await new Promise((r) => setTimeout(r, 100))
      expect(link.socket.getKeepAlive?.() ?? true).to.equal(true)
    } finally {
      link.stop()
      server.close()
    }
  })
})

import { expect } from 'chai'
import net from 'net'
import {
  frameLowLevel, LowLevelStreamParser, LowLevelLink,
  decodeInterfaceStatus, isChannelBusy, euroToCents, centsToEuro,
} from '../src/services/lowLevel.js'
import { Middleware } from '../src/services/middleware.js'
import { CoinMachine } from '../src/services/coinMachine.js'
import Interface from '../src/models/interface.js'
import Machine from '../src/models/machine.js'

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

/** A stand-in for the shop's controller: records frames, lets a test push messages. */
function startFakeController() {
  const received = []
  const sockets = new Set()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('data', (d) => received.push(d.toString()))
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      received,
      push: (obj) => { for (const s of sockets) s.write(typeof obj === 'string' ? obj : JSON.stringify(obj)) },
      dropClients: () => { for (const s of sockets) s.destroy() },
      close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(r) }),
    }))
  })
}

describe('low-level framing', () => {
  it('matches the legacy bridge formula exactly', () => {
    const pkg = { op: 'activate-machine', data: [{ id: '11', chn: '1', impulses: '1' }] }
    const dataLength = JSON.stringify(pkg).length
    const legacy = { cl: (dataLength + dataLength.toString().length + 14).toString(), c: pkg }
    expect(frameLowLevel(pkg)).to.equal(JSON.stringify(legacy))
  })

  it('wraps the request as {cl, c} and cl equals the frame length for ordinary payloads', () => {
    const frame = frameLowLevel({ op: 'get-change', data: '150' })
    const parsed = JSON.parse(frame)
    expect(parsed.c).to.deep.equal({ op: 'get-change', data: '150' })
    expect(Number(parsed.cl)).to.equal(frame.length)
  })
})

describe('low-level stream parser', () => {
  it('returns two messages delivered in one chunk (two coins back to back)', () => {
    const p = new LowLevelStreamParser()
    const out = p.push('{"op":"coin-inserted","data":"0x05"}{"op":"coin-inserted","data":"0x06"}')
    expect(out.map((m) => m.data)).to.deep.equal(['0x05', '0x06'])
  })

  it('reassembles a message split across TCP segments', () => {
    const p = new LowLevelStreamParser()
    expect(p.push('{"op":"status_int","dev":[{"id":"1')).to.deep.equal([])
    const out = p.push('1","active":"1","status":"01"}]}')
    expect(out).to.have.length(1)
    expect(out[0].dev[0].id).to.equal('11')
  })

  it('is not fooled by braces and escaped quotes inside strings', () => {
    const p = new LowLevelStreamParser()
    const out = p.push('{"op":"print-receipt","data":"a } b { \\" c"}')
    expect(out).to.have.length(1)
    expect(out[0].data).to.equal('a } b { " c')
  })

  it('handles a multibyte character split across chunks', () => {
    const p = new LowLevelStreamParser()
    const bytes = Buffer.from('{"op":"card-inserted","data":{"name":"João"}}', 'utf8')
    const cut = bytes.indexOf(0xC3) + 1 // between the two bytes of "ã"
    expect(p.push(bytes.slice(0, cut))).to.deep.equal([])
    const out = p.push(bytes.slice(cut))
    expect(out[0].data.name).to.equal('João')
  })

  it('skips leading noise and newlines and drops a balanced-but-invalid object', () => {
    const p = new LowLevelStreamParser()
    const out = p.push('\r\nxx{not json}\r\n{"op":"has-card","code":"200"}\r\n')
    expect(out).to.deep.equal([{ op: 'has-card', code: '200' }])
  })
})

describe('low-level helpers', () => {
  it('converts euros to the controller\'s cents strings without float drift', () => {
    expect(euroToCents(1.5)).to.equal('150')
    expect(euroToCents(0.1 + 0.2)).to.equal('30')
    expect(centsToEuro('275')).to.equal(2.75)
    expect(centsToEuro('garbage')).to.equal(0)
  })

  it('decodes status_int bit strings into channel LEVELS: channel n is status[len - n]', () => {
    const out = decodeInterfaceStatus([
      { id: '11', active: '1', status: '01' }, // channel 1 high
      { id: '12', active: '1', status: '10' }, // channel 2 high
      { id: '13', active: '0', status: '11' }, // interface disconnected
    ])
    expect(out[0]).to.deep.equal({ id: '11', connected: true, channels: [{ chn: 1, level: true }, { chn: 2, level: false }] })
    expect(out[1].channels.map((c) => c.level)).to.deep.equal([false, true])
    expect(out[2].connected).to.equal(false)
  })

  it('busy depends on activation polarity: high => 1 is busy, low => 0 is busy', () => {
    expect(isChannelBusy(true, 'high')).to.equal(true)
    expect(isChannelBusy(false, 'high')).to.equal(false)
    expect(isChannelBusy(true, 'low')).to.equal(false)
    expect(isChannelBusy(false, 'low')).to.equal(true)
    expect(isChannelBusy(true)).to.equal(true) // default polarity is high
  })
})

describe('LowLevelLink (TCP)', () => {
  let ctrl, link
  beforeEach(async () => { ctrl = await startFakeController() })
  afterEach(async () => { link?.stop(); await ctrl.close() })

  it('sends framed requests and emits decoded replies', async () => {
    link = new LowLevelLink({ host: '127.0.0.1', port: ctrl.port, keepAlive: false })
    const got = []
    link.on('package', (p) => got.push(p))
    link.start()
    await tick(60)
    expect(link.isConnected).to.equal(true)

    expect(link.send({ op: 'status_int' })).to.equal(true)
    await tick()
    expect(JSON.parse(ctrl.received.join('')).c).to.deep.equal({ op: 'status_int' })

    ctrl.push({ op: 'status_int', dev: [{ id: '11', active: '1', status: '00' }] })
    await tick()
    expect(got[0].op).to.equal('status_int')
  })

  it('reports false from send() while disconnected rather than pretending', () => {
    link = new LowLevelLink({ host: '127.0.0.1', port: 1, keepAlive: false, reconnectMs: 10_000 })
    expect(link.send({ op: 'status_int' })).to.equal(false)
  })

  it('reconnects on its own after the controller drops the connection', async () => {
    link = new LowLevelLink({ host: '127.0.0.1', port: ctrl.port, keepAlive: false, reconnectMs: 30 })
    let connects = 0
    let disconnects = 0
    link.on('connect', () => connects++)
    link.on('disconnect', () => disconnects++)
    link.start()
    await tick(60)
    ctrl.dropClients()
    await tick(150)
    expect(disconnects).to.equal(1)
    expect(connects).to.equal(2)
    expect(link.isConnected).to.equal(true)
  })

  it('keep-alive: pings has-card on every tick even while the app is busy', async () => {
    link = new LowLevelLink({ host: '127.0.0.1', port: ctrl.port, keepAliveCheckMs: 10_000 })
    link.start()
    await tick(60)

    link.send({ op: 'status_int' }) // recent app traffic must not suppress the ping
    link.keepAliveTick()
    await tick()
    expect(ctrl.received.join('')).to.include('has-card')

    const before = ctrl.received.join('').split('has-card').length
    link.keepAliveTick()
    await tick()
    expect(ctrl.received.join('').split('has-card').length).to.equal(before + 1)
  })
})

/** A Middleware wired to a fake link — pure protocol logic, no DB, no sockets. */
function gatewayMiddleware({ connected = true } = {}) {
  const mw = new Middleware()
  const sent = []
  mw.lowLevel = {
    isConnected: connected,
    send: (pkg) => { if (!mw.lowLevel.isConnected) return false; sent.push(pkg); return true },
    stop() {},
  }
  mw.updatePeripheralStatus = async (id, status) => { mw.statuses = { ...(mw.statuses || {}), [String(id)]: status } }
  mw.coinEqTable = { '0x05': 1, '0x06': 2 }
  mw.billEqTable = { '0x10': 5 }
  mw.sent = sent
  mw.activationAck = 0 // the fake controller does not answer; the acknowledgement wait has its own tests
  return mw
}
const periph = (id, type, extra = {}) => ({ _id: id, name: type, type, enabled: true, protocol: 'cctalk', address: '2', ...extra })

describe('Middleware over the low-level gateway', () => {
  it('routes numeric/absent addresses through the controller, real COM ports stay local', () => {
    const mw = gatewayMiddleware()
    expect(mw.isGatewayPeripheral(periph('a', 'coin_acceptor', { address: '2' }))).to.equal(true)
    expect(mw.isGatewayPeripheral(periph('b', 'printer', { protocol: 'rs232', address: '' }))).to.equal(true)
    expect(mw.isGatewayPeripheral(periph('c', 'hopper', { protocol: 'ethernet' }))).to.equal(true)
    expect(mw.isGatewayPeripheral(periph('d', 'hopper', { address: 'COM4' }))).to.equal(false)
    expect(mw.isGatewayPeripheral(periph('e', 'hopper', { protocol: 'usb', address: '' }))).to.equal(false)
    expect(new Middleware().isGatewayPeripheral(periph('f', 'hopper'))).to.equal(false) // no gateway configured
  })

  it('credits a coin using the hex-keyed equivalence table, and refuses unmapped codes', () => {
    const mw = gatewayMiddleware()
    const events = []
    mw.on('coin-inserted', (e) => events.push(['ok', e.value]))
    mw.on('coin-rejected', (e) => events.push(['rejected', e.code]))
    mw.handlePackage({ op: 'coin-inserted', data: '0x06' })
    mw.handlePackage({ op: 'coin-inserted', data: '0x7f' })
    expect(events).to.deep.equal([['ok', 2], ['rejected', '0x7f']])
  })

  describe('coin/bill codes are matched EXACTLY on the controller path', () => {
    // The tables the legacy shop kiosk hard-codes: decimal strings.
    const shopCoins = { 3: 0.05, 4: 0.10, 5: 0.20, 6: 0.50, 7: 1, 8: 2 }
    const shopBills = { 5: 5, 10: 10, 20: 20, 50: 50 }

    it('credits every shop coin and bill by its controller code', () => {
      const mw = gatewayMiddleware()
      mw.coinEqTable = shopCoins
      mw.billEqTable = shopBills
      const got = []
      mw.on('coin-inserted', (e) => got.push(['coin', e.code, e.value]))
      mw.on('bill-inserted', (e) => got.push(['bill', e.code, e.value]))
      for (const c of ['3', '4', '5', '6', '7', '8']) mw.handlePackage({ op: 'coin-inserted', data: c })
      for (const b of ['5', '10', '20', '50']) mw.handlePackage({ op: 'bill-inserted', data: b })
      expect(got.map((g) => g[2])).to.deep.equal([0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50])
    })

    it('NEVER falls back to the hex form: a hex-keyed table must not mis-credit code "3" as 0x03 (=€0.20)', () => {
      const mw = gatewayMiddleware()
      mw.coinEqTable = { '0x01': 0.05, '0x02': 0.1, '0x03': 0.2, '0x04': 0.5, '0x05': 1, '0x06': 2 }
      const seen = []
      mw.on('coin-inserted', (e) => seen.push(['credited', e.value]))
      mw.on('coin-rejected', (e) => seen.push(['rejected', e.code, e.exact]))
      mw.handlePackage({ op: 'coin-inserted', data: '3' })
      expect(seen).to.deep.equal([['rejected', '3', true]])
    })

    it('the serial ccTalk path still accepts hex-keyed tables (unchanged)', () => {
      const mw = gatewayMiddleware()
      mw.coinEqTable = { '0x03': 0.2 }
      let value
      mw.on('coin-inserted', (e) => { value = e.value })
      mw.handleCcTalkCredit({ name: 'serial coin' }, { code: 3, isBill: false })
      expect(value).to.equal(0.2)
    })

    it('marks the event exact so the calibration wizard stores the raw code', () => {
      const mw = gatewayMiddleware()
      mw.coinEqTable = shopCoins
      let ev
      mw.on('coin-inserted', (e) => { ev = e })
      mw.handlePackage({ op: 'coin-inserted', data: '6' })
      expect(ev).to.include({ code: '6', exact: true, value: 0.5 })
    })
  })

  it('does not treat a coin-inserted REPLY as money', () => {
    const mw = gatewayMiddleware()
    let credited = false
    mw.on('coin-inserted', () => { credited = true })
    mw.handlePackage({ op: 'coin-inserted', data: '0x06', code: '200' })
    expect(credited).to.equal(false)
  })

  it('credits bills from billEqTable', () => {
    const mw = gatewayMiddleware()
    let value
    mw.on('bill-inserted', (e) => { value = e.value })
    mw.handlePackage({ op: 'bill-inserted', data: '0x10' })
    expect(value).to.equal(5)
  })

  it('activates a machine with the wire format the controller expects (strings)', async () => {
    const mw = gatewayMiddleware()
    await mw.sendMachineActivation({ _id: 'm1', name: 'Lavar 1', port: 2, impulses: '1' }, { _id: 'i1', name: 'Int 2', address: 12 })
    expect(mw.sent).to.deep.equal([{ op: 'activate-machine', data: [{ id: '12', chn: '2', impulses: '1' }] }])
  })

  it('several activations at once are sent one at a time with a pause (3 dryers paid together: one never started)', async () => {
    const mw = gatewayMiddleware()
    mw.activationGap = 60
    mw.activationConfirm = 30 // same interface (Secar 8 + 9): the confirmation wait is its own test below
    const at = []
    const origSend = mw.sendPackage.bind(mw)
    mw.sendPackage = (pkg) => { at.push(Date.now()); return origSend(pkg) }
    const iface = { _id: 'i4', name: 'Int 4', address: 14 }
    await Promise.all([
      mw.sendMachineActivation({ _id: 'a', name: 'Secar 8', port: 2 }, iface),
      mw.sendMachineActivation({ _id: 'b', name: 'Secar 9', port: 1 }, iface),
      mw.sendMachineActivation({ _id: 'c', name: 'Secar 11', port: 1 }, { _id: 'i5', name: 'Int 5', address: 15 }),
    ])
    expect(mw.sent.map((p) => p.data[0].id + '/' + p.data[0].chn)).to.deep.equal(['14/2', '14/1', '15/1']) // in order
    expect(at[1] - at[0]).to.be.at.least(50)
    expect(at[2] - at[1]).to.be.at.least(50)
  })

  it('two machines on the SAME interface: the second waits for the first one\'s machine-started (Secar 8+9 on 2026-10-25: the second started a minute late)', async () => {
    const mw = gatewayMiddleware()
    mw.activationGap = 0
    mw.activationConfirm = 2000
    const iface = { _id: 'i4', name: 'Int 4', address: 14 }
    const other = { _id: 'i5', name: 'Int 5', address: 15 }
    const p = Promise.all([
      mw.sendMachineActivation({ _id: 'a', name: 'Secar 8', port: 2 }, iface),
      mw.sendMachineActivation({ _id: 'b', name: 'Secar 9', port: 1 }, iface),
      mw.sendMachineActivation({ _id: 'c', name: 'Secar 11', port: 1 }, other),
    ])
    await tick(60)
    expect(mw.sent.filter((x) => x.op === 'activate-machine').map((x) => x.data[0].id + '/' + x.data[0].chn)).to.deep.equal(['14/2']) // the rest waits
    mw.handlePackage({ op: 'machine-started', data: { id: '14', chn: '2' } }) // the interface finished the first one
    await p
    expect(mw.sent.filter((x) => x.op === 'activate-machine').map((x) => x.data[0].id + '/' + x.data[0].chn)).to.deep.equal(['14/2', '14/1', '15/1'])
  })

  it('the wait for machine-started is bounded: a controller that never confirms does not freeze the next machine', async () => {
    const mw = gatewayMiddleware()
    mw.activationGap = 0
    mw.activationConfirm = 80
    const iface = { _id: 'i4', name: 'Int 4', address: 14 }
    const t0 = Date.now()
    await Promise.all([
      mw.sendMachineActivation({ _id: 'a', name: 'Secar 8', port: 2 }, iface),
      mw.sendMachineActivation({ _id: 'b', name: 'Secar 9', port: 1 }, iface),
    ])
    expect(mw.sent.filter((x) => x.op === 'activate-machine')).to.have.length(2)
    expect(Date.now() - t0).to.be.within(70, 1500)
  })

  it('a start order waits for the card write of the same payment (2026-11-10..14: 13 starts lost when sent 3 ms after write-card)', async () => {
    const mw = gatewayMiddleware()
    mw.activationGap = 0
    mw.activationCardSettle = 0
    mw.lastCard = { cardId: '365656747' }
    const write = mw.writeCardViaGateway({ name: 'reader' }, { code: '365656747', balance: 3.1 })
    const start = mw.sendMachineActivation({ _id: 'a', name: 'Secar 10', port: 2 }, { _id: 'i5', name: 'Int 5', address: 15 })
    await tick(40)
    expect(mw.sent.map((p) => p.op)).to.deep.equal(['write-card']) // the start is held while the card is written
    mw.handlePackage({ op: 'write-card', code: '201', msg: 'ok' })
    await write
    await start
    expect(mw.sent.map((p) => p.op)).to.deep.equal(['write-card', 'activate-machine'])
  })

  it('after the card write the start order waits a moment of calm before it is sent (the controller is still busy with the card)', async () => {
    const mw = gatewayMiddleware()
    mw.activationGap = 0
    mw.activationCardSettle = 120
    mw.lastCard = { cardId: '1' }
    const write = mw.writeCardViaGateway({ name: 'reader' }, { code: '1', balance: 1 })
    const start = mw.sendMachineActivation({ _id: 'a', name: 'Lavar 5', port: 1 }, { _id: 'i3', name: 'Int 3', address: 13 })
    await tick(20)
    mw.handlePackage({ op: 'write-card', code: '201', msg: 'ok' })
    await write
    await tick(60)
    expect(mw.sent.map((p) => p.op)).to.deep.equal(['write-card']) // the write is done, the order still waits
    await start
    expect(mw.sent.map((p) => p.op)).to.deep.equal(['write-card', 'activate-machine'])
  })

  it('the wait for a card write is bounded: a write that never ends does not keep the machine from starting', async () => {
    const mw = gatewayMiddleware()
    mw.activationGap = 0
    mw.activationCardWait = 60
    mw.activationCardSettle = 0
    mw.lastCard = { cardId: '1' }
    mw.writeCardViaGateway({ name: 'reader' }, { code: '1', balance: 1 }).catch(() => {})
    const t0 = Date.now()
    await mw.sendMachineActivation({ _id: 'a', name: 'Lavar 5', port: 1 }, { _id: 'i3', name: 'Int 3', address: 13 })
    expect(Date.now() - t0).to.be.within(50, 1500)
    expect(mw.sent.map((p) => p.op)).to.deep.equal(['write-card', 'activate-machine'])
  })

  it('a failed activation does not block the next one, and still reports its own error', async () => {
    const mw = gatewayMiddleware({ connected: false })
    mw.activationGap = 0
    let e1; try { await mw.sendMachineActivation({ _id: 'a', port: 1 }, { _id: 'i1', address: 11 }) } catch (e) { e1 = e }
    expect(e1?.message).to.match(/not connected/)
  })

  it('a start order the controller never confirms is reported once and NOT sent again (2026-11-06: Secar 10 ran although its answer was lost)', async () => {
    const mw = gatewayMiddleware()
    mw.activationAck = 60
    mw.activationLate = 80 // the time it is given to prove itself before anybody is told
    const seen = []
    mw.on('activation-unconfirmed', (d) => seen.push(d))
    await mw.sendMachineActivation({ _id: 'a', name: 'Secar 10', port: 2 }, { _id: 'i5', name: 'Int 5', address: 15 })
    expect(seen).to.have.length(0) // not yet: it may still answer
    await tick(150)
    expect(seen).to.have.length(1)
    expect(seen[0]).to.include({ machine: 'Secar 10', interface: '15', channel: '2' })
    expect(mw.sent.filter((x) => x.op === 'activate-machine')).to.have.length(1) // never repeated: it may already be running
  })

  it('a SLOW answer is not an alarm: the start is confirmed late and nobody is told (2026-11-10: three e-mails for machines that were running)', async () => {
    const mw = gatewayMiddleware()
    mw.activationAck = 40
    mw.activationLate = 400
    const seen = []
    const late = []
    mw.on('activation-unconfirmed', (d) => seen.push(d))
    mw.on('activation-confirmed-late', (d) => late.push(d))
    await mw.sendMachineActivation({ _id: 'a', name: 'Secar 8', port: 2 }, { _id: 'i4', name: 'Int 4', address: 14 })
    await tick(30)
    mw.handlePackage({ op: 'activate-machine', code: '200', msg: 'YeahAc!' }) // after its time
    await tick(500)
    expect(seen).to.have.length(0)
    expect(late).to.have.length(1)
    expect(late[0]).to.include({ machine: 'Secar 8', how: 'late answer' })
    expect(mw.sent.filter((x) => x.op === 'activate-machine')).to.have.length(1)
  })

  it('the machine saying it started also settles it, without any answer to the order', async () => {
    const mw = gatewayMiddleware()
    mw.activationAck = 40
    mw.activationLate = 400
    const seen = []
    const late = []
    mw.on('activation-unconfirmed', (d) => seen.push(d))
    mw.on('activation-confirmed-late', (d) => late.push(d))
    await mw.sendMachineActivation({ _id: 'a', name: 'Lavar 1', port: 1 }, { _id: 'i1', name: 'Int 1', address: 11 })
    mw.handlePackage({ op: 'machine-started', data: { id: '11', chn: '1' } })
    await tick(500)
    expect(seen).to.have.length(0)
    expect(late.map((d) => d.how)).to.deep.equal(['machine started'])
  })

  it('an answer with a code other than 200 is not a confirmation', async () => {
    const mw = gatewayMiddleware()
    mw.activationAck = 500
    mw.activationLate = 60
    const seen = []
    mw.on('activation-unconfirmed', (d) => seen.push(d))
    const p = mw.sendMachineActivation({ _id: 'a', name: 'Lavar 2', port: 2 }, { _id: 'i1', name: 'Int 1', address: 11 })
    await tick(10)
    mw.handlePackage({ op: 'activate-machine', code: '500', msg: 'Nope' })
    await p
    await tick(150)
    expect(seen).to.have.length(1)
    expect(mw.sent.filter((x) => x.op === 'activate-machine')).to.have.length(1)
  })

  it('a confirmed start order raises nothing and does not wait', async () => {
    const mw = gatewayMiddleware()
    mw.activationAck = 2000
    const seen = []
    mw.on('activation-unconfirmed', (d) => seen.push(d))
    const p = mw.sendMachineActivation({ _id: 'a', name: 'Secar 9', port: 1 }, { _id: 'i4', name: 'Int 4', address: 14 })
    await tick(10)
    const t0 = Date.now()
    mw.handlePackage({ op: 'activate-machine', code: '200', msg: 'YeahAc!' })
    await p
    expect(Date.now() - t0).to.be.below(200)
    expect(seen).to.have.length(0)
  })

  it('refuses to report an activation when the controller is unreachable', async () => {
    const mw = gatewayMiddleware({ connected: false })
    let err
    try { await mw.sendMachineActivation({ _id: 'm1', port: 1 }, { _id: 'i1', address: 11 }) } catch (e) { err = e }
    expect(err?.message).to.match(/not connected/)
  })

  it('legacy activateMachine works again (it used to call the serial send())', async () => {
    const mw = gatewayMiddleware()
    await mw.activateMachine([{ id: 11, chn: 1 }])
    expect(mw.sent[0]).to.deep.equal({ op: 'activate-machine', data: [{ id: '11', chn: '1', impulses: '1' }] })
  })

  it('status_int: emits per-channel status and the decoded interfaces from `dev`', () => {
    const mw = gatewayMiddleware()
    const chans = []
    let decoded
    mw.on('gateway-machine-status', (e) => chans.push(e))
    mw.on('status_int', (e) => { decoded = e })
    mw.handlePackage({ op: 'status_int', dev: [{ id: '11', active: '1', status: '01' }] })
    expect(chans).to.deep.equal([
      { address: 11, port: 1, connected: true, level: true },
      { address: 11, port: 2, connected: true, level: false },
    ])
    expect(decoded.interfaces[0].id).to.equal('11')
  })

  it('status_per marks controller-attached peripherals ok/fault', async () => {
    const mw = gatewayMiddleware()
    mw.connections.set('coin', { gateway: true, peripheral: periph('coin', 'coin_acceptor') })
    mw.connections.set('hop', { gateway: true, peripheral: periph('hop', 'hopper') })
    await mw.applyPeripheralStatus([{ type: 'coin-acceptor', active: '1' }, { type: 'hopper', active: '0' }])
    expect(mw.statuses).to.deep.equal({ coin: 'ok', hop: 'fault' })
  })

  describe('change (get-change / no-change)', () => {
    const withHopper = () => {
      const mw = gatewayMiddleware()
      mw.connections.set('hop', { gateway: true, peripheral: periph('hop', 'hopper') })
      return mw
    }

    it('reports success when the controller says nothing was unavailable', async () => {
      const mw = withHopper()
      const p = mw.dispenseChange('hop', 1.5)
      await tick()
      expect(mw.sent[0]).to.deep.equal({ op: 'get-change', data: '150' })
      mw.handlePackage({ op: 'no-change', data: '0' })
      expect(await p).to.include({ success: true, dispensed: 1.5, remaining: 0 })
    })

    it('a hopper fault (status 400) before no-change 0 is NOT a paid-out change', async () => {
      const mw = withHopper()
      const p = mw.dispenseChange('hop', 6)
      await tick()
      mw.handlePackage({ op: 'hopper-status', code: '400' })
      mw.handlePackage({ op: 'no-change', data: '0' })
      expect(await p).to.include({ success: false, dispensed: 0, remaining: 6 })
    })

    it('a hopper fault with a real shortfall: the part the controller did pay is not owed again (2026-10-24: 8 asked, no-change 500)', async () => {
      const mw = withHopper()
      const p = mw.dispenseChange('hop', 8)
      await tick()
      mw.handlePackage({ op: 'hopper-status', code: '400' })
      mw.handlePackage({ op: 'no-change', data: '500' })
      expect(await p).to.include({ success: false, dispensed: 3, remaining: 5 })
    })

    it('reports the shortfall the controller could not pay', async () => {
      const mw = withHopper()
      const p = mw.dispenseChange('hop', 2)
      await tick()
      mw.handlePackage({ op: 'no-change', data: '50' })
      expect(await p).to.include({ success: false, dispensed: 1.5, remaining: 0.5 })
    })

    it('does not claim success when the controller never answers', async () => {
      const mw = withHopper()
      const orig = mw.waitForReply.bind(mw)
      mw.waitForReply = (ops, o) => orig(ops, { ...o, timeoutMs: 30 })
      const res = await mw.dispenseChange('hop', 1)
      expect(res).to.include({ success: false, unconfirmed: true, remaining: 1 })
    })

    it('does not send when the controller is down', async () => {
      const mw = gatewayMiddleware({ connected: false })
      mw.connections.set('hop', { gateway: true, peripheral: periph('hop', 'hopper') })
      const res = await mw.dispenseChange('hop', 1)
      expect(res.success).to.equal(false)
      expect(mw.sent).to.have.length(0)
    })
  })

  describe('cards', () => {
    const withReader = () => {
      const mw = gatewayMiddleware()
      mw.connections.set('rfid', { gateway: true, peripheral: periph('rfid', 'rfid_reader', { address: '' }) })
      return mw
    }

    it('writes a card and resolves only on code 201 (200 = in progress)', async () => {
      const mw = withReader()
      mw.lastCard = { cardId: 'ABC123' } // a card is at the reader
      const p = mw.writeCardData('rfid', { code: 'ABC123', balance: 7.5, name: 'Ana', contribuinte: '123456789' })
      await tick()
      expect(mw.sent[0]).to.deep.equal({
        op: 'write-card',
        data: { cardId: 'ABC123', name: 'Ana', nif: '123456789', balance: '750', new: false, admin: false },
      })
      mw.handlePackage({ op: 'write-card', code: '200' }) // progress — must not settle
      mw.handlePackage({ op: 'write-card', code: '201' })
      expect(await p).to.deep.equal({ success: true, cardCode: 'ABC123' })
    })

    it('waits for the card to be presented before sending write-card (new-card purchase)', async () => {
      const mw = withReader() // no card at the reader yet
      const p = mw.writeCardData('rfid', { code: 'NEW1', balance: 5 })
      await tick(30)
      expect(mw.sent).to.have.length(0) // nothing sent while no card is present
      mw.handlePackage({ op: 'card-inserted', data: { cardId: 'BLANK', balance: '0', admin: 'false' } })
      await tick(30)
      expect(mw.sent[0].op).to.equal('write-card')
      mw.handlePackage({ op: 'write-card', code: '201' })
      expect(await p).to.include({ success: true })
    })

    it('gives up if no card is presented in time and never sends', async () => {
      const mw = withReader()
      const orig = mw.waitForReply.bind(mw)
      mw.waitForReply = (ops, o) => orig(ops, { ...o, timeoutMs: 30 })
      let err
      try { await mw.writeCardData('rfid', { code: 'NEW2', balance: 5 }) } catch (e) { err = e }
      expect(err?.message).to.match(/No reply/)
      expect(mw.sent).to.have.length(0)
    })

    it('rejects a failed write instead of reporting it written', async () => {
      const mw = withReader()
      mw.lastCard = { cardId: 'ABC123' }
      const p = mw.writeCardData('rfid', { code: 'ABC123', balance: 1 })
      await tick()
      mw.handlePackage({ op: 'write-card', code: '500' })
      let err
      try { await p } catch (e) { err = e }
      expect(err?.message).to.match(/code 500/)
    })

    it('exposes the card the controller reported and forgets it on removal', async () => {
      const mw = withReader()
      const reads = []
      mw.on('card-read', (e) => reads.push(e.cardNumber))
      mw.handlePackage({ op: 'card-inserted', data: { cardId: 'C1', balance: '250', name: 'Rui', nif: '9', admin: 'false' } })
      expect(reads).to.deep.equal(['C1'])
      const res = await mw.readCardData('rfid')
      expect(res.cardData).to.include({ code: 'C1', balance: 2.5, name: 'Rui' })
      mw.handlePackage({ op: 'card-removed' })
      let err
      try { await mw.readCardData('rfid') } catch (e) { err = e }
      expect(err?.message).to.match(/No card/)
    })

    it('has-card reply gates card dispensing', async () => {
      const mw = gatewayMiddleware()
      mw.connections.set('disp', { gateway: true, peripheral: periph('disp', 'card_dispenser', { address: '22' }) })
      mw.handlePackage({ op: 'has-card', code: '404' })
      let err
      try { await mw.dispenseCard('disp') } catch (e) { err = e }
      expect(err?.message).to.match(/no cards/)
      mw.handlePackage({ op: 'has-card', code: '200' })
      await mw.dispenseCard('disp')
      expect(mw.sent.at(-1)).to.deep.equal({ op: 'card-release' })
    })
  })

  it('prints through print-receipt, wrapping plain text for the controller', async () => {
    const mw = gatewayMiddleware()
    mw.connections.set('prn', { gateway: true, peripheral: periph('prn', 'printer', { address: '' }) })
    await mw.print('prn', 'Line A\nLine B')
    const sent = mw.sent[0]
    expect(sent.op).to.equal('print-receipt')
    expect(sent.data.orders.map((o) => o.serv)).to.deep.equal(['Line A', 'Line B'])
  })

  it('an event (machine-started) triggers a status re-read, like the legacy kiosk', () => {
    const mw = gatewayMiddleware()
    mw.handlePackage({ op: 'machine-started', data: { id: '11', chn: '1' } })
    expect(mw.sent).to.deep.equal([{ op: 'status_int' }])
  })
})

describe('CoinMachine: gateway machine status honours activation polarity', () => {
  const origIface = Interface.findOne
  const origMachine = Machine.findOne
  afterEach(() => { Interface.findOne = origIface; Machine.findOne = origMachine })

  function setup(activation) {
    Interface.findOne = async () => ({ _id: 'if1', address: 12 })
    Machine.findOne = async () => ({ _id: 'm1', activation })
    const cm = new CoinMachine({ tenantId: 't1', middleware: { scheduleBusyPoll() { cm.polled = true } } })
    cm.updates = []
    cm.handleMachineStatusUpdate = async (u) => { cm.updates.push(u) }
    return cm
  }

  it('high-polarity machine: level 1 = occupied, level 0 = free', async () => {
    const cm = setup('high')
    await cm.handleGatewayMachineStatus({ address: 12, port: 1, connected: true, level: true })
    await cm.handleGatewayMachineStatus({ address: 12, port: 1, connected: true, level: false })
    expect(cm.updates.map((u) => u.status.occupied)).to.deep.equal([true, false])
  })

  it('low-polarity machine (3 of 4 dryers in our DB): level 0 = occupied, level 1 = FREE', async () => {
    const cm = setup('low')
    await cm.handleGatewayMachineStatus({ address: 12, port: 2, connected: true, level: true })
    await cm.handleGatewayMachineStatus({ address: 12, port: 2, connected: true, level: false })
    expect(cm.updates.map((u) => u.status.occupied)).to.deep.equal([false, true])
  })

  it('a disconnected interface is a fault and never "busy"; busy asks for a quick re-poll', async () => {
    const cm = setup('high')
    await cm.handleGatewayMachineStatus({ address: 12, port: 1, connected: false, level: true })
    expect(cm.updates[0].status).to.include({ fault: true, occupied: false })
    expect(cm.polled).to.equal(undefined)
    await cm.handleGatewayMachineStatus({ address: 12, port: 1, connected: true, level: true })
    expect(cm.polled).to.equal(true)
  })

  it('a controller machine-issue with active:"0" is reported as a fault on that channel', async () => {
    const cm = setup('high')
    await cm.handleMachineIssue({ id: '12', chn: '2', active: '0', status: '00' })
    expect(cm.updates[0]).to.deep.include({ port: 2 })
    expect(cm.updates[0].status.fault).to.equal(true)
  })
})

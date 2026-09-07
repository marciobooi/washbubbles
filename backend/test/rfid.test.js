import { expect } from 'chai'
import EventEmitter from 'events'
import { Middleware } from '../src/services/middleware.js'

/**
 * Fake PC/SC-style RFID reader.
 *
 * Responds to the three commands `authenticateBlock`/`readCardIdentity`/
 * `writeCardData` actually send: Load Key (0xFF 0x82), General Authenticate
 * (0xFF 0x86), Read Binary (0xFF 0xB0), Update Binary (0xFF 0xD6), and Get UID
 * (0xFF 0xCA). Blocks are stored keyed by block number; the "card" can be
 * configured to require the default key, refuse it (simulating a card that
 * isn't ours), or refuse a specific block.
 */
class FakeRfidCard extends EventEmitter {
  constructor({ uid = 'DEADBEEF', requireDefaultKey = true, blocks = {} } = {}) {
    super()
    this.uid = uid
    this.requireDefaultKey = requireDefaultKey
    this.blocks = { ...blocks } // blockNumber -> 16-byte Buffer
    this.written = []
  }

  write(buf, cb) {
    this.written.push(Buffer.from(buf))
    queueMicrotask(() => this._respond(buf))
    if (cb) cb(null)
    return true
  }

  _respond(buf) {
    const OK = Buffer.from([0x90, 0x00])
    const FAIL = Buffer.from([0x63, 0x00])

    if (buf[0] === 0xFF && buf[1] === 0xCA) {
      // Get UID
      if (!this.uid) return this.emit('data', OK) // no card: just SW, no UID bytes
      return this.emit('data', Buffer.concat([Buffer.from(this.uid, 'hex'), OK]))
    }
    if (buf[0] === 0xFF && buf[1] === 0x82) {
      // Load Key — the key bytes are appended after the header
      const key = buf.slice(5)
      this._lastLoadedKey = key
      return this.emit('data', OK)
    }
    if (buf[0] === 0xFF && buf[1] === 0x86) {
      // General Authenticate
      const isDefaultKey = this._lastLoadedKey && this._lastLoadedKey.toString('hex') === 'ffffffffffff'
      const ok = this.requireDefaultKey ? isDefaultKey : false
      return this.emit('data', ok ? OK : FAIL)
    }
    if (buf[0] === 0xFF && buf[1] === 0xB0) {
      // Read Binary
      const blockNumber = buf[3]
      const data = this.blocks[blockNumber] || Buffer.alloc(16)
      return this.emit('data', Buffer.concat([data, OK]))
    }
    if (buf[0] === 0xFF && buf[1] === 0xD6) {
      // Update Binary
      const blockNumber = buf[3]
      const data = buf.slice(5)
      this.blocks[blockNumber] = Buffer.from(data)
      return this.emit('data', OK)
    }
    this.emit('data', FAIL)
  }
}

function makeConnection(card) {
  return { port: card, peripheral: { _id: 'rfid-1', name: 'Test Reader', type: 'rfid_reader' } }
}

describe('RFID identity: read/write/authenticate', () => {
  it('reads the UID via the standard PC/SC Get-Data command', async () => {
    const mw = new Middleware()
    const card = new FakeRfidCard({ uid: 'A1B2C3D4' })
    const uid = await mw.getCardUid(makeConnection(card))
    expect(uid).to.equal('a1b2c3d4')
  })

  it('returns null when no card is present', async () => {
    const mw = new Middleware()
    const card = new FakeRfidCard({ uid: null })
    const uid = await mw.getCardUid(makeConnection(card))
    expect(uid).to.equal(null)
  })

  it('authenticates with the MIFARE default key before touching a block', async () => {
    const mw = new Middleware()
    const card = new FakeRfidCard({ requireDefaultKey: true })
    await mw.authenticateBlock(makeConnection(card), 1)
    // The key actually sent must be the documented factory default.
    expect(card._lastLoadedKey.toString('hex')).to.equal('ffffffffffff')
  })

  it('throws — rather than silently reading garbage — when authentication fails', async () => {
    const mw = new Middleware()
    // A card formatted with a non-default key: exactly "a different chip" that
    // must not be treated as one of ours.
    const card = new FakeRfidCard({ requireDefaultKey: false })
    let err = null
    await mw.authenticateBlock(makeConnection(card), 1).catch((e) => { err = e })
    expect(err).to.be.an('error')
    expect(err.message).to.match(/Authentication failed/)
  })

  it('writes a code onto a blank card and reads the same code back', async () => {
    const mw = new Middleware()
    const card = new FakeRfidCard()
    // writeCardData looks the connection up by peripheralId in `this.connections`
    // — wire it up directly for this unit test rather than going through connect().
    mw.connections.set('rfid-1', makeConnection(card))
    const result = await mw.writeCardData('rfid-1', {
      code: '4821903355', balance: 10, name: '', email: '', phone: '', contribuinte: '',
    })
    expect(result.success).to.equal(true)
    expect(result.cardCode).to.equal('4821903355')

    const identity = await mw.readCardIdentity(makeConnection(card))
    expect(identity.code).to.equal('4821903355')
    expect(identity.balance).to.equal(10)
  })

  it('never writes into a sector trailer block', async () => {
    const mw = new Middleware()
    const card = new FakeRfidCard()
    mw.connections.set('rfid-1', makeConnection(card))
    // A long payload (name+email+phone set) used to spill into block 7 — a
    // sector trailer — and permanently brick the card.
    await mw.writeCardData('rfid-1', {
      code: '1112223334',
      balance: 99.5,
      name: 'Maria da Silva Santos',
      email: 'maria.silva.santos@example.com',
      phone: '+351912345678',
      contribuinte: '123456789',
    })
    const trailers = [3, 7, 11, 15, 19, 23]
    for (const t of trailers) {
      expect(card.blocks[t], `block ${t} is a sector trailer`).to.equal(undefined)
    }
  })

  it('rejects a card whose data does not decode as ours', async () => {
    const mw = new Middleware()
    // A foreign chip / unformatted card: readable blocks, but not our JSON.
    const card = new FakeRfidCard({ blocks: { 1: Buffer.from('random factory data', 'utf-8') } })
    let err = null
    await mw.readCardIdentity(makeConnection(card)).catch((e) => { err = e })
    expect(err).to.be.an('error')
    expect(err.message).to.match(/does not decode/)
  })

  it('fails write verification if the card reads back a different code', async () => {
    const mw = new Middleware()
    const card = new FakeRfidCard()
    mw.connections.set('rfid-1', makeConnection(card))
    // Sabotage the DEVICE's own handling of Update Binary for block 1: it ACKs
    // the write (so per-block verification alone would be fooled) but silently
    // stores different bytes — simulating a reader/card that lies about the
    // write succeeding. Patched on `_respond` (not `write`) since the fake
    // schedules its ACK as a microtask that would otherwise clobber a
    // substitution made from inside `write` itself.
    const originalRespond = card._respond.bind(card)
    card._respond = (buf) => {
      if (buf[0] === 0xFF && buf[1] === 0xD6 && buf[3] === 1) {
        card.blocks[1] = Buffer.from('{"code":"0000000', 'utf-8') // 16 bytes, different code
        return card.emit('data', Buffer.from([0x90, 0x00]))
      }
      return originalRespond(buf)
    }
    let err = null
    await mw.writeCardData('rfid-1', { code: '9998887776', balance: 0 }).catch((e) => { err = e })
    expect(err).to.be.an('error')
    expect(err.message).to.match(/different code/)
  })
})

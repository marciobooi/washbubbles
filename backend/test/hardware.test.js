import { expect } from 'chai'
import { ccFrame, readCcFrame, ccChecksum, CcTalkLink, CC_HOST } from '../src/services/ccTalk.js'
import { kitsecFrame, readKitsecFrame, parseStatusByte } from '../src/services/kitsec.js'
import EventEmitter from 'events'

/** Minimal stand-in for a SerialPort: records writes, lets tests push data in. */
class FakePort extends EventEmitter {
  constructor() { super(); this.written = [] }
  write(buf, cb) { this.written.push(Buffer.from(buf)); if (cb) cb(null); return true }
  feed(buf) { this.emit('data', Buffer.from(buf)) }
}

describe('ccTalk framing', () => {
  it('round-trips a frame with a valid checksum', () => {
    const f = ccFrame(CC_HOST, 2, 0xE5, [0x01, 0x00])
    const { frame } = readCcFrame(f)
    expect(frame).to.not.equal(null)
    expect(frame.header).to.equal(0xE5)
    expect([...frame.data]).to.deep.equal([0x01, 0x00])
  })

  it('makes the whole frame sum to zero mod 256', () => {
    const f = ccFrame(CC_HOST, 2, 0xE5, [0x07])
    expect([...f].reduce((a, b) => a + b, 0) % 256).to.equal(0)
  })

  // The bug: two coins arriving in one serial chunk credited only ONE coin,
  // because the old code read data[0] off the raw chunk.
  it('parses two frames delivered in a single chunk', () => {
    let buf = Buffer.concat([
      ccFrame(CC_HOST, 2, 0xE5, [0x01]),
      ccFrame(CC_HOST, 2, 0xE5, [0x02]),
    ])
    const got = []
    for (;;) {
      const r = readCcFrame(buf)
      buf = r.rest
      if (r.resync) continue
      if (!r.frame) break
      got.push(r.frame.data[0])
    }
    expect(got).to.deep.equal([1, 2])
  })

  // The other half: a frame split across chunks made a mid-frame byte the
  // "credit code" — 0x03 read as €20.00 of free credit by parseBillValue.
  it('yields nothing until a split frame is complete', () => {
    const whole = ccFrame(CC_HOST, 40, 0x9F, [0x05, 0x00])
    expect(readCcFrame(whole.slice(0, 4)).frame).to.equal(null)
    expect(readCcFrame(whole).frame).to.not.equal(null)
  })

  it('rejects a frame whose checksum is wrong', () => {
    const bad = Buffer.from(ccFrame(CC_HOST, 2, 0xE5, [0x01]))
    bad[bad.length - 1] ^= 0xFF
    const r = readCcFrame(bad)
    expect(r.frame).to.equal(null)
    expect(r.resync).to.equal(true)
  })

  it('resynchronises past line noise instead of wedging', () => {
    const whole = ccFrame(CC_HOST, 40, 0x9F, [0x05])
    for (const noise of [[0xAA, 0xBB], [0x01, 0xBB, 0x02], Array(20).fill(0x01)]) {
      let buf = Buffer.concat([Buffer.from(noise), whole])
      let found = null
      for (let i = 0; i < 40 && !found; i++) {
        const r = readCcFrame(buf)
        buf = r.rest
        if (r.frame) found = r.frame
        if (!r.frame && !r.resync) break
      }
      expect(found, `noise ${noise.slice(0, 3)}`).to.not.equal(null)
      expect(found.header).to.equal(0x9F)
    }
  })
})

describe('CcTalkLink request queue', () => {
  it('serialises concurrent requests so a reply cannot satisfy the wrong one', async () => {
    const port = new FakePort()
    const link = new CcTalkLink(port, 2, { timeoutMs: 200 })

    const a = link.request(0xE5, [])
    const b = link.request(0xA6, [])

    // Only the first command may be on the wire.
    expect(port.written).to.have.length(1)
    expect(port.written[0][3]).to.equal(0xE5)

    port.feed(ccFrame(CC_HOST, 2, 0xE5, [0x11]))
    const ra = await a
    expect(ra.data[0]).to.equal(0x11)

    // Now — and only now — the second goes out.
    expect(port.written).to.have.length(2)
    expect(port.written[1][3]).to.equal(0xA6)

    port.feed(ccFrame(CC_HOST, 2, 0xA6, [0x22]))
    const rb = await b
    expect(rb.data[0]).to.equal(0x22)
  })

  it('times out without resolving a later reply into the wrong request', async () => {
    const port = new FakePort()
    const link = new CcTalkLink(port, 2, { timeoutMs: 50 })
    let err = null
    await link.request(0xE5, []).catch((e) => { err = e })
    expect(err).to.be.an('error')
    expect(err.message).to.match(/timeout/i)
  })
})

describe('KITSEC framing', () => {
  // The bug: scanning for the first 0x03 treated a normal running-machine
  // status byte (doorClosed|occupied = 0x03) as end-of-frame.
  it('parses a status byte of 0x03 without truncating', () => {
    const { frame } = readKitsecFrame(kitsecFrame(0x53, 1, [0x03]))
    expect(frame).to.not.equal(null)
    expect(frame.payload[0]).to.equal(0x03)
    const st = parseStatusByte(frame.payload[0])
    expect(st.doorClosed).to.equal(true)
    expect(st.occupied).to.equal(true)
    expect(st.fault).to.equal(false)
  })

  it('parses port 3 correctly', () => {
    const { frame } = readKitsecFrame(kitsecFrame(0x53, 3, [0x21]))
    expect(frame.port).to.equal(3)
    expect(frame.payload[0]).to.equal(0x21)
  })

  it('does not desynchronise the stream after an embedded 0x03', () => {
    let buf = Buffer.concat([kitsecFrame(0x53, 3, [0x03]), kitsecFrame(0x53, 7, [0x01])])
    const got = []
    for (;;) {
      const r = readKitsecFrame(buf)
      buf = r.rest
      if (r.resync) continue
      if (!r.frame) break
      got.push(r.frame.port)
    }
    expect(got).to.deep.equal([3, 7])
  })

  it('rejects a frame with a bad checksum rather than reporting a false fault', () => {
    const bad = Buffer.from(kitsecFrame(0x53, 1, [0x03]))
    bad[bad.length - 1] ^= 0xFF
    expect(readKitsecFrame(bad).frame).to.equal(null)
  })
})

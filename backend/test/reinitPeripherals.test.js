import { expect } from 'chai'
import { Middleware } from '../src/services/middleware.js'

describe('Re-initialise controller peripherals after (re)connect', () => {
  function build(peripherals, connected = true) {
    const mw = new Middleware()
    const sent = []
    mw.lowLevel = { isConnected: connected }
    mw.sendPackage = (p) => { sent.push(p); return true }
    peripherals.forEach((p, i) => mw.connections.set(String(i), { gateway: true, peripheral: { enabled: true, ...p } }))
    return { mw, sent }
  }

  it('always carries the whole ccTalk bus (a partial list would unregister the rest)', async () => {
    const { mw, sent } = build([
      { type: 'bill_acceptor', protocol: 'cctalk', address: '40' },
      { type: 'coin_acceptor', protocol: 'cctalk', address: '2' },
      { type: 'hopper', protocol: 'cctalk', address: '3' },
    ])
    const r = await mw.reinitPeripherals(['bill_acceptor'])
    expect(r.sent).to.equal(true)
    expect(sent).to.have.length(1)
    expect(sent[0]).to.deep.equal({ op: 'config_per', per: [
      { protocol: 'ccTalk', type: 'bill-acceptor', addr: '40', baudRate: '9600' },
      { protocol: 'ccTalk', type: 'coin-acceptor', addr: '2', baudRate: '9600' },
      { protocol: 'ccTalk', type: 'hopper', addr: '3', baudRate: '9600' },
    ] })
  })

  it('all sends the complete list with the controller own protocol names', async () => {
    const { mw, sent } = build([
      { type: 'bill_acceptor', protocol: 'cctalk', address: '40' },
      { type: 'coin_acceptor', protocol: 'cctalk', address: '2' },
      { type: 'hopper', protocol: 'cctalk', address: '3' },
      { type: 'card_dispenser', protocol: 'pulse', address: '22' },
      { type: 'printer', protocol: 'rs232', address: '' },
      { type: 'rfid_reader', protocol: 'pulse', address: '' },
    ])
    await mw.reinitPeripherals(['all'])
    expect(sent[0].per).to.deep.equal([
      { protocol: 'ccTalk', type: 'bill-acceptor', addr: '40', baudRate: '9600' },
      { protocol: 'ccTalk', type: 'coin-acceptor', addr: '2', baudRate: '9600' },
      { protocol: 'ccTalk', type: 'hopper', addr: '3', baudRate: '9600' },
      { protocol: 'rs232', type: 'printer', addr: '', baudRate: '9600' },
      { protocol: 'spi', type: 'rfid-rw', addr: '' },
    ])
  })

  it('does nothing when the controller is not connected, or there is nothing to address', async () => {
    const off = build([{ type: 'bill_acceptor', protocol: 'cctalk', address: '40' }], false)
    expect((await off.mw.reinitPeripherals()).sent).to.equal(false)
    const empty = build([{ type: 'bill_acceptor', protocol: 'cctalk', address: '' }])
    const r = await empty.mw.reinitPeripherals()
    expect(r.sent).to.equal(false)
    expect(empty.sent).to.have.length(0)
  })
})

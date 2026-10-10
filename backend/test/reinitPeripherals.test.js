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

  it('sends only the bill acceptor\'s own entry (ccTalk, its address, 9600)', async () => {
    const { mw, sent } = build([
      { type: 'bill_acceptor', protocol: 'cctalk', address: '40' },
      { type: 'coin_acceptor', protocol: 'cctalk', address: '2' },
      { type: 'hopper', protocol: 'cctalk', address: '3' },
    ])
    const r = await mw.reinitPeripherals(['bill_acceptor'])
    expect(r.sent).to.equal(true)
    expect(sent).to.have.length(1)
    expect(sent[0]).to.deep.equal({ op: 'config_per', per: [{ protocol: 'cctalk', addr: '40', type: 'bill-acceptor', baudRate: '9600' }] })
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

import { expect } from 'chai'
import net from 'net'
import { startBridge } from '../src/hardwareBridge.js'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })

describe('Hardware bridge: the controller session outlives the backend', function () {
  this.timeout(10000)
  let fake, fakeSockets, controllerPort, bridge, bridgePort, received

  beforeEach(async () => {
    fakeSockets = []
    received = []
    fake = net.createServer((s) => { fakeSockets.push(s); s.on('data', (d) => received.push(d.toString())) })
    await new Promise((r) => fake.listen(0, '127.0.0.1', r))
    controllerPort = fake.address().port
    bridgePort = await freePort()
    bridge = startBridge({ controllerHost: '127.0.0.1', controllerPort, listenPort: bridgePort, reconnectMs: 50, log: () => {} })
    await wait(150)
  })
  afterEach(async () => {
    bridge.close()
    fakeSockets.forEach((s) => s.destroy())
    await new Promise((r) => fake.close(r))
  })

  const connectClient = () => new Promise((res) => {
    const c = net.createConnection({ host: '127.0.0.1', port: bridgePort }, () => res(c))
    c.chunks = []
    c.on('data', (d) => c.chunks.push(d.toString()))
  })

  it('passes requests to the controller and replies back to the backend', async () => {
    const c = await connectClient()
    c.write('{"cl":"9","c":{"op":"get-version"}}')
    await wait(100)
    expect(received.join('')).to.include('get-version')
    fakeSockets[0].write('{"op":"get-version","data":"V1.1.34"}')
    await wait(100)
    expect(c.chunks.join('')).to.include('V1.1.34')
    c.destroy()
  })

  it('keeps the controller connection when the backend disconnects and reconnects', async () => {
    const c1 = await connectClient()
    await wait(100)
    expect(fakeSockets).to.have.length(1)
    c1.destroy()
    await wait(150)
    expect(fakeSockets[0].destroyed).to.equal(false) // the controller never saw a disconnect
    const c2 = await connectClient()
    await wait(100)
    expect(fakeSockets).to.have.length(1) // still the one session
    expect(c2.chunks.join('')).to.include('"controller":"connected"')
    c2.destroy()
  })

  it('holds money that arrives while no backend is connected and hands it over', async () => {
    fakeSockets[0].write('{"op":"coin-inserted","data":"7"}{"op":"status_int","dev":[]}')
    await wait(100)
    const c = await connectClient()
    await wait(800)
    const got = c.chunks.join('')
    expect(got).to.include('"coin-inserted"')
    expect(got).to.not.include('status_int') // only money is kept
    c.destroy()
  })

  it('reconnects to the controller by itself and tells the backend how old the session is', async () => {
    const c = await connectClient()
    await wait(100)
    fakeSockets[0].destroy() // the controller drops us
    await wait(300)
    expect(fakeSockets).to.have.length(2)
    const text = c.chunks.join('')
    expect(text).to.include('"controller":"disconnected"')
    expect(text.split('"controller":"connected"').length - 1).to.be.at.least(2)
    c.destroy()
  })

  it('opens a brand-new controller session when the backend asks, without passing the request on', async () => {
    const c = await connectClient()
    await wait(100)
    c.write('{"cl":"9","c":{"op":"bridge-reset"}}')
    await wait(400)
    expect(fakeSockets).to.have.length(2) // a second session with the controller
    expect(received.join('')).to.not.include('bridge-reset')
    c.write('{"cl":"9","c":{"op":"get-version"}}')
    await wait(100)
    expect(received.join('')).to.include('get-version') // and requests still flow
    c.destroy()
  })
})

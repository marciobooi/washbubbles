import { expect } from 'chai'
import { RemoteCommands } from '../src/services/remoteCommands.js'

/** A central server with a queue of pending commands; records what the shop reports back. */
function fakeCentral(commands) {
  const s = { commands, reports: [], mode: 'ok' }
  s.fetch = async (url, opts) => {
    const path = new URL(url).pathname
    if (s.mode === 'offline') throw new TypeError('fetch failed')
    if (opts.method === 'GET') {
      const out = s.commands; s.commands = []
      return { ok: true, status: 200, json: async () => out }
    }
    s.reports.push({ path, body: JSON.parse(opts.body || '{}'), auth: opts.headers.Authorization })
    return { ok: true, status: 200, json: async () => ({}) }
  }
  return s
}
const mk = (central, handlers, extra = {}) => new RemoteCommands({ handlers, url: 'http://central.test/api', apiKey: 'k', fetchImpl: central.fetch, ...extra })
const now = () => new Date().toISOString()

describe('RemoteCommands — connection state (kiosk badge, back-online catch-up)', () => {
  it('is online after an answer, goes offline after 20 s without one, and says so once each way', async () => {
    const c = fakeCentral([])
    const r = mk(c, {})
    const events = []
    r.on('online', () => events.push('online')).on('offline', () => events.push('offline'))
    expect(r.connection().online).to.equal(false) // nothing heard yet
    await r.poll()
    expect(r.connection().online).to.equal(true)
    expect(events).to.deep.equal([]) // the first answer is not a "came back"
    c.mode = 'offline'
    await r.poll()
    expect(r.connection().online).to.equal(true) // one missed poll is not an outage
    expect(events).to.deep.equal([])
    r.lastOkAt = Date.now() - 25_000 // 25 s of silence
    await r.poll()
    expect(r.connection().online).to.equal(false)
    expect(events).to.deep.equal(['offline'])
    await r.poll()
    expect(events).to.deep.equal(['offline']) // not repeated
    c.mode = 'ok'
    await r.poll()
    expect(r.connection().online).to.equal(true)
    expect(events).to.deep.equal(['offline', 'online'])
  })

  it('a standalone install (no central server) reports nothing to be offline from', () => {
    const r = new RemoteCommands({ url: '', apiKey: '' })
    expect(r.connection()).to.include({ enabled: false, online: null })
  })
})

describe('RemoteCommands — the central admin asks, the shop does', () => {
  it('is disabled without URL and key, and asks nothing', async () => {
    const c = fakeCentral([])
    const r = new RemoteCommands({ url: '', apiKey: '', fetchImpl: c.fetch })
    expect(await r.poll()).to.deep.equal([])
  })

  it('runs a start command with its payload, then reports it done', async () => {
    const c = fakeCentral([{ id: 'c1', type: 'start_machine', payload: { machineId: 'm1' }, createdAt: now() }])
    const seen = []
    const out = await mk(c, { start_machine: async (p) => { seen.push(p) } }).poll()
    expect(seen).to.deep.equal([{ machineId: 'm1' }])
    expect(out[0].error).to.equal('')
    expect(c.reports).to.have.length(1)
    expect(c.reports[0].path).to.equal('/api/sync/commands/c1/done')
    expect(c.reports[0].auth).to.equal('ApiKey k')
  })

  it('reports the reason when the machine refuses (not connected, no interface, ...)', async () => {
    const c = fakeCentral([{ id: 'c2', type: 'start_machine', payload: {}, createdAt: now() }])
    await mk(c, { start_machine: async () => { throw new Error('Lavar 2 has no interface/port configured') } }).poll()
    expect(c.reports[0].path).to.equal('/api/sync/commands/c2/fail')
    expect(c.reports[0].body.error).to.match(/no interface/)
  })

  it('fails a command it does not know instead of ignoring it', async () => {
    const c = fakeCentral([{ id: 'c3', type: 'reboot', createdAt: now() }])
    await mk(c, {}).poll()
    expect(c.reports[0].path).to.equal('/api/sync/commands/c3/fail')
    expect(c.reports[0].body.error).to.match(/Unsupported/)
  })

  it('never runs a stale "start the washer" — an old command is failed, not executed', async () => {
    const old = new Date(Date.now() - 10 * 60_000).toISOString()
    const c = fakeCentral([{ id: 'c4', type: 'start_machine', payload: { machineId: 'm1' }, createdAt: old }])
    let ran = false
    await mk(c, { start_machine: async () => { ran = true } }).poll()
    expect(ran).to.equal(false)
    expect(c.reports[0].path).to.equal('/api/sync/commands/c4/fail')
    expect(c.reports[0].body.error).to.match(/Expired/)
  })

  it('does nothing while the central server is unreachable', async () => {
    const c = fakeCentral([{ id: 'c5', type: 'start_machine', payload: {}, createdAt: now() }])
    c.mode = 'offline'
    expect(await mk(c, { start_machine: async () => { throw new Error('should not run') } }).poll()).to.deep.equal([])
    expect(c.reports).to.have.length(0)
  })
})

import { expect } from 'chai'
import { startTestDb, stopTestDb } from './setup.test-helper.js'
import Tenant from '../src/models/tenant.js'
import Setting from '../src/models/setting.js'
import { Middleware, SHOP_COIN_CODES, SHOP_BILL_CODES } from '../src/services/middleware.js'
import { Downlink } from '../src/services/downlink.js'

describe('Coin and bill recognition with no internet', function () {
  let tenant
  const saved = { enabled: process.env.LOWLEVEL_ENABLED }
  const clearTables = () => Setting.deleteMany({ key: { $in: ['coinEqTable', 'billEqTable'] } })

  before(async () => {
    await startTestDb()
    tenant = await Tenant.create({ name: 'Offline Tables', slug: `offt-${Date.now()}` })
  })
  after(async () => {
    await clearTables()
    await Tenant.deleteOne({ _id: tenant._id })
    if (saved.enabled === undefined) delete process.env.LOWLEVEL_ENABLED; else process.env.LOWLEVEL_ENABLED = saved.enabled
    await stopTestDb()
  })
  beforeEach(async () => { await clearTables(); process.env.LOWLEVEL_ENABLED = 'true' })

  const credits = (mw) => {
    const out = { inserted: [], rejected: [] }
    mw.on('coin-inserted', (e) => out.inserted.push(e.value))
    mw.on('bill-inserted', (e) => out.inserted.push(e.value))
    mw.on('coin-rejected', (e) => out.rejected.push(e.code))
    mw.on('bill-rejected', (e) => out.rejected.push(e.code))
    return out
  }

  it('a brand-new PC that never reached the server still knows the shop\'s coins and its 10 euro note', async () => {
    const mw = new Middleware()
    const out = credits(mw)
    await mw.loadEquivalenceTables()
    expect(mw.coinEqTable).to.deep.equal(SHOP_COIN_CODES)
    expect(mw.billEqTable).to.deep.equal(SHOP_BILL_CODES)
    mw.handleGatewayCredit({ data: '7' }, false) // 1 euro
    mw.handleGatewayCredit({ data: '8' }, false) // 2 euro
    mw.handleGatewayCredit({ data: '10' }, true) // 10 euro note
    expect(out.inserted).to.deep.equal([1, 2, 10])
  })

  it('still refuses a code nobody has measured, instead of guessing', async () => {
    const mw = new Middleware()
    const out = credits(mw)
    await mw.loadEquivalenceTables()
    mw.handleGatewayCredit({ data: '3' }, false)
    mw.handleGatewayCredit({ data: '20' }, true)
    expect(out.inserted).to.deep.equal([])
    expect(out.rejected).to.deep.equal(['3', '20'])
  })

  it('a table stored in the database always wins over the built-in codes', async () => {
    await Setting.create({ tenantId: tenant._id, key: 'coinEqTable', value: [{ key: '9', value: 5 }] })
    const mw = new Middleware()
    await mw.loadEquivalenceTables()
    expect(mw.coinEqTable).to.deep.equal({ '9': 5 })
    expect(mw.billEqTable).to.deep.equal(SHOP_BILL_CODES) // only the missing one falls back
  })

  it('without the controller (serial mode) nothing is invented', async () => {
    process.env.LOWLEVEL_ENABLED = 'false'
    const mw = new Middleware()
    await mw.loadEquivalenceTables()
    expect(mw.coinEqTable).to.equal(null)
  })

  it('tables pulled from the server stay on the PC: losing the internet changes nothing', async () => {
    const online = { ok: true, status: 200 }
    const data = {
      settings: [{ _id: '6ac822427079f7182faee199', tenantId: '6ac822427079f7182faee100', key: 'coinEqTable', value: [{ key: '7', value: 1 }, { key: '8', value: 2 }] }],
    }
    let offline = false
    const fetchImpl = async (url) => {
      if (offline) throw new TypeError('fetch failed')
      const name = new URL(url).pathname.split('/').pop()
      return { ...online, json: async () => data[name] ?? [] }
    }
    const dl = () => new Downlink({ tenantId: tenant._id, url: 'http://central.test/api', apiKey: 'k', fetchImpl })
    await dl().pullAll()
    offline = true
    expect(await dl().pullAll()).to.equal(false) // no internet: nothing happens
    const mw = new Middleware()
    await mw.loadEquivalenceTables()
    expect(mw.coinEqTable).to.deep.equal({ '7': 1, '8': 2 })
  })
})

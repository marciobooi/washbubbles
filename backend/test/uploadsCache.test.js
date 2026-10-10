import { expect } from 'chai'
import fs from 'fs'
import os from 'os'
import path from 'path'
import express from 'express'
import request from 'supertest'
import { fetchUpload, uploadsFetchThrough, prefetchUploads, contentTypeFor } from '../src/services/uploadsCache.js'
import Setting from '../src/models/setting.js'
import Tenant from '../src/models/tenant.js'
import { startTestDb, stopTestDb } from './setup.test-helper.js'

/** A central server that has some pictures and answers 404 (as an HTML page) for the rest. */
function fakeCentral(files) {
  const s = { calls: [], offline: false }
  s.fetch = async (url) => {
    s.calls.push(url)
    if (s.offline) throw new TypeError('fetch failed')
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop())
    if (files[name]) return { ok: true, status: 200, headers: { get: () => 'image/webp' }, arrayBuffer: async () => files[name] }
    return { ok: true, status: 200, headers: { get: () => 'text/html' }, arrayBuffer: async () => Buffer.from('<html>not found</html>') }
  }
  return s
}

describe('Pictures uploaded on the central server show on the shop PC (services/uploadsCache.js)', function () {
  let dir
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-')) })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))
  const PNG = Buffer.from('89504e470d0a1a0a', 'hex')

  it('fetches a missing picture once, keeps it, and then needs no internet', async () => {
    const c = fakeCentral({ 'logo.webp': PNG })
    const first = await fetchUpload('logo.webp', { uploadDir: dir, baseUrl: 'https://central.test/api', fetchImpl: c.fetch })
    expect(first).to.equal(path.join(dir, 'logo.webp'))
    expect(fs.readFileSync(first)).to.deep.equal(PNG)
    expect(c.calls).to.deep.equal(['https://central.test/uploads/logo.webp'])
    c.offline = true
    expect(await fetchUpload('logo.webp', { uploadDir: dir, baseUrl: 'https://central.test/api', fetchImpl: c.fetch })).to.equal(first)
    expect(c.calls).to.have.length(1) // served from disk, central not asked again
  })

  it('does nothing on the central server itself, offline, or for anything that is not a plain picture name', async () => {
    const c = fakeCentral({ 'a.webp': PNG })
    expect(await fetchUpload('a.webp', { uploadDir: dir, baseUrl: '', fetchImpl: c.fetch })).to.equal(null)
    for (const bad of ['../etc/passwd', 'a.webp/../../x', 'script.js', 'a b.webp', '..%2f..%2fx.png']) {
      expect(await fetchUpload(bad, { uploadDir: dir, baseUrl: 'https://central.test', fetchImpl: c.fetch }), bad).to.equal(null)
    }
    expect(c.calls).to.have.length(0)
    c.offline = true
    expect(await fetchUpload('a.webp', { uploadDir: dir, baseUrl: 'https://central.test', fetchImpl: c.fetch })).to.equal(null)
  })

  it('never saves an HTML page that answers for a missing file', async () => {
    const c = fakeCentral({})
    expect(await fetchUpload('gone.webp', { uploadDir: dir, baseUrl: 'https://central.test', fetchImpl: c.fetch })).to.equal(null)
    expect(fs.readdirSync(dir)).to.have.length(0)
  })

  it('the route serves a missing picture by fetching it, and a truly missing one falls through (404)', async () => {
    const c = fakeCentral({ 'banner.webp': PNG })
    const app = express()
    app.use('/uploads', express.static(dir))
    app.use('/uploads', uploadsFetchThrough({ uploadDir: dir, baseUrl: () => 'https://central.test/api', fetchImpl: c.fetch }))
    const ok = await request(app).get('/uploads/banner.webp')
    expect(ok.status).to.equal(200)
    expect(ok.headers['content-type']).to.match(/image\/webp/)
    expect((await request(app).get('/uploads/nothing.webp')).status).to.equal(404)
    expect(contentTypeFor('x.JPG')).to.equal('image/jpeg')
  })
})

describe('Pre-fetching the pictures the settings mention', function () {
  let tenant, dir
  before(async () => { await startTestDb(); tenant = await Tenant.create({ name: 'Uploads', slug: `up-${Date.now()}` }) })
  after(async () => { await Setting.deleteMany({ tenantId: tenant._id }); await Tenant.deleteOne({ _id: tenant._id }); await stopTestDb() })
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-')) })
  afterEach(async () => { fs.rmSync(dir, { recursive: true, force: true }); await Setting.deleteMany({ tenantId: tenant._id }) })

  it('finds the logo and the banner images in any setting and fetches those it does not have yet', async () => {
    await Setting.create({ tenantId: tenant._id, key: 'branding.logo', value: '/uploads/111-logo.webp' })
    await Setting.create({ tenantId: tenant._id, key: 'banners', value: [{ title: 'A', image: '/uploads/222-dry.webp' }, { title: 'B', image: '/assets/local.png' }] })
    fs.writeFileSync(path.join(dir, '111-logo.webp'), PNGX) // already here
    const c = fakeCentral({ '222-dry.webp': PNGX })
    const got = await prefetchUploads({ SettingModel: Setting, tenantId: tenant._id, uploadDir: dir, baseUrl: 'https://central.test/api', fetchImpl: c.fetch })
    expect(got).to.equal(1)
    expect(fs.existsSync(path.join(dir, '222-dry.webp'))).to.equal(true)
    expect(c.calls).to.deep.equal(['https://central.test/uploads/222-dry.webp'])
  })
})
describe('When the admin changes a picture', function () {
  let tenant, dir
  before(async () => { await startTestDb(); tenant = await Tenant.create({ name: 'Uploads Change', slug: `upc-${Date.now()}` }) })
  after(async () => { await Setting.deleteMany({ tenantId: tenant._id }); await Tenant.deleteOne({ _id: tenant._id }); await stopTestDb() })
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-')) })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('a new upload has a new name, so the next sync fetches it and keeps showing the old one until then', async () => {
    const c = fakeCentral({ '100-old.webp': PNGX, '200-new.webp': PNGX })
    const opts = { SettingModel: Setting, tenantId: tenant._id, uploadDir: dir, baseUrl: 'https://central.test/api', fetchImpl: c.fetch }
    await Setting.create({ tenantId: tenant._id, key: 'branding.logo', value: '/uploads/100-old.webp' })
    expect(await prefetchUploads(opts)).to.equal(1)

    await Setting.updateOne({ tenantId: tenant._id, key: 'branding.logo' }, { value: '/uploads/200-new.webp' }) // the admin uploads a new logo
    c.offline = true // ...but the internet is down at the next sync
    expect(await prefetchUploads(opts)).to.equal(0)
    expect(fs.existsSync(path.join(dir, '100-old.webp'))).to.equal(true) // the old picture is still there to show

    c.offline = false // internet is back: the next sync gets it
    expect(await prefetchUploads(opts)).to.equal(1)
    expect(fs.existsSync(path.join(dir, '200-new.webp'))).to.equal(true)
  })
})
const PNGX = Buffer.from('89504e470d0a1a0a', 'hex')

import { expect } from 'chai'
import request from 'supertest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'
import { buildInstaller } from '../src/services/installerFile.js'

describe('Installing a post: the file for the customer, the download and the report', function () {
  this.timeout(60000)
  let app, superTok, storeId, key, User, Tenant, rel
  before(async () => {
    rel = fs.mkdtempSync(path.join(os.tmpdir(), 'release-'))
    fs.writeFileSync(path.join(rel, 'app.zip'), Buffer.alloc(200000, 1))
    fs.writeFileSync(path.join(rel, 'version.txt'), 'abc1234def\n')
    process.env.RELEASE_DIR = rel
    await startTestDb(); await clearTestDb()
    app = await buildTestApp()
    const { admin } = await seedTenantAndUsers()
    User = (await import('../src/models/user.js')).default
    Tenant = (await import('../src/models/tenant.js')).default
    await Tenant.init()
    superTok = signToken(admin)
    const r = await request(app).post('/api/admin/stores').set('Authorization', `Bearer ${superTok}`).send({ name: 'Lavandaria Áurea', customerEmail: 'a@b.pt' })
    storeId = r.body.tenant._id
  })
  after(async () => { delete process.env.RELEASE_DIR; fs.rmSync(rel, { recursive: true, force: true }); await stopTestDb() })

  it('the installer is ONE .bat (ASCII up to its exit line) that carries the shop\'s settings and the PowerShell', () => {
    const bat = buildInstaller({ shopName: 'Lavandaria Áurea', slug: 'aurea', serverUrl: 'https://x.pt/api', key: 'k', supportEmail: 's@x.pt', hardware: { pcIp: '1.1.1.1', controllerHost: '1.1.1.2', controllerPort: 1 } })
    expect(/^[\x00-\x7F]*$/.test(bat.split('#PS-START')[0])).to.equal(true) // what cmd.exe reads
    expect(bat).to.match(/^@echo off\r\n/)
    expect(bat).to.include("#PS-START\r\n$ConfigB64 = '")
    expect(bat.split("'#PS'+'-START'").length).to.equal(2) // the marker is only matched at the real marker line
    const b64 = bat.match(/\$ConfigB64 = '([^']+)'/)[1]
    expect(JSON.parse(Buffer.from(b64, 'base64').toString('utf8')).shopName).to.equal('Lavandaria Áurea')
    expect(bat).to.include('INSTALAÇÃO CONCLUÍDA') // the friendly final screen, with its accents
  })

  it('"Gerar instalação" creates the shop\'s post, stages its key inside the file only, and the key then works', async () => {
    const r = await request(app).post(`/api/admin/stores/${storeId}/installation`).set('Authorization', `Bearer ${superTok}`).send({ hardware: { pcIp: '192.168.2.190', controllerHost: '192.168.2.201', controllerPort: 16852 } })
    expect(r.status).to.equal(200)
    expect(r.headers['content-disposition']).to.include('Instalar-lavandaria-aurea.bat')
    const b64 = r.text.match(/\$ConfigB64 = '([^']+)'/)[1]
    const cfg = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
    key = cfg.key
    expect(cfg.tenantId).to.equal(storeId)
    const kiosk = await User.findOne({ tenantId: storeId, role: 'KIOSK' }).lean()
    expect(kiosk.apiKey).to.equal(null) // staged, not active yet
    expect(kiosk.apiKeyNext).to.equal(key)
    // first use promotes it: version + bundle
    const v = await request(app).get('/api/installer/version').set('Authorization', `ApiKey ${key}`)
    expect(v.status).to.equal(200)
    expect(v.body.version).to.equal('abc1234def')
    const b = await request(app).get('/api/installer/bundle').set('Authorization', `ApiKey ${key}`)
    expect(b.status).to.equal(200)
    expect(b.headers['content-type']).to.equal('application/zip')
    expect(Number(b.headers['content-length'])).to.equal(200000)
    expect((await User.findOne({ tenantId: storeId, role: 'KIOSK' }).lean()).apiKey).to.equal(key)
  })

  it('no key, a wrong key, or a non-kiosk user gets nothing; a report lands in that shop\'s audit trail', async () => {
    expect((await request(app).get('/api/installer/bundle')).status).to.equal(401)
    expect((await request(app).get('/api/installer/bundle').set('Authorization', 'ApiKey nope')).status).to.equal(401)
    expect((await request(app).get('/api/installer/bundle').set('Authorization', `Bearer ${superTok}`)).status).to.equal(403)
    const rep = await request(app).post('/api/installer/report').set('Authorization', `ApiKey ${key}`).send({ ok: false, message: 'NET: sem internet', machine: 'PC1', log: 'x'.repeat(20000) })
    expect(rep.status).to.equal(200)
    const AuditLog = (await import('../src/models/auditLog.js')).default
    const row = await AuditLog.findOne({ tenantId: storeId, action: 'installer.failed' }).lean()
    expect(row.details.message).to.equal('NET: sem internet')
    expect(row.details.log.length).to.equal(8000)
  })

  it('generating again for a shop that already has a post keeps the old key working until the new one connects', async () => {
    const again = await request(app).post(`/api/admin/stores/${storeId}/installation`).set('Authorization', `Bearer ${superTok}`).send({})
    const cfg2 = JSON.parse(Buffer.from(again.text.match(/\$ConfigB64 = '([^']+)'/)[1], 'base64').toString('utf8'))
    expect(cfg2.key).to.not.equal(key)
    expect((await request(app).get('/api/installer/version').set('Authorization', `ApiKey ${key}`)).status).to.equal(200) // old PC still fine
  })
})

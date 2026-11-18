import { expect } from 'chai'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'
import { alertTypeOf, ALERT_TYPES, effectivePrefs } from '../src/services/alertTypes.js'

// The subject of every alert the system sends today: each must belong to a type the admin can switch.
const SUBJECTS = [
  'Erro no ecrã do quiosque', 'Falta de troco: cliente por pagar', 'Avaria — Lavar 3 não enche', 'Cliente pagou e a máquina não arrancou',
  'Reembolso: falta pagar dinheiro ao cliente', 'Quiosque offline', 'Quiosque online outra vez', 'Blocos pagos e não entregues: Secar 8',
  'Moeda não reconhecida pelo moedeiro', 'O moedeiro pode estar mudo', 'Periférico sem resposta: bill-acceptor', 'Arranque sem confirmação: Lavar 5',
  'Dinheiro de cliente retido na máquina', 'Cópia de segurança falhou', 'Sincronização: registo recusado pelo servidor central',
  'MB WAY: o pedido pode ter sido criado', 'MB WAY pago mas o cartão não foi tratado', 'MB WAY pago mas a máquina não arrancou',
  'MB WAY: estado desconhecido no Eupago', 'MB WAY pago depois de cancelado', 'MB WAY pago e por confirmar',
  'Controlador desligado', 'Controlador reiniciado - verificar leitor de notas', 'Controlador voltou a responder', 'URGENTE: controlador sem resposta - as máquinas não arrancam',
  'Cartão desconhecido recusado', 'Cartão desconhecido aceite com saldo', 'Cartão com saldo a mais no chip', 'PIN de staff expirado', 'O PIN de staff expira amanhã',
]

describe('Alert choices (what the admin receives by e-mail)', function () {
  this.timeout(20000)
  let app, tenant, admin
  before(async () => { await startTestDb(); app = await buildTestApp() })
  after(async () => { await stopTestDb() })
  beforeEach(async () => { await clearTestDb(); ({ tenant, admin } = await seedTenantAndUsers()) })

  it('every alert the system sends today is on the list (so every one can be switched)', () => {
    for (const s of SUBJECTS) expect(alertTypeOf(s), s).to.not.equal(null)
    expect(new Set(ALERT_TYPES.map((t) => t.key)).size).to.equal(ALERT_TYPES.length) // no repeated key
  })

  it('defaults: the noisy ones are off, the money ones are on, an alert nobody listed is always sent', async () => {
    const { alertEnabled } = await import('../src/services/alerts.js')
    expect(await alertEnabled(tenant._id, 'Quiosque online outra vez')).to.equal(false)
    expect(await alertEnabled(tenant._id, 'PIN de staff expirado')).to.equal(false)
    expect(await alertEnabled(tenant._id, 'Cliente pagou e a máquina não arrancou')).to.equal(true)
    expect(await alertEnabled(tenant._id, 'Um alerta novo qualquer')).to.equal(true)
    expect(await alertEnabled(tenant._id, 'report.dayClose', 'report.dayClose')).to.equal(true)
  })

  it('the admin\'s choices are saved, listed and respected (and only an admin may change them)', async () => {
    const token = signToken(admin)
    let r = await request(app).get('/api/admin/alerts/catalog').set('Authorization', `Bearer ${token}`)
    expect(r.status).to.equal(200)
    expect(r.body.groups.length).to.be.greaterThan(3)
    expect(r.body.types.find((t) => t.key === 'kiosk.online').defaultOn).to.equal(false)
    expect(r.body.types[0].match).to.equal(undefined) // the screen gets no regular expressions
    expect(r.body.prefs['kiosk.online']).to.equal(false)

    r = await request(app).put('/api/admin/alerts/prefs').set('Authorization', `Bearer ${token}`).send({ prefs: { 'kiosk.online': true, 'coin.mute': false, 'report.dayClose': false, 'not.a.key': false } })
    expect(r.status).to.equal(200)
    expect(r.body.prefs['kiosk.online']).to.equal(true)
    expect(r.body.prefs['coin.mute']).to.equal(false)

    const { alertEnabled } = await import('../src/services/alerts.js')
    expect(await alertEnabled(tenant._id, 'Quiosque online outra vez')).to.equal(true)
    expect(await alertEnabled(tenant._id, 'O moedeiro pode estar mudo')).to.equal(false)
    expect(await alertEnabled(tenant._id, 'report.dayClose', 'report.dayClose')).to.equal(false)

    const bad = await request(app).put('/api/admin/alerts/prefs').set('Authorization', `Bearer ${token}`).send({})
    expect(bad.status).to.equal(400)
    expect(effectivePrefs({ 'coin.mute': false })['coin.mute']).to.equal(false)
  })

  it('an alert that is switched off sends no e-mail; one that is on does', async () => {
    const Setting = (await import('../src/models/setting.js')).default
    await Setting.create({ tenantId: tenant._id, key: 'alerts.email', value: 'dono@example.com' })
    await Setting.create({ tenantId: tenant._id, key: 'alerts.prefs', value: { 'coin.mute': false } })
    const { sendAlertForTenant, resetAlertPrefsCache } = await import('../src/services/alerts.js')
    resetAlertPrefsCache()
    const lines = []
    const log = console.log; console.log = (...a) => { lines.push(a.join(' ')); log(...a) }
    try {
      await sendAlertForTenant(tenant._id, 'O moedeiro pode estar mudo', 'x')
      await sendAlertForTenant(tenant._id, 'Moeda não reconhecida pelo moedeiro', 'y')
    } finally { console.log = log }
    expect(lines.some((l) => /"O moedeiro pode estar mudo" not sent: switched off/.test(l))).to.equal(true)
    expect(lines.some((l) => /"Moeda não reconhecida pelo moedeiro" not sent/.test(l))).to.equal(false)
  })
})

import express from 'express'
import crypto from 'crypto'
import rateLimit from 'express-rate-limit'
import { limitKey } from '../middleware/limitKey.js'
import MbwayLink from '../models/mbwayLink.js'
import { requireKiosk } from '../middleware/auth.js'
import { normalizePhone } from '../services/eupago.js'
import { escapeHtml } from '../services/emailTemplate.js'
import { logAction } from '../services/auditLog.js'

// The trail of every QR code: made, opened on a phone, number sent, given up, expired. The phone number is NEVER written and only the start
// of the token is, so the page of one code can be told from another without the code being usable from the log.
const audit = (tenantId, action, token, details) => logAction({ tenantId }, action, 'MbwayLink', String(token).slice(0, 8), details)
const ageSec = (link) => Math.max(0, Math.round((Date.now() - new Date(link.createdAt).getTime()) / 1000))
const TTL_MS = 5 * 60 * 1000   // the QR lives as long as the customer has to approve: one session
import { publicSiteFor } from '../services/landingBase.js'

// ---- shop side (kiosk key): create the link, pick the number up once ------------------------------------------------------------
export const shopRouter = express.Router()

shopRouter.post('/create', requireKiosk, async (req, res) => {
  const amount = Number(req.body?.amount)
  if (!(amount > 0) || amount > 1000) return res.status(400).json({ error: 'Invalid amount' })
  const machines = (Array.isArray(req.body?.machines) ? req.body.machines : []).map((m) => String(m).slice(0, 40)).slice(0, 12)
  const token = crypto.randomBytes(18).toString('base64url')
  const doc = await MbwayLink.create({ token, tenantId: req.tenantId, amount: Math.round(amount * 100) / 100, machines, expiresAt: new Date(Date.now() + TTL_MS) })
  audit(req.tenantId, 'mbway.qr_created', token, { amount: doc.amount, machines })
  res.status(201).json({ token, url: `${await publicSiteFor(req.tenantId)}/pagar/${token}`, expiresAt: doc.expiresAt })
})

// The kiosk gives the code up (back, cancel, error, retry, screen closed): it can never be used again and the number, if any, is wiped.
shopRouter.post('/:token/cancel', requireKiosk, async (req, res) => {
  const was = await MbwayLink.findOneAndUpdate({ token: req.params.token, tenantId: req.tenantId, status: { $in: ['waiting', 'phone_received'] } }, { $set: { status: 'cancelled', phone: '' } }, { new: false })
  if (was) audit(req.tenantId, 'mbway.qr_cancelled', was.token, { amount: was.amount, machines: was.machines, after: ageSec(was), wasStatus: was.status, why: 'the kiosk gave the code up (back, retry, error or screen closed)' })
  res.json({ ok: true })
})

// The number is handed over ONCE and wiped.
shopRouter.get('/:token/phone', requireKiosk, async (req, res) => {
  const link = await MbwayLink.findOne({ token: req.params.token, tenantId: req.tenantId })
  if (!link) return res.status(404).json({ status: 'not-found' })
  if (link.expiresAt.getTime() < Date.now() && link.status !== 'phone_received') {
    const gone = await MbwayLink.findOneAndUpdate({ _id: link._id, status: 'waiting' }, { $set: { status: 'cancelled' } }, { new: false })
    if (gone) audit(req.tenantId, 'mbway.qr_expired', link.token, { amount: link.amount, machines: link.machines, opened: false, note: 'nobody sent a number before the code expired' })
    return res.json({ status: 'expired' })
  }
  if (link.status !== 'phone_received') return res.json({ status: link.status })
  const taken = await MbwayLink.findOneAndUpdate({ _id: link._id, status: 'phone_received' }, { $set: { status: 'consumed', phone: '' } }, { new: false })
  if (!taken) return res.json({ status: 'consumed' })
  audit(req.tenantId, 'mbway.qr_number_taken', link.token, { amount: link.amount, machines: link.machines, after: ageSec(link) })
  res.json({ status: 'phone_received', phone: taken.phone })
})

// ---- the customer's phone (public) ----------------------------------------------------------------------------------------------
export const publicRouter = express.Router()
const limiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts' }, keyGenerator: limitKey })

const T = {
  pt: { title: 'Pagar com MB WAY', pay: 'A pagar', phone: 'Número de telemóvel do MB WAY', send: 'Pagar', sending: 'A enviar…', done: 'Pedido enviado. Aprove o pagamento na app MB WAY (tem 5 minutos). A máquina arranca sozinha. Pode fechar esta página.', bad: 'Número inválido: escreva os 9 dígitos do telemóvel.', gone: 'Este código já foi usado ou expirou. Volte ao quiosque e peça um novo.', err: 'Não foi possível enviar. Tente de novo.' },
  en: { title: 'Pay with MB WAY', pay: 'To pay', phone: 'Your MB WAY mobile number', send: 'Pay', sending: 'Sending…', done: 'Request sent. Approve the payment in the MB WAY app (you have 5 minutes). The machine starts by itself. You can close this page.', bad: 'Invalid number: enter the 9 digits of your mobile.', gone: 'This code was already used or has expired. Go back to the kiosk for a new one.', err: 'Could not send. Please try again.' },
}

publicRouter.get('/pagar/:token', limiter, async (req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' })
  const lang = String(req.headers['accept-language'] || '').toLowerCase().startsWith('pt') ? 'pt' : 'en'
  const t = T[lang]
  const link = await MbwayLink.findOne({ token: String(req.params.token) }).lean()
  const live = link && link.status === 'waiting' && link.expiresAt.getTime() > Date.now()
  if (link) audit(link.tenantId, 'mbway.qr_opened', link.token, { live: !!live, status: link.status, after: ageSec(link), phoneType: String(req.headers['user-agent'] || '').slice(0, 120) })
  const money = link ? `${link.amount.toFixed(2).replace('.', lang === 'pt' ? ',' : '.')} €` : ''
  res.status(live ? 200 : 410).type('html').send(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${t.title}</title>
<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f0f8f5;color:#0f2a27}main{max-width:440px;margin:0 auto;padding:28px 20px}h1{font-size:26px;margin:0 0 6px}.amt{font-size:40px;font-weight:800;margin:10px 0 4px}.m{color:#3d6a63;margin-bottom:22px}label{display:block;font-weight:600;margin-bottom:8px}input{width:100%;box-sizing:border-box;font-size:28px;padding:14px;border:2px solid #cfe5df;border-radius:14px;letter-spacing:2px}button{width:100%;margin-top:16px;font-size:22px;font-weight:700;padding:16px;border:0;border-radius:14px;background:#d3101c;color:#fff}button:disabled{opacity:.5}.msg{margin-top:18px;padding:14px;border-radius:12px;font-size:17px}.ok{background:#e0f6ea}.no{background:#fde8e8;color:#8a1c1c}</style></head><body><main>
<h1>MB WAY</h1>${live ? `<div class="amt">${escapeHtml(money)}</div><div class="m">${escapeHtml((link.machines || []).join(', '))}</div>
<form id="f"><label for="p">${t.phone}</label><input id="p" type="tel" inputmode="numeric" autocomplete="tel" maxlength="16" placeholder="9•• ••• •••" required><button id="b" type="submit">${t.send}</button></form><div id="r"></div>
<script>const f=document.getElementById('f'),r=document.getElementById('r'),b=document.getElementById('b');f.addEventListener('submit',async e=>{e.preventDefault();b.disabled=true;b.textContent=${JSON.stringify(t.sending)};r.innerHTML='';try{const x=await fetch('/api/public/mbway-link/'+${JSON.stringify(String(req.params.token))},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:document.getElementById('p').value})});if(x.ok){f.style.display='none';r.innerHTML='<div class="msg ok">'+${JSON.stringify(t.done)}+'</div>'}else{b.disabled=false;b.textContent=${JSON.stringify(t.send)};r.innerHTML='<div class="msg no">'+(x.status===400?${JSON.stringify(t.bad)}:x.status===410?${JSON.stringify(t.gone)}:${JSON.stringify(t.err)})+'</div>'}}catch(_){b.disabled=false;b.textContent=${JSON.stringify(t.send)};r.innerHTML='<div class="msg no">'+${JSON.stringify(t.err)}+'</div>'}});</script>` : `<div class="msg no">${t.gone}</div>`}
</main></body></html>`)
})

publicRouter.post('/api/public/mbway-link/:token', limiter, async (req, res) => {
  const phone = normalizePhone(req.body?.phone)
  if (!phone) {
    const l = await MbwayLink.findOne({ token: String(req.params.token) }).select('tenantId token').lean()
    if (l) audit(l.tenantId, 'mbway.qr_number_refused', l.token, { why: 'the number typed on the phone is not a valid mobile number' })
    return res.status(400).json({ error: 'Invalid phone number' })
  }
  const link = await MbwayLink.findOneAndUpdate(
    { token: String(req.params.token), status: 'waiting', expiresAt: { $gt: new Date() } },
    { $set: { status: 'phone_received', phone } }, { new: true })
  if (!link) {
    const l = await MbwayLink.findOne({ token: String(req.params.token) }).select('tenantId token status').lean()
    if (l) audit(l.tenantId, 'mbway.qr_number_refused', l.token, { why: 'the code was already used, cancelled or expired', status: l.status })
    return res.status(410).json({ error: 'Used or expired' })
  }
  audit(link.tenantId, 'mbway.qr_number_sent', link.token, { amount: link.amount, machines: link.machines, after: ageSec(link) })
  res.json({ ok: true })
})

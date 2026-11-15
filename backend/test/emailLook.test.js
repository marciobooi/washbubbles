import { expect } from 'chai'
import fs from 'fs'
import { renderEmailHtml, emailButton } from '../src/services/emailTemplate.js'
import * as K from '../src/services/emailKit.js'

// One sample of each kind of e-mail in the shared look, for a person to look at (EMAIL_PREVIEW_DIR) and for the structure to be checked.
describe('The shared e-mail look', () => {
  const brand = { name: 'Fresh Bubbles', address: 'Av. Dr. António Carvalho de Figueiredo 35A, 2670-407 Loures', phone: '+351 912 715 258', email: 'marcacoes@freshbubbles.pt', tagline: 'Laundry & Ironing' }
  const samples = {
    reset: renderEmailHtml({ title: 'Redefinir palavra-passe', preheader: 'x', brand, bodyHtml: `<p>Pediu para redefinir a palavra-passe.</p>${emailButton('Escolher nova palavra-passe', 'https://freshbubbles.pt/reset-password?token=x')}<p style="font-size:13px;color:#64748b;">Se não foi você, ignore este email.</p>` }),
    receipt: renderEmailHtml({ title: 'O seu recibo', brand, bodyHtml: `<div style="font-size:13px;color:#64748b;margin-bottom:16px;">15 de novembro de 2026, 11:02</div>${K.boxRow([K.kpi({ label: 'Total pago', value: '10,50', tone: 'teal', width: '100%' })], 0)}<div style="margin-top:20px;">${K.kv([['Lavar 1', '10,50 €']])}</div><p style="margin:24px 0 0;text-align:center;color:#64748b;">Obrigado pela sua visita!</p>` }),
    alert: renderEmailHtml({ title: 'Arranque sem confirmação: Secar 7', brand, bodyHtml: `<div style="margin-bottom:14px;">${K.badge('Atenção', 'amber')}<span style="font-size:12px;color:#94a3b8;margin-left:10px;">15 de novembro, 11:02</span></div>${K.note({ tone: 'amber', html: '<div style="font-size:14px;line-height:1.7;color:#0f172a;">O controlador não confirmou o arranque de Secar 7.<br>Confirme se a máquina está a trabalhar.</div>' })}` }),
  }
  it('every message sits in one white card with the brand header and the contact footer', () => {
    for (const [name, html] of Object.entries(samples)) {
      expect(html, name).to.include('Fresh Bubbles').and.include('Loures').and.include('border-radius:24px')
    }
  })
  it('writes samples for a person to look at', () => {
    if (!process.env.EMAIL_PREVIEW_DIR) return
    fs.mkdirSync(process.env.EMAIL_PREVIEW_DIR, { recursive: true })
    for (const [name, html] of Object.entries(samples)) fs.writeFileSync(`${process.env.EMAIL_PREVIEW_DIR}/${name}.html`, html)
  })
})

import { expect } from 'chai'
import { renderEmailHtml } from '../src/services/emailTemplate.js'

describe('email uses the shop\'s own branding', () => {
  it('shows the logo, name and contact set in the admin', () => {
    const html = renderEmailHtml({
      title: 'O seu recibo', bodyHtml: '<p>x</p>',
      brand: { logo: 'https://freshbubbles.pt/uploads/logo-novo.webp', name: 'Lavandaria Teste', address: 'Rua A 1', phone: '+351 900 000 000', email: 'loja@teste.pt' },
    })
    expect(html).to.contain('https://freshbubbles.pt/uploads/logo-novo.webp')
    expect(html).to.contain('Lavandaria Teste')
    expect(html).to.contain('Rua A 1')
    expect(html).to.contain('loja@teste.pt')
    expect(html).to.not.contain('freshbubbleslogo.png')
  })
  it('falls back to the built-in brand for whatever is missing', () => {
    const html = renderEmailHtml({ title: 'T', bodyHtml: '<p>x</p>', brand: { logo: '', name: '' } })
    expect(html).to.contain('freshbubbleslogo.png')
    expect(html).to.contain('Fresh Bubbles')
  })
  it('escapes what the admin typed', () => {
    const html = renderEmailHtml({ title: 'T', bodyHtml: '', brand: { name: '<script>x</script>' } })
    expect(html).to.not.contain('<script>x</script>')
  })
})

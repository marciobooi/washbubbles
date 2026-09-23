import { expect } from 'chai'
import { renderEmailHtml, emailButton, escapeHtml, escapeHtmlMultiline } from '../src/services/emailTemplate.js'

describe('emailTemplate', () => {
  describe('escapeHtml', () => {
    it('escapes the five HTML-significant characters', () => {
      expect(escapeHtml(`<b>"O's & Co"</b>`)).to.equal('&lt;b&gt;&quot;O&#39;s &amp; Co&quot;&lt;/b&gt;')
    })
  })

  describe('escapeHtmlMultiline', () => {
    it('escapes HTML and turns newlines into <br>, in that order (a literal "<br>" in the input stays escaped text, not a real line break)', () => {
      expect(escapeHtmlMultiline('Line one\nLine <two>')).to.equal('Line one<br>Line &lt;two&gt;')
    })
  })

  describe('emailButton', () => {
    it('escapes both the label and the href', () => {
      const html = emailButton('Reset "password" & go', 'https://example.com/?a=1&b=2')
      expect(html).to.include('href="https://example.com/?a=1&amp;b=2"')
      expect(html).to.include('Reset &quot;password&quot; &amp; go')
      // Table-based, not a bare <a>/<button> — the whole point is Outlook
      // desktop compatibility, which ignores most CSS on real buttons/links.
      expect(html).to.include('<table')
    })
  })

  describe('renderEmailHtml', () => {
    it('includes the real logo, brand name, and real contact facts in the footer', () => {
      const html = renderEmailHtml({ title: 'Hello', bodyHtml: '<p>Hi</p>' })
      expect(html).to.include('src="https://freshbubbles.pt/geral/freshbubbleslogo.png"')
      expect(html).to.include('Fresh Bubbles')
      expect(html).to.include('Av. Dr. António Carvalho de Figueiredo 35A')
      expect(html).to.include('+351 912 715 258')
      expect(html).to.include('href="mailto:marcacoes@freshbubbles.pt"')
    })

    it('honours PUBLIC_SITE_URL for the logo, matching the public landing page\'s own override', async () => {
      const prev = process.env.PUBLIC_SITE_URL
      process.env.PUBLIC_SITE_URL = 'https://staging.example.test'
      try {
        const mod = await import(`../src/services/emailTemplate.js?t=${Date.now()}`)
        expect(mod.renderEmailHtml({ bodyHtml: '<p>x</p>' })).to.include('src="https://staging.example.test/geral/freshbubbleslogo.png"')
      } finally {
        if (prev === undefined) delete process.env.PUBLIC_SITE_URL
        else process.env.PUBLIC_SITE_URL = prev
      }
    })

    it('escapes the title and preheader (both come from callers, e.g. a marketing broadcast subject)', () => {
      const html = renderEmailHtml({ title: '<script>x</script>', preheader: '<b>peek</b>', bodyHtml: '<p>ok</p>' })
      expect(html).to.not.include('<script>x</script>')
      expect(html).to.include('&lt;script&gt;x&lt;/script&gt;')
      expect(html).to.not.include('<b>peek</b>')
      expect(html).to.include('&lt;b&gt;peek&lt;/b&gt;')
    })

    it('drops the preheader block entirely when none is given, rather than rendering an empty one', () => {
      const html = renderEmailHtml({ title: 'Hi', bodyHtml: '<p>ok</p>' })
      expect(html).to.not.include('max-height:0')
    })

    it('passes bodyHtml through untouched — callers own escaping their own dynamic content', () => {
      const html = renderEmailHtml({ bodyHtml: '<p>already-built <strong>html</strong></p>' })
      expect(html).to.include('<p>already-built <strong>html</strong></p>')
    })

    it('table-based layout throughout — no flexbox/grid, which Outlook desktop does not support', () => {
      const html = renderEmailHtml({ title: 'Hi', bodyHtml: '<p>ok</p>' })
      expect(html).to.not.match(/display:\s*flex/)
      expect(html).to.not.match(/display:\s*grid/)
      expect(html).to.include('<table')
    })
  })
})

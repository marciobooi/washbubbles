/**
 * Public marketing routes — the server-rendered front page, robots.txt and
 * sitemap.xml. See src/views/landing.js for why this isn't part of the React
 * SPA.
 *
 * Mounted only when PUBLIC_LANDING_PAGE=true (index.js) — unset everywhere
 * else (local dev, the shop-kiosk install) so "/" keeps meaning what it
 * already means there (the kiosk POS app, or nothing at all).
 */
import express from 'express'
import { renderLandingPage, renderRobotsTxt, renderSitemapXml } from '../views/landing.js'

const router = express.Router()

router.get('/', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300') // 5 min — plain content, changes rarely
  res.type('html').send(renderLandingPage())
})

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(renderRobotsTxt())
})

router.get('/sitemap.xml', (req, res) => {
  res.type('application/xml').send(renderSitemapXml())
})

export default router

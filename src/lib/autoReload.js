// The shop PC updates itself (scripts/kiosk-update.ps1) and never closes the kiosk browser. Instead the screen
// notices that a new build is on the server and reloads itself once nobody is touching it. It looks:
//   - every 15 s,
//   - the moment the link to the shop's backend comes back (an update restarts the backend), see checkForUpdateNow(),
//   - when the admin presses "Atualizar o ecrã do quiosque" (a `screen:reload` message), see reloadWhenIdle().
const CHECK_EVERY_MS = 15 * 1000
const IDLE_HOME_MS = 10 * 1000   // on the home screen
const IDLE_ELSEWHERE_MS = 90 * 1000   // in the middle of a purchase: wait longer

const KIOSK_PATH = /^\/(pos)?\/?$|^\/pos\//

function builtScript(html) {
  const m = /<script[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"/.exec(html)
  return m ? m[1] : null
}

let tick = null
let wantReload = false
export const checkForUpdateNow = () => { if (tick) tick() }
/** Reload as soon as nobody is touching the screen (used by the admin's remote refresh). */
export const reloadWhenIdle = () => { wantReload = true; if (tick) tick() }

export function startAutoReload() {
  if (typeof window === 'undefined' || import.meta.env.DEV) return
  const current = document.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute('src')
  if (!current) return
  let lastTouch = Date.now()
  const touch = () => { lastTouch = Date.now() }
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, touch, { passive: true, capture: true })

  let newer = false
  let busy = false
  tick = async () => {
    if (busy) return
    const path = window.location.pathname
    if (!KIOSK_PATH.test(path)) return   // never reload the admin pages while staff type
    busy = true
    try {
      if (!newer && !wantReload) {
        const res = await fetch('/', { cache: 'no-store' })
        if (!res.ok) return
        const next = builtScript(await res.text())
        if (!next || next === current) return
        newer = true
      }
      const home = /^\/(pos)?\/?$/.test(path)
      const idle = Date.now() - lastTouch
      if (idle >= (home ? IDLE_HOME_MS : IDLE_ELSEWHERE_MS)) window.location.reload()
    } catch { /* offline: try again later */ } finally { busy = false }
  }
  setInterval(tick, CHECK_EVERY_MS)
}

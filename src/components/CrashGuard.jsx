import React from 'react'
import { isKioskScreen } from '@/lib/kioskContext'

/**
 * A render error must never leave a customer in front of a white screen. The guard shows a plain "restarting" screen and reloads
 * the page by itself (at most 3 times in 10 minutes; then it asks for the staff), and tells the server what broke so it is seen
 * and fixed (POST /api/pos/client-error: audit trail + e-mail to the shop's support address).
 */
const KEY = 'crashguard.reloads'
const readReloads = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || '[]').filter((t) => Date.now() - t < 10 * 60_000) } catch { return [] } }

function report(error, info) {
  try {
    const kioskKey = window?.electronAPI?.kioskKey?.() || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY
    if (!kioskKey || !isKioskScreen()) return
    fetch('/api/pos/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `ApiKey ${kioskKey}` },
      body: JSON.stringify({ message: String(error?.message || error).slice(0, 400), stack: String(error?.stack || '').slice(0, 1500), component: String(info?.componentStack || '').slice(0, 800), page: window.location.pathname }),
      keepalive: true,
    }).catch(() => {})
  } catch { /* reporting must never throw */ }
}

export default class CrashGuard extends React.Component {
  state = { crashed: false, tooMany: false }

  static getDerivedStateFromError() { return { crashed: true } }

  componentDidCatch(error, info) {
    console.error('[CrashGuard]', error, info?.componentStack)
    report(error, info)
    const recent = readReloads()
    if (recent.length >= 3) { this.setState({ tooMany: true }); return }
    try { sessionStorage.setItem(KEY, JSON.stringify([...recent, Date.now()])) } catch { /* private mode */ }
    this.timer = setTimeout(() => window.location.reload(), 4000)
  }

  componentWillUnmount() { clearTimeout(this.timer) }

  render() {
    if (!this.state.crashed) return this.props.children
    return (
      <div role="alert" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'linear-gradient(180deg,#f0fdfa,#fff)', color: '#0f2a27', fontFamily: 'Inter, system-ui, sans-serif', textAlign: 'center', padding: 24 }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>{this.state.tooMany ? 'Ocorreu um problema' : 'A reiniciar o ecrã…'}</div>
          <div style={{ fontSize: 18, opacity: 0.8 }}>
            {this.state.tooMany ? 'Por favor chame um funcionário.' : 'Um momento, já volta ao normal.'}
          </div>
          {this.state.tooMany && <button type="button" onClick={() => window.location.reload()} style={{ marginTop: 20, padding: '12px 24px', fontSize: 16, borderRadius: 12, border: '1px solid #99f6e4', background: '#fff' }}>Tentar de novo</button>}
        </div>
      </div>
    )
  }
}

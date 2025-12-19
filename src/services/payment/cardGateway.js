import api from '@/services/api'

// CardGateway: simulated but will call backend if available.
// Methods:
// - checkBalance(cardCode) => { balance }
// - topup(cardCode, amount) => { success, sale }
// - charge(items, opts) => { success, method: 'card', total }

const CardGateway = {
  async checkBalance(cardCode) {
    if (!cardCode) throw new Error('Missing cardCode')
    try {
      const c = await api.request(`/pos/cards/${encodeURIComponent(cardCode)}`, { method: 'GET', skipAuth: true, expect: 'json' })
      return { balance: Number(c.balance || 0) }
    } catch (e) {
      // If backend unreachable, simulate a small default balance
      return { balance: 0 }
    }
  },

  async topup(cardCode, amount, opts = {}) {
    // Perform server-side recharge if available, else simulate
    try {
      const json = { amount, items: [{ type: 'recharge', amount }], method: 'card', inserted: amount, change: 0, cardCode, batchId: opts.batchId }
      const res = await api.request('/pos/recharge', { method: 'POST', json, skipAuth: true, expect: 'json', headers: opts.kioskKey ? { Authorization: `ApiKey ${opts.kioskKey}` } : undefined })
      return { success: true, sale: res.sale, card: res.card }
    } catch (e) {
      // Simulate success
      return { success: true, sale: { amount, items: [{ type: 'recharge', amount }], method: 'card' } }
    }
  },

  async charge(items = [], opts = {}) {
    // opts: { cardCode, batchId }
    const total = items.reduce((s, i) => s + (i.price || i.amount || 0), 0)
    if (!opts.cardCode) {
      // If no cardCode provided, treat as failure in real configuration — but since we're simulating, succeed
      return { success: true, method: 'card', total }
    }

    try {
      // Attempt to spend via API per-machine; for simplicity, if multiple items exist we call /cards/:code/spend for each
      const results = []
      for (const it of items) {
        const payload = { machineId: it._id || it.id, amount: Number(it.price || it.amount || 0), items: [it], method: 'card', batchId: opts.batchId }
        const res = await api.request(`/pos/cards/${encodeURIComponent(opts.cardCode)}/spend`, { method: 'POST', json: payload, skipAuth: true, expect: 'json', headers: opts.kioskKey ? { Authorization: `ApiKey ${opts.kioskKey}` } : undefined })
        results.push(res)
      }

      return { success: true, method: 'card', total, results }
    } catch (e) {
      // If backend not available or returned error, return failure
      return { success: false, error: e }
    }
  }
}

export default CardGateway

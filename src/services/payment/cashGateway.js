// CashGateway: simulated gateway for cash payments. Exposes a charge(items, opts) method.

const CashGateway = {
  async charge(items = [], opts = {}) {
    // opts: { inserted, batchId }
    const total = items.reduce((s, i) => s + (i.price || i.amount || 0), 0)
    const inserted = Number(opts.inserted || 0)
    const change = Math.max(0, Math.round((inserted - total) * 100) / 100)
    if (inserted + 0.0001 < total) {
      return { success: false, error: 'Insufficient cash', total, inserted, change }
    }

    // Simulate success (backend persistence is handled by App.handlePay which passes inserted/change to POST calls)
    return { success: true, method: 'cash', total, inserted, change }
  }
}

export default CashGateway

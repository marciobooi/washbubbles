/**
 * Pay cash out of the hopper, like change. On the shop PC the hopper is used directly; on the central server the shop PC is asked
 * (a `pay_out` command) and must answer within seconds: nothing is queued for later, money must not come out when nobody is looking.
 * Used by the admin refund and by the coins of the bank deposit at the day close.
 */
import User from '../models/user.js'
import SyncCommand from '../models/syncCommand.js'
import { withTenant } from './tenant.js'

/** @param payload { reason, saleId } what the shop PC writes down with the payout */
export async function payOutViaHopper(req, amount, payload = {}) {
  const { default: coinMachine } = await import('./coinMachine.js')
  if (coinMachine.running) return coinMachine.payOutCash(amount, { reason: payload.reason || 'refund' })
  const kiosks = await User.find({ tenantId: req.tenantId, role: 'KIOSK' }).select('_id').lean()
  if (kiosks.length !== 1) { const e = new Error(kiosks.length ? 'Há mais de um quiosque: faça-o no PC da loja' : 'Nenhum quiosque registado para esta loja'); e.status = 409; throw e }
  const SyncCommandT = withTenant(SyncCommand, req)
  const cmd = await SyncCommandT.create({ kioskId: kiosks[0]._id, type: 'pay_out', payload: { amount, ...payload } })
  const waitMs = Number(process.env.REFUND_PAYOUT_WAIT_MS) >= 0 ? Number(process.env.REFUND_PAYOUT_WAIT_MS) : 30_000
  const graceMs = Number(process.env.REFUND_PAYOUT_GRACE_MS) >= 0 ? Number(process.env.REFUND_PAYOUT_GRACE_MS) : 15_000
  const pollMs = Number(process.env.REFUND_PAYOUT_POLL_MS) > 0 ? Number(process.env.REFUND_PAYOUT_POLL_MS) : 1000
  const until = Date.now() + waitMs
  let cancelled = false
  for (;;) {
    const c = await SyncCommandT.findById(cmd._id).lean()
    if (c?.status === 'done') return c.result || { success: true, dispensed: amount, remaining: 0 }
    if (c?.status === 'failed') { const e = new Error(c.error || 'A loja recusou o pagamento'); e.status = 502; e.nothingPaid = true; throw e }
    if (Date.now() >= until && !cancelled) {
      // Not picked up in time: withdraw it so it can never run later. If the shop already took it, give it a little more time.
      const gone = await SyncCommandT.findOneAndUpdate({ _id: cmd._id, status: 'pending' }, { status: 'failed', error: 'Sem resposta da loja' })
      if (gone) { const e = new Error('O PC da loja não respondeu. Nada foi pago nem registado.'); e.status = 504; e.nothingPaid = true; throw e }
      cancelled = true
    }
    if (cancelled && Date.now() >= until + graceMs) return { success: false, dispensed: 0, remaining: amount, unconfirmed: true, error: 'A loja não confirmou o pagamento' }
    await new Promise((r) => setTimeout(r, pollMs))
  }
}

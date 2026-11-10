/**
 * Routes that take or give money at the kiosk (cash in the machine, a card at the reader, a card out of the dispenser) only mean
 * something on a shop PC, where the hardware says what was really inserted. The central server has no hardware
 * (ENABLE_COIN_MACHINE=false) and would have to take the caller's word for it, so there they are refused (2026-11 audit, P1-3).
 */
export function shopOnly(req, res, next) {
  if (process.env.ENABLE_COIN_MACHINE === 'false') return res.status(403).json({ error: 'Esta operação só existe no posto da loja', code: 'shop-only' })
  next()
}
export default shopOnly

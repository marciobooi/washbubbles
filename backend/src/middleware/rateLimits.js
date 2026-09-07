import rateLimit from 'express-rate-limit'

/**
 * Card-code lookup limiter.
 *
 * `/pos/cards/:code` and `/gateways/cards/:code` reveal whether a card exists
 * and what it is worth. The kiosk API key that authenticates them lives on an
 * unattended public terminal, so anyone who reads it off the machine could
 * otherwise walk the whole code space and map every card balance in the tenant.
 *
 * The ceiling is well above real kiosk use — a customer taps a card a handful of
 * times per visit — but low enough to make enumeration impractical.
 */
export const cardLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many card lookups, please slow down.' },
})

export default { cardLookupLimiter }

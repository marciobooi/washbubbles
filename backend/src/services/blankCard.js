/**
 * Is this chip blank, i.e. safe to write a purchase onto?
 *  - the reader says so (`new:"true"`), or
 *  - it carries no data at all: name, tax id AND balance are all empty. That is what the reader shows after the chip was wiped
 *    with `write-card` (the reader keeps `new:"false"` whatever we send, 2026-10-19), so wiped cards can be reused. A card that
 *    was written with 0 EUR holds "0", not an empty balance, so it is never mistaken for a blank one.
 */
export function isBlankCard(card) {
  if (!card) return false
  if (String(card.admin) === 'true') return false
  if (String(card.new) === 'true') return true
  const empty = (v) => v == null || String(v).trim() === ''
  return empty(card.name) && empty(card.nif) && empty(card.balance)
}

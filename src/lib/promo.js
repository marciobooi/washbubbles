/**
 * Check if promotional pricing is currently active
 * @param {Object} price - Price object with promotional fields
 * @returns {boolean} - True if promo is active now
 */
export function isPromoActive(price, now = new Date()) {
  // Same rule as the server (backend/src/routes/gateways.js promoIsActive): the admin stores English weekday
  // names, an empty list means every day, and the time window is optional at either end. The kiosk used
  // Portuguese weekday names here, so a promo price never showed on screen although the server applied it.
  if (!price || !price.promoActive) return false
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  if (Array.isArray(price.promoDays) && price.promoDays.length && !price.promoDays.includes(days[now.getDay()])) {
    return false
  }
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  if (price.promoStartTime && hhmm < price.promoStartTime) return false
  if (price.promoEndTime && hhmm > price.promoEndTime) return false
  return true
}

/**
 * Get the effective price considering promotional hours
 * @param {Object} price - Price object
 * @param {string} paymentType - 'cash' or 'card'
 * @returns {number} - The effective price
 */
export function getEffectivePrice(price, paymentType = 'cash') {
  if (!price) return 0
  
  const isPromo = isPromoActive(price)
  
  if (isPromo) {
    if (paymentType === 'cash' && price.promoCashPrice != null) {
      return price.promoCashPrice
    }
    if (paymentType === 'card' && price.promoCardPrice != null) {
      return price.promoCardPrice
    }
  }
  
  // Fallback to regular price
  return paymentType === 'cash' ? price.cashPrice : price.cardPrice
}

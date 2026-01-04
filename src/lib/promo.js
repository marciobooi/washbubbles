/**
 * Check if promotional pricing is currently active
 * @param {Object} price - Price object with promotional fields
 * @returns {boolean} - True if promo is active now
 */
export function isPromoActive(price) {
  if (!price || !price.promoActive) return false
  
  const now = new Date()
  const currentDay = now.toLocaleDateString('pt-PT', { weekday: 'long' }).toLowerCase()
  const currentTime = now.toTimeString().slice(0, 5) // HH:mm format
  
  // Check if today is a promo day
  if (!price.promoDays || !Array.isArray(price.promoDays) || price.promoDays.length === 0) {
    return false
  }
  
  if (!price.promoDays.includes(currentDay)) {
    return false
  }
  
  // Check if current time is within promo hours
  if (!price.promoStartTime || !price.promoEndTime) {
    return false
  }
  
  const startTime = price.promoStartTime
  const endTime = price.promoEndTime
  
  // Handle time comparison
  if (currentTime >= startTime && currentTime <= endTime) {
    return true
  }
  
  return false
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

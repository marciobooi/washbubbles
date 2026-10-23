/**
 * Log hygiene: card holders' personal data (name, tax id, e-mail, phone) travels in the controller's card messages. The
 * hardware trace is useful, the personal data in it is not: it stayed in plain text in a log file that is never rotated.
 * Returns a COPY of the message with those fields masked; the message itself is never changed.
 */
const MASK = new Set(['name', 'nif', 'contribuinte', 'email', 'phone', 'customername', 'customeremail', 'customerphone'])

export function redactPkg(value) {
  if (Array.isArray(value)) return value.map(redactPkg)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = MASK.has(k.toLowerCase()) && v !== null && v !== undefined && String(v).trim() !== '' ? '***' : redactPkg(v)
    }
    return out
  }
  return value
}

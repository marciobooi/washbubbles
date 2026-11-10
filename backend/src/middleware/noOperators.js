// A request body or query string never legitimately carries a Mongo operator.
// `{"token": {"$ne": null}}` dropped into a filter matches every document
// (that was the password-reset takeover), so a key starting with `$` anywhere
// in the input is refused before any route sees it.
function hasOperator(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 12) return false
  if (Array.isArray(value)) return value.some((v) => hasOperator(v, depth + 1))
  for (const k of Object.keys(value)) {
    if (k.startsWith('$')) return true
    if (hasOperator(value[k], depth + 1)) return true
  }
  return false
}

export function noOperators(req, res, next) {
  if (hasOperator(req.body) || hasOperator(req.query)) return res.status(400).json({ error: 'Invalid input' })
  next()
}

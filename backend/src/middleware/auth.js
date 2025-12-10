import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretadminjwt'

export function requireAuth(req, res, next) {
  const auth = req.headers.authorization
  if (!auth) return res.status(401).json({ error: 'Missing Authorization' })
  const parts = auth.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ error: 'Invalid Authorization' })

  try {
    const decoded = jwt.verify(parts[1], JWT_SECRET)
    req.user = decoded
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user || req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' })
    next()
  })
}

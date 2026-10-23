/**
 * Express 4 does not forward a rejected promise from an `async` route handler to the error middleware: the request is simply
 * never answered, and the browser reports "Request timed out" (the admin could not create a user for exactly this reason: the
 * database error vanished and the call hung). This makes every route handler that returns a promise report its rejection to
 * `next(err)`, so the client gets a real error (500, or the route's own handling) at once. Load it once, before any route.
 */
import Layer from 'express/lib/router/layer.js'

if (!Layer.prototype.__asyncPatched) {
  const original = Layer.prototype.handle_request
  Layer.prototype.handle_request = function handleRequest(req, res, next) {
    const fn = this.handle
    if (fn.length > 3) return original.call(this, req, res, next) // error-handling middleware: leave alone
    try {
      const out = fn(req, res, next)
      if (out && typeof out.catch === 'function') out.catch(next)
    } catch (err) {
      next(err)
    }
  }
  Layer.prototype.__asyncPatched = true
}

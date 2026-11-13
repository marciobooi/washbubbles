// The kiosk asks for a new staff PIN when the one just typed was right but has expired (it is renewed every Monday).
// Whoever checks a PIN (api.verifyAdminPin) calls requestPinRenew; the one popup mounted in App (PinRenewHost) listens.
let handler = null
export const setPinRenewHandler = (fn) => { handler = fn }
export const requestPinRenew = (info) => { try { if (handler) handler(info) } catch { /* the popup must never break the PIN screen */ } }

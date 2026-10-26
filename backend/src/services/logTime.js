/**
 * Every line of the backend's log gets the time it was written (YYYY-MM-DD HH:MM:SS.mmm, the PC's clock). Without it the shop PC's
 * backend.log is only an ordered list: nobody could say WHEN a dryer was started or a change was refused. Off with LOG_TIMESTAMPS=off.
 * Imported once, first, by index.js (never by the tests).
 */
if (process.env.LOG_TIMESTAMPS !== 'off' && !globalThis.__logTimeInstalled) {
  globalThis.__logTimeInstalled = true
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  const stamp = () => {
    const d = new Date()
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  }
  for (const level of ['log', 'info', 'warn', 'error']) {
    const orig = console[level].bind(console)
    console[level] = (...args) => {
      if (typeof args[0] === 'string') { args[0] = `${stamp()} ${args[0]}`; orig(...args) } else orig(stamp(), ...args)
    }
  }
}

/**
 * Is this page the shop kiosk screen? The kiosk talks to its own backend with the kiosk key (card in the reader, cash in the
 * machine, live websocket). The public website and the admin pages must NOT do that: with no kiosk key every one of those
 * calls answers 401 and fills the browser console with errors on the login page.
 */
export const isKioskScreen = () =>
  import.meta.env.VITE_PUBLIC_SITE !== 'true' && typeof window !== 'undefined' && !window.location.pathname.startsWith('/admin')

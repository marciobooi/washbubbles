/**
 * A version number for the public page's cached content (routes/public.js). Bumped whenever the content
 * or its translations change, so the page shows the change at once instead of after the cache expires.
 */
let version = 0
export const landingVersion = () => version
export const bumpLandingVersion = () => { version += 1 }

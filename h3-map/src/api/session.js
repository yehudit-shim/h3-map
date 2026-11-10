// The bearer token lives here, in memory only. It is deliberately NOT written to localStorage / sessionStorage,
// the project export or the console: a reload means signing in again (saved layers then show a "reconnect" state).
let token = null
let expiresAt = 0
const listeners = new Set()

export const getToken = () => (token && Date.now() < expiresAt ? token : null)

export function setToken(value, expiresInSeconds = 3600) {
  token = value || null
  expiresAt = value ? Date.now() + Math.max(1, expiresInSeconds) * 1000 : 0
  listeners.forEach((fn) => fn(!!token))
}

export const clearToken = () => setToken(null)

/** Subscribe to sign-in / sign-out (used by the auth store). */
export function onTokenChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

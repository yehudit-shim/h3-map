// Fetch wrapper for /api/v1. Knows about the bearer token, the error envelope and AbortSignal; knows nothing
// about React, stores or layers. The token is supplied through `getToken` and is never logged or persisted here.
import { ApiError, NetworkError, errorFromResponse, isAbort } from './errors.js'

export const DEFAULT_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api/v1'

/** Drop undefined / null / '' values and serialise objects (filters) as JSON. */
export function toQuery(params = {}) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    q.set(k, Array.isArray(v) ? v.join(',') : typeof v === 'object' ? JSON.stringify(v) : String(v))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

/**
 * @param {{baseUrl?:string, getToken?:()=>string|null, onUnauthorized?:(error:ApiError)=>void, fetch?:typeof fetch}} [options]
 */
export function createApiClient({ baseUrl = DEFAULT_BASE, getToken = () => null, onUnauthorized, fetch: fetchImpl } = {}) {
  const doFetch = (...args) => (fetchImpl ?? globalThis.fetch)(...args)

  /** Headers for requests made by someone else (deck.gl tile loading). Read at call time so a refreshed token is used. */
  const authHeaders = () => {
    const t = getToken()
    return t ? { Authorization: `Bearer ${t}` } : {}
  }

  /**
   * @param {string} path path below the base, starting with '/'
   * @param {{method?:string, query?:object, body?:any, signal?:AbortSignal, headers?:object, as?:'json'|'text'|'blob'|'response', auth?:boolean}} [opts]
   */
  async function request(path, { method = 'GET', query, body, signal, headers = {}, as = 'json', auth = true } = {}) {
    const init = { method, signal, headers: { Accept: 'application/json', ...(auth ? authHeaders() : {}), ...headers } }
    if (body !== undefined) {
      init.body = JSON.stringify(body)
      init.headers['Content-Type'] = 'application/json'
    }
    let res
    try {
      res = await doFetch(`${baseUrl}${path}${toQuery(query)}`, init)
    } catch (e) {
      if (isAbort(e) || signal?.aborted) throw e // callers treat aborts as "superseded", not as errors
      throw new NetworkError()
    }
    if (!res.ok) {
      const error = await errorFromResponse(res)
      // The login call itself answers 401 for a wrong password: that is not an expired session.
      if (error.unauthenticated && auth) onUnauthorized?.(error)
      throw error
    }
    if (as === 'response') return res
    if (res.status === 204) return null
    try {
      return as === 'text' ? await res.text() : as === 'blob' ? await res.blob() : await res.json()
    } catch (e) {
      if (isAbort(e) || signal?.aborted) throw e
      throw new ApiError(res.status, 'bad_response', 'The server sent an unreadable response.')
    }
  }

  return { request, authHeaders, baseUrl }
}

// Typed errors for the /api/v1 client. The backend always answers failures with the envelope
//   { error: { code, message, details, requestId } }   (docs/API_SPECIFICATION.md section 2)
// which is mapped to ApiError. Messages come from the server and never contain SQL or credentials.

export class ApiError extends Error {
  /**
   * @param {number} status HTTP status (0 when no response was received)
   * @param {string} code machine-readable code from the envelope (`unauthenticated`, `db_unavailable`, ...)
   */
  constructor(status, code, message, { details = {}, requestId = null, retryAfter = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.requestId = requestId
    this.retryAfter = retryAfter
  }
  get unauthenticated() { return this.status === 401 }
  get forbidden() { return this.status === 403 }
  get notFound() { return this.status === 404 }
  get dbUnavailable() { return this.code === 'db_unavailable' }
  get timeout() { return this.code === 'query_timeout' }
  /** Worth offering a Retry button (the same request may succeed later). */
  get retryable() { return this.status === 0 || this.status === 429 || this.status === 502 || this.status === 504 || this.status >= 500 }
}

/** The request never reached the server (offline, proxy down, CORS). */
export class NetworkError extends ApiError {
  constructor(message = 'The server could not be reached. Check your network connection and that the backend is running.') {
    super(0, 'network_error', message)
    this.name = 'NetworkError'
  }
}

export const isAbort = (e) => e?.name === 'AbortError'

const FALLBACK = { 400: 'bad_request', 401: 'unauthenticated', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 422: 'validation_error', 429: 'rate_limited', 502: 'db_unavailable', 504: 'query_timeout' }

/** Build an ApiError from a failed Response (the envelope when present, a generic one otherwise). */
export async function errorFromResponse(res) {
  let body = null
  try {
    body = await res.json()
  } catch {
    // not JSON (proxy error page, empty body)
  }
  const e = body?.error
  const retryAfter = Number(res.headers.get('Retry-After')) || null
  if (e && typeof e === 'object') {
    return new ApiError(res.status, String(e.code ?? FALLBACK[res.status] ?? 'error'), String(e.message ?? res.statusText ?? 'Request failed'), {
      details: e.details && typeof e.details === 'object' ? e.details : {},
      requestId: e.requestId ?? res.headers.get('X-Request-Id'),
      retryAfter,
    })
  }
  const code = FALLBACK[res.status] ?? (res.status >= 500 ? 'internal_error' : 'error')
  // A dev proxy with no backend behind it answers 502/504 with an HTML or empty body.
  const message = res.status >= 500 ? 'The server is not available right now.' : res.statusText || 'Request failed'
  return new ApiError(res.status, code, message, { requestId: res.headers.get('X-Request-Id'), retryAfter })
}

/** A short sentence for the UI. */
export function describeError(error) {
  if (!(error instanceof ApiError)) return error?.message ?? 'Something went wrong.'
  if (error.unauthenticated) return 'Your session has expired. Sign in again.'
  if (error.forbidden) return error.message || 'You do not have access to this.'
  if (error.dbUnavailable) return 'The database is not reachable. Try again in a moment.'
  if (error.timeout) return 'The query took too long. Zoom in or add a filter.'
  if (error.code === 'rate_limited') return `Too many requests${error.retryAfter ? `; retry in ${error.retryAfter}s` : ''}.`
  return error.message
}

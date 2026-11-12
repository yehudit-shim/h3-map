// One function per backend endpoint used by the frontend (docs/API_SPECIFICATION.md). They return plain JSON
// and take an AbortSignal so a caller can cancel superseded requests. Table references are always
// (connectionId, schema, table); the backend verifies every identifier against the catalogue.
import { createApiClient } from './client.js'
import { getToken, clearToken } from './session.js'

export const api = createApiClient({
  getToken,
  // An expired or revoked token: forget it so the UI falls back to the sign-in state.
  onUnauthorized: () => clearToken(),
})

const e = encodeURIComponent
const conn = (id) => `/connections/${e(id)}`
const tbl = (id, schema, table) => `${conn(id)}/tables/${e(schema)}/${e(table)}`

// ---- auth / system -----------------------------------------------------------------------------
export const login = (username, password, { signal } = {}) =>
  api.request('/auth/login', { method: 'POST', body: { username, password }, signal, auth: false })
// First-run setup (public routes; the server only honours them while nobody can sign in yet).
export const getSetupStatus = ({ signal } = {}) => api.request('/setup/status', { signal, auth: false })
export const testSetupDatabase = (body, { signal } = {}) => api.request('/setup/test-database', { method: 'POST', body, signal, auth: false })
export const runSetup = (body, { signal } = {}) => api.request('/setup', { method: 'POST', body, signal, auth: false })
export const getMe = ({ signal } = {}) => api.request('/me', { signal })
export const getConfig = ({ signal } = {}) => api.request('/config', { signal })

// ---- connections -------------------------------------------------------------------------------
export const listConnections = ({ signal } = {}) => api.request('/connections', { signal })
export const testConnection = (id, { signal } = {}) => api.request(`${conn(id)}/test`, { method: 'POST', signal })
export const createConnection = (body, { signal } = {}) => api.request('/connections', { method: 'POST', body, signal })
export const updateConnection = (id, body, { signal } = {}) => api.request(conn(id), { method: 'PATCH', body, signal })
export const deleteConnection = (id, { signal } = {}) => api.request(conn(id), { method: 'DELETE', signal })
export const getGrants = (id, { signal } = {}) => api.request(`${conn(id)}/grants`, { signal })
export const putGrants = (id, subjects, { signal } = {}) => api.request(`${conn(id)}/grants`, { method: 'PUT', body: { subjects }, signal })

// ---- catalogue ---------------------------------------------------------------------------------
export const listSchemas = (id, { signal } = {}) => api.request(`${conn(id)}/schemas`, { signal })
export const listTables = (id, schema, { geo, q, kind, signal } = {}) =>
  api.request(`${conn(id)}/schemas/${e(schema)}/tables`, { query: { geo, q, kind }, signal })
export const getProfile = (id, schema, table, { exact, signal } = {}) =>
  api.request(`${tbl(id, schema, table)}/profile`, { query: { exact: exact || undefined }, signal })
export const getColumns = (id, schema, table, { signal } = {}) => api.request(`${tbl(id, schema, table)}/columns`, { signal })
export const getRows = (id, schema, table, { limit = 50, offset = 0, after, sort, columns, filter, signal } = {}) =>
  api.request(`${tbl(id, schema, table)}/rows`, { query: { limit, offset: offset || undefined, after, sort, columns, filter }, signal })
export const getStats = (id, schema, table, column, { bins, filter, signal } = {}) =>
  api.request(`${tbl(id, schema, table)}/stats`, { query: { column, bins, filter }, signal })
export const getExtent = (id, schema, table, { geometryColumn, filter, signal } = {}) =>
  api.request(`${tbl(id, schema, table)}/extent`, { query: { geometryColumn, filter }, signal })

// ---- features ----------------------------------------------------------------------------------
/** bbox = [minLon, minLat, maxLon, maxLat]. Resolves to a FeatureCollection `{features, truncated, page}`. */
export const getFeatures = (id, schema, table, { bbox, geometryColumn, columns, filter, zoom, simplify, limit, signal } = {}) =>
  api.request(`${tbl(id, schema, table)}/features`, {
    query: { bbox, geometryColumn, columns, filter, zoom, simplify, limit },
    headers: { Accept: 'application/geo+json' },
    signal,
  })
export const getFeature = (id, schema, table, featureId, { geometryColumn, signal } = {}) =>
  api.request(`${tbl(id, schema, table)}/features/${e(featureId)}`, { query: { geometryColumn }, headers: { Accept: 'application/geo+json' }, signal })

// ---- tiles -------------------------------------------------------------------------------------
export const createTileSession = (id, { schema, table, geometryColumn, columns, filter, minzoom, maxzoom }, { signal } = {}) =>
  api.request(`${conn(id)}/tiles/sessions`, { method: 'POST', body: { schema, table, geometryColumn, columns, filter, minzoom, maxzoom }, signal })
export const deleteTileSession = (sessionId, { signal } = {}) =>
  api.request(`/tiles/sessions/${e(sessionId)}`, { method: 'DELETE', signal })

/** The session's urlTemplate is server-absolute (`/api/v1/tiles/...`); resolve it against the API origin when that differs. */
export function tileUrl(template) {
  if (/^https?:\/\//i.test(template)) return template
  const base = api.baseUrl
  return /^https?:\/\//i.test(base) ? new URL(template, base).href : template
}

// ---- H3 ----------------------------------------------------------------------------------------
export const getH3Cells = (id, schema, table, { column, resolution, bbox, value, agg, filter, maxCells, signal } = {}) =>
  api.request(`${tbl(id, schema, table)}/h3/cells`, { query: { column, resolution, bbox, value, agg, filter, maxCells }, signal })
export const getH3Aggregate = (id, schema, table, { resolution, geometryColumn, bbox, value, agg, filter, maxCells, signal } = {}) =>
  api.request(`${tbl(id, schema, table)}/h3/aggregate`, { query: { resolution, geometryColumn, bbox, value, agg, filter, maxCells }, signal })

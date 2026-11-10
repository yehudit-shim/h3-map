import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse, delay } from 'msw'
import { API, TOKEN, startMockApi } from '../test/mockApi.js'
import { ApiError, NetworkError, createApiClient, describeError, getConfig, getFeatures, getMe, getRows, listConnections, login, clearToken, setToken, getToken, isAbort, tileUrl, toQuery } from './index.js'

const mock = startMockApi()
beforeAll(() => mock.listen())
afterAll(() => mock.close())
beforeEach(() => clearToken())
afterEach(() => {
  mock.server.resetHandlers()
  mock.reset()
})

describe('toQuery', () => {
  it('drops empty values, joins arrays and serialises objects as JSON', () => {
    expect(toQuery({ a: 1, b: undefined, c: null, d: '', e: ['x', 'y'], f: { op: 'eq' }, g: false })).toBe('?a=1&e=x%2Cy&f=%7B%22op%22%3A%22eq%22%7D&g=false')
    expect(toQuery({})).toBe('')
  })
})

describe('api client', () => {
  it('sends the bearer token from the session and not before sign-in', async () => {
    await expect(listConnections()).rejects.toMatchObject({ status: 401, code: 'unauthenticated' })
    expect(mock.calls.at(-1).auth).toBeNull()
    setToken(TOKEN, 3600)
    await expect(listConnections()).resolves.toHaveLength(1)
    expect(mock.calls.at(-1).auth).toBe(`Bearer ${TOKEN}`)
  })

  it('maps the error envelope to a typed ApiError', async () => {
    mock.server.use(http.get(`${API}/config`, () => HttpResponse.json({ error: { code: 'invalid_filter', message: "Unknown column 'popp'", details: { column: 'popp' }, requestId: 'r-9' } }, { status: 422 })))
    setToken(TOKEN)
    const err = await getConfig().catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 422, code: 'invalid_filter', message: "Unknown column 'popp'", details: { column: 'popp' }, requestId: 'r-9' })
    expect(err.retryable).toBe(false)
  })

  it.each([
    [502, 'db_unavailable', true],
    [504, 'query_timeout', true],
    [404, 'not_found', false],
    [403, 'forbidden', false],
  ])('classifies %i %s (retryable: %s)', async (status, code, retryable) => {
    mock.server.use(http.get(`${API}/config`, () => HttpResponse.json({ error: { code, message: 'x', details: {}, requestId: 'r' } }, { status })))
    setToken(TOKEN)
    const err = await getConfig().catch((e) => e)
    expect(err.code).toBe(code)
    expect(err.retryable).toBe(retryable)
  })

  it('survives a non-JSON error body (a proxy with no backend answers 502 with HTML)', async () => {
    mock.server.use(http.get(`${API}/config`, () => new HttpResponse('<html>Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } })))
    setToken(TOKEN)
    const err = await getConfig().catch((e) => e)
    expect(err).toMatchObject({ status: 502, code: 'db_unavailable' })
    expect(err.message).not.toMatch(/html/i)
  })

  it('reports an unreachable server as a NetworkError', async () => {
    mock.server.use(http.get(`${API}/config`, () => HttpResponse.error()))
    setToken(TOKEN)
    const err = await getConfig().catch((e) => e)
    expect(err).toBeInstanceOf(NetworkError)
    expect(err.retryable).toBe(true)
    expect(describeError(err)).toMatch(/could not be reached/i)
  })

  it('an expired token (401) clears the session; a wrong password at login does not look like an expiry', async () => {
    const onUnauthorized = vi.fn()
    const client = createApiClient({ baseUrl: API, getToken: () => 'stale', onUnauthorized })
    await expect(client.request('/me')).rejects.toMatchObject({ status: 401 })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    setToken(TOKEN)
    mock.server.use(http.get(`${API}/me`, () => HttpResponse.json({ error: { code: 'unauthenticated', message: 'expired' } }, { status: 401 })))
    await expect(getMe()).rejects.toMatchObject({ status: 401 })
    expect(getToken()).toBeNull() // default client cleared the stored token

    await expect(login('admin', 'wrong')).rejects.toMatchObject({ code: 'unauthenticated' })
    const res = await login('admin', 'right')
    expect(res.accessToken).toBe(TOKEN)
  })

  it('aborts an in-flight request with an AbortError, not an ApiError', async () => {
    mock.server.use(http.get(`${API}/config`, async () => {
      await delay(500)
      return HttpResponse.json({})
    }))
    setToken(TOKEN)
    const controller = new AbortController()
    const p = getConfig({ signal: controller.signal })
    controller.abort()
    const err = await p.catch((e) => e)
    expect(isAbort(err)).toBe(true)
    expect(err).not.toBeInstanceOf(ApiError)
  })

  it('builds the table endpoints from structured parameters (no SQL, identifiers URL-encoded)', async () => {
    setToken(TOKEN)
    await getFeatures('anastasia', 'public', 'poi', { bbox: [2.2, 48.8, 2.4, 48.9], columns: ['name', 'pop'], zoom: 11.5, simplify: 'auto', limit: 5000 })
    const q = mock.calls.at(-1)
    expect(q.path).toBe('/connections/anastasia/tables/public/poi/features')
    expect(Object.fromEntries(q.search)).toEqual({ bbox: '2.2,48.8,2.4,48.9', columns: 'name,pop', zoom: '11.5', simplify: 'auto', limit: '5000' })
    await getRows('anastasia', 'my schema', 'weird/table', { limit: 25, offset: 50 })
    expect(mock.calls.at(-1).path).toBe('/connections/anastasia/tables/my%20schema/weird%2Ftable/rows')
    expect(mock.calls.at(-1).search.get('offset')).toBe('50')
  })

  it('never puts the token in a URL', async () => {
    setToken(TOKEN)
    await getFeatures('anastasia', 'public', 'poi', { bbox: [0, 0, 1, 1] })
    expect(mock.calls.every((c) => !c.search.toString().includes(TOKEN))).toBe(true)
  })

  it('resolves a server-absolute tile template against an absolute API base only', () => {
    expect(tileUrl('/api/v1/tiles/s/{z}/{x}/{y}.mvt')).toBe('/api/v1/tiles/s/{z}/{x}/{y}.mvt')
    expect(tileUrl('https://tiles.example.com/{z}/{x}/{y}.pbf')).toBe('https://tiles.example.com/{z}/{x}/{y}.pbf')
  })
})

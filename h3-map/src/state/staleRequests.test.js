// Viewport requests: an older response must never replace a newer one, and aborted requests are not errors.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/index.js'
import { registerSource, unregisterSource } from '../data/sources.js'
import { _resetInflight, useDataStore } from './dataStore.js'

const fc = (n) => ({ type: 'FeatureCollection', features: Array.from({ length: n }, (_, i) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [i, i] } })), truncated: false })

/** A dynamic source whose requests the test resolves by hand. */
function controllable(id = 'dyn') {
  const requests = []
  const source = {
    id, name: id, kind: 'postgis', geometry: 'point', fields: [], dynamic: true, bounds: [0, 0, 1, 1],
    load: (args) => new Promise((resolve, reject) => {
      const r = { args, resolve, reject, aborted: false }
      args.signal.addEventListener('abort', () => {
        r.aborted = true
        reject(new DOMException('aborted', 'AbortError'))
      })
      requests.push(r)
    }),
  }
  registerSource(source)
  return { source, requests }
}

beforeEach(() => useDataStore.setState({ entries: {} }))
afterEach(() => {
  _resetInflight()
  unregisterSource('dyn')
})

describe('viewport requests', () => {
  it('aborts the previous request when a new viewport is requested', async () => {
    const { requests } = controllable()
    const store = useDataStore.getState()
    const a = store.loadView('dyn', { bbox: [0, 0, 1, 1], requestKey: 'a' })
    const b = store.loadView('dyn', { bbox: [1, 1, 2, 2], requestKey: 'b' })
    expect(requests[0].aborted).toBe(true)
    expect(requests[1].aborted).toBe(false)
    requests[1].resolve(fc(2))
    await Promise.all([a, b])
    expect(useDataStore.getState().entries.dyn).toMatchObject({ status: 'ready', featureCount: 2, requestKey: 'b' })
  })

  it('discards a stale response even when the abort came too late to stop it', async () => {
    const { source } = controllable()
    // a source that ignores the abort signal and answers late (e.g. the response was already on the wire)
    const late = []
    source.load = (args) => new Promise((resolve) => late.push({ args, resolve }))
    const store = useDataStore.getState()
    const first = store.loadView('dyn', { bbox: [0, 0, 1, 1], requestKey: 'old' })
    const second = store.loadView('dyn', { bbox: [5, 5, 6, 6], requestKey: 'new' })
    late[1].resolve(fc(3)) // the newer request answers first
    await second
    late[0].resolve(fc(99)) // the older one answers afterwards
    await first
    const e = useDataStore.getState().entries.dyn
    expect(e.featureCount).toBe(3)
    expect(e.requestKey).toBe('new')
  })

  it('keeps the previous data drawn while the next view loads, and marks it refreshing', async () => {
    const { requests } = controllable()
    const store = useDataStore.getState()
    const a = store.loadView('dyn', { bbox: [0, 0, 1, 1], requestKey: 'a' })
    requests[0].resolve(fc(4))
    await a
    const b = store.loadView('dyn', { bbox: [1, 1, 2, 2], requestKey: 'b' })
    expect(useDataStore.getState().entries.dyn).toMatchObject({ status: 'ready', featureCount: 4, refreshing: true })
    requests[1].resolve(fc(1))
    await b
    expect(useDataStore.getState().entries.dyn).toMatchObject({ featureCount: 1 })
    expect(useDataStore.getState().entries.dyn.refreshing).toBeUndefined()
  })

  it('does not turn an aborted request into an error', async () => {
    const { requests } = controllable()
    const p = useDataStore.getState().loadView('dyn', { bbox: [0, 0, 1, 1], requestKey: 'a' })
    useDataStore.getState().forget(['dyn'])
    await p
    expect(requests[0].aborted).toBe(true)
    expect(useDataStore.getState().entries.dyn).toBeUndefined()
  })

  it('a failed refresh keeps the drawn data and reports viewError; a failed first load is an error', async () => {
    const { requests } = controllable()
    const store = useDataStore.getState()
    const first = store.loadView('dyn', { bbox: [0, 0, 1, 1], requestKey: 'a' })
    requests[0].reject(new ApiError(504, 'query_timeout', 'slow'))
    await first
    expect(useDataStore.getState().entries.dyn).toMatchObject({ status: 'error' })
    expect(useDataStore.getState().entries.dyn.error).toMatch(/too long/i)

    useDataStore.setState({ entries: {} })
    const ok = store.loadView('dyn', { bbox: [0, 0, 1, 1], requestKey: 'a' })
    requests[1].resolve(fc(2))
    await ok
    const bad = store.loadView('dyn', { bbox: [1, 1, 2, 2], requestKey: 'b' })
    requests[2].reject(new ApiError(502, 'db_unavailable', 'down'))
    await bad
    expect(useDataStore.getState().entries.dyn).toMatchObject({ status: 'ready', featureCount: 2, viewError: expect.stringMatching(/not reachable/i) })
  })

  it('classifies failures: sign-in needed, connection missing, retryable', async () => {
    const { requests } = controllable()
    const store = useDataStore.getState()
    const run = async (i, error) => {
      useDataStore.setState({ entries: {} })
      const p = store.loadView('dyn', { requestKey: String(i) })
      requests[i].reject(error)
      await p
      return useDataStore.getState().entries.dyn
    }
    expect(await run(0, Object.assign(new Error('x'), { code: 'needs-auth' }))).toMatchObject({ needsAuth: true })
    expect(await run(1, new ApiError(401, 'unauthenticated', 'expired'))).toMatchObject({ needsAuth: true })
    expect(await run(2, new ApiError(404, 'not_found', 'gone'))).toMatchObject({ needsReconnect: true, needsAuth: false })
    expect(await run(3, new ApiError(403, 'forbidden', 'no'))).toMatchObject({ needsReconnect: true })
    expect(await run(4, new ApiError(502, 'db_unavailable', 'down'))).toMatchObject({ retryable: true, needsReconnect: false })
  })

  it('does not request a dynamic source on ensure() (the viewport hook does), and retry clears a failure', async () => {
    const { requests } = controllable()
    const store = useDataStore.getState()
    store.ensure('dyn')
    expect(requests).toHaveLength(0)
    useDataStore.setState({ entries: { dyn: { status: 'error', error: 'x' } } })
    store.retry('dyn')
    expect(useDataStore.getState().entries.dyn).toBeUndefined()
    expect(requests).toHaveLength(0)
  })

  it('markSignedOut drops database data and waits for a sign-in; sign-in retries those layers', async () => {
    const { requests } = controllable()
    const p = useDataStore.getState().loadView('dyn', { requestKey: 'a' })
    requests[0].resolve(fc(2))
    await p
    useDataStore.getState().markSignedOut()
    expect(useDataStore.getState().entries.dyn).toMatchObject({ status: 'error', needsAuth: true })
    expect(useDataStore.getState().entries.dyn.data).toBeUndefined()
    const spy = vi.spyOn(useDataStore.getState(), 'retry')
    useDataStore.getState().retryWaitingForAuth()
    expect(spy).toHaveBeenCalledWith('dyn')
    expect(useDataStore.getState().entries.dyn).toBeUndefined() // dynamic: the hook requests it again
  })
})

import { create } from 'zustand'
import { ApiError, describeError, getProfile, isAbort, listConnections, listSchemas, listTables } from '../api/index.js'

// Metadata only: connection descriptors as the server returns them (no password ever comes back), schema and table
// lists, and table profiles. Nothing here is persisted and nothing here is a secret.

const idle = { status: 'idle', items: [], error: null }
const errorOf = (e) => ({ message: describeError(e), retryable: !(e instanceof ApiError) || e.retryable, code: e?.code })
const key = (...parts) => parts.join('\u0000')

export const useConnectionsStore = create((set, get) => {
  const inflight = new Map() // key -> true, so a second expand does not duplicate a request
  const run = async (k, slice, start, work) => {
    if (inflight.has(k)) return
    inflight.set(k, true)
    start()
    try {
      const value = await work()
      slice({ status: 'ready', value, error: null })
    } catch (e) {
      if (!isAbort(e)) slice({ status: 'error', error: errorOf(e) })
    } finally {
      inflight.delete(k)
    }
  }

  return {
    connections: { ...idle },
    schemas: {}, // connectionId -> {status, items, error}
    tables: {}, // `${connectionId}\0${schema}` -> {status, items, error}
    profiles: {}, // `${connectionId}\0${schema}\0${table}` -> {status, data, error}

    loadConnections: (force = false) => {
      if (!force && get().connections.status === 'ready') return Promise.resolve()
      return run(
        'connections',
        ({ status, value, error }) => set({ connections: { status, items: value ?? get().connections.items, error } }),
        () => set((s) => ({ connections: { ...s.connections, status: 'loading', error: null } })),
        () => listConnections(),
      )
    },

    loadSchemas: (connectionId, force = false) => {
      if (!force && get().schemas[connectionId]?.status === 'ready') return Promise.resolve()
      return run(
        key('schemas', connectionId),
        ({ status, value, error }) => set((s) => ({ schemas: { ...s.schemas, [connectionId]: { status, items: value ?? s.schemas[connectionId]?.items ?? [], error } } })),
        () => set((s) => ({ schemas: { ...s.schemas, [connectionId]: { items: s.schemas[connectionId]?.items ?? [], status: 'loading', error: null } } })),
        () => listSchemas(connectionId),
      )
    },

    loadTables: (connectionId, schema, force = false) => {
      const k = key(connectionId, schema)
      if (!force && get().tables[k]?.status === 'ready') return Promise.resolve()
      return run(
        key('tables', k),
        ({ status, value, error }) => set((s) => ({ tables: { ...s.tables, [k]: { status, items: value ?? s.tables[k]?.items ?? [], error } } })),
        () => set((s) => ({ tables: { ...s.tables, [k]: { items: s.tables[k]?.items ?? [], status: 'loading', error: null } } })),
        () => listTables(connectionId, schema),
      )
    },

    loadProfile: (connectionId, schema, table, force = false) => {
      const k = key(connectionId, schema, table)
      if (!force && get().profiles[k]?.status === 'ready') return Promise.resolve()
      return run(
        key('profile', k),
        ({ status, value, error }) => set((s) => ({ profiles: { ...s.profiles, [k]: { status, data: value ?? null, error } } })),
        () => set((s) => ({ profiles: { ...s.profiles, [k]: { data: s.profiles[k]?.data ?? null, status: 'loading', error: null } } })),
        () => getProfile(connectionId, schema, table),
      )
    },

    /** Forget everything (sign-out, or after a connection was edited). */
    reset: () => set({ connections: { ...idle }, schemas: {}, tables: {}, profiles: {} }),
    /** Forget the cached catalogue of one connection (after editing or deleting it). */
    forgetConnection: (connectionId) =>
      set((s) => {
        const keep = (obj) => Object.fromEntries(Object.entries(obj).filter(([k]) => k !== connectionId && !k.startsWith(`${connectionId}\u0000`)))
        return { schemas: keep(s.schemas), tables: keep(s.tables), profiles: keep(s.profiles) }
      }),
  }
})

export const tableKey = key

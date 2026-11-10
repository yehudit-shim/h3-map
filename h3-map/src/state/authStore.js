import { create } from 'zustand'
import { releaseAllTileSessions } from '../data/pgSources.js'
import { useConnectionsStore } from './connectionsStore.js'
import { useDataStore } from './dataStore.js'
import { ApiError, clearToken, describeError, getConfig, getMe, login as apiLogin, onTokenChange, setToken } from '../api/index.js'

/**
 * Sign-in state. The token itself is kept in `api/session.js` (memory only); this store holds only
 * what the UI needs to render: who is signed in, with which role, and the public server config.
 * Nothing here is persisted.
 */
export const useAuthStore = create((set, get) => ({
  status: 'signed-out', // 'signed-out' | 'signing-in' | 'signed-in'
  user: null,
  roles: [],
  config: null, // GET /config: limits, thresholds, featureFlags
  error: null,
  /** True when the session ended on its own (expired token), so the UI can say so. */
  expired: false,

  isAdmin: () => get().roles.includes('admin'),
  /** Logged in with a role that may manage connections and the server allows it. */
  canManageConnections: () => get().roles.includes('admin') && !!get().config?.featureFlags?.userConnections,

  login: async (username, password) => {
    set({ status: 'signing-in', error: null, expired: false })
    try {
      const res = await apiLogin(username, password)
      setToken(res.accessToken, res.expiresIn)
      // config and /me are best effort: the token alone is enough to browse data.
      const [me, config] = await Promise.all([getMe().catch(() => null), getConfig().catch(() => null)])
      set({ status: 'signed-in', user: me?.user ?? username, roles: me?.roles ?? (res.role ? [res.role] : []), config, error: null })
      // Database layers restored from a saved project were waiting for this sign-in.
      useDataStore.getState().retryWaitingForAuth()
      return true
    } catch (e) {
      clearToken()
      set({ status: 'signed-out', user: null, roles: [], error: e instanceof ApiError && e.unauthenticated ? 'Invalid username or password.' : describeError(e) })
      return false
    }
  },

  /** Sign out locally. Callers that own server-side resources (tile sessions) release them first. */
  logout: () => {
    releaseAllTileSessions() // fires the DELETE requests while the token is still valid
    clearToken()
    useConnectionsStore.getState().reset()
    useDataStore.getState().markSignedOut()
    set({ status: 'signed-out', user: null, roles: [], config: null, error: null, expired: false })
  },
}))

// A 401 anywhere (expired token) clears the token in api/session.js; mirror that into the store.
onTokenChange((signedIn) => {
  const s = useAuthStore.getState()
  if (!signedIn && s.status === 'signed-in') {
    useAuthStore.setState({ status: 'signed-out', user: null, roles: [], config: null, expired: true })
    useDataStore.getState().markSignedOut()
  }
})

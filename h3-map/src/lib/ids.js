let counter = 0

/** Short unique id. Does not rely on crypto.randomUUID (unavailable on insecure LAN origins). */
export function createId(prefix = 'id') {
  counter += 1
  return `${prefix}-${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

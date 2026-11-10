/** Deterministic PRNG (mulberry32) so sample data is identical on every run and in tests. */
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standard normal sample via Box-Muller. */
export function gaussian(rand) {
  let u = 0
  while (u === 0) u = rand()
  const v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

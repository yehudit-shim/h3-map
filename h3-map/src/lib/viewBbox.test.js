import { describe, expect, it } from 'vitest'
import { bboxKey, normalizeViewBbox } from './viewBbox.js'

describe('normalizeViewBbox', () => {
  it('passes a normal box through', () => {
    expect(normalizeViewBbox([2.2, 48.8, 2.4, 48.9])).toEqual([2.2, 48.8, 2.4, 48.9])
  })
  it('covers the whole world when zoomed out beyond one world copy', () => {
    expect(normalizeViewBbox([-300, -90, 300, 90])).toEqual([-180, -85.0511, 180, 85.0511])
  })
  it('shifts a repeated-world box back into range and clamps latitude', () => {
    expect(normalizeViewBbox([350, 10, 370, 95])).toEqual([-10, 10, 10, 85.0511])
    expect(normalizeViewBbox([-190, -10, -170, 10])).toEqual([-180, -10, -170, 10])
  })
  it('rejects unusable input', () => {
    for (const bad of [null, undefined, [], [1, 2, 3], [NaN, 0, 1, 1], ['a', 0, 1, 1], [5, 5, 5, 6], [0, 5, 1, 5]]) expect(normalizeViewBbox(bad)).toBeNull()
  })
  it('bboxKey ignores sub-pixel differences', () => {
    expect(bboxKey([2.200001, 48.8, 2.4, 48.9])).toBe(bboxKey([2.2, 48.800002, 2.4, 48.9]))
    expect(bboxKey(null)).toBe('')
  })
})

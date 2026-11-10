import { describe, expect, it } from 'vitest'
import { createColorScale, equalBreaks, NO_DATA_COLOR, quantileBreaks } from './colorScale.js'
import { hexToRgb, rampColorRange, sampleRamp } from './colorRamps.js'

describe('colorRamps', () => {
  it('parses hex and samples endpoints', () => {
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0])
    expect(sampleRamp('viridis', 0)).toEqual([68, 1, 84])
    expect(sampleRamp('viridis', 1)).toEqual([253, 231, 37])
    expect(sampleRamp('viridis', 0, true)).toEqual([253, 231, 37])
    expect(sampleRamp('viridis', NaN)).toEqual([68, 1, 84])
    expect(sampleRamp('unknown', 0.5).length).toBe(3)
  })
  it('builds a colorRange', () => {
    const r = rampColorRange('plasma', 6)
    expect(r.length).toBe(6)
    expect(r[0].length).toBe(4)
  })
})

describe('colorScale', () => {
  it('breaks', () => {
    expect(equalBreaks(0, 100, 4)).toEqual([25, 50, 75])
    expect(quantileBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 4).length).toBe(3)
    expect(quantileBreaks([], 4)).toEqual([])
  })
  it('continuous scale maps min and max to ramp ends and null to no-data', () => {
    const f = createColorScale({ ramp: 'viridis', values: [0, 10, 5], alpha: 200 })
    expect(f(0)).toEqual([68, 1, 84, 200])
    expect(f(10)).toEqual([253, 231, 37, 200])
    expect(f(null)).toEqual(NO_DATA_COLOR)
    expect(f(NaN)).toEqual(NO_DATA_COLOR)
    expect(f.meta.domain).toEqual([0, 10])
  })
  it('classed scales give each class one color', () => {
    const values = Array.from({ length: 100 }, (_, i) => i)
    const f = createColorScale({ ramp: 'viridis', values, mode: 'equal', classes: 4 })
    expect(new Set([0, 10, 30, 60, 99].map((v) => f(v).join()))).toHaveProperty('size', 4)
    expect(f.meta.classColors.length).toBe(4)
    expect(f(0)).toEqual(f(20))
  })
  it('handles constant and empty data without NaN', () => {
    const c = createColorScale({ ramp: 'viridis', values: [5, 5, 5] })(5)
    expect(c.every(Number.isFinite)).toBe(true)
    expect(createColorScale({ ramp: 'viridis', values: [] })(1).every(Number.isFinite)).toBe(true)
  })
})

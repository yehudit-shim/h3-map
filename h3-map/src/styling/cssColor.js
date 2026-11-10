/** [r,g,b,a(0-255)] -> CSS rgb() string */
export function rgbaCss([r, g, b, a = 255]) {
  return `rgb(${r} ${g} ${b} / ${(a / 255).toFixed(3)})`
}

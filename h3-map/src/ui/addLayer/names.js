export const baseName = (fileName) => fileName.replace(/\.[^.]+$/, '')

/** A readable name for a URL source: last path segment without extension, else the host. */
export function nameFromUrl(url) {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop()
    return last ? decodeURIComponent(baseName(last)) : u.host
  } catch {
    return 'Data'
  }
}

/** File extension -> the Add layer tab that handles it (used by drag and drop onto the map). */
export function tabForFile(file) {
  const name = file.name.toLowerCase()
  if (/\.(geojson|json)$/.test(name)) return 'geojson'
  if (/\.(csv|tsv|txt)$/.test(name)) return 'csv'
  return null
}

import { notify } from '../state/notifyStore.js'

/** Copy text to the clipboard; returns whether it worked (a toast explains when it does not). */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    notify('Copy is not available in this browser context. Select the text and copy it manually.', { kind: 'warn', key: 'copy' })
    return false
  }
}

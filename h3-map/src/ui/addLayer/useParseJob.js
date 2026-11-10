import { useCallback, useEffect, useRef, useState } from 'react'
import { ParseCancelled, runParse } from '../../data/loaders/client.js'

const IDLE = { status: 'idle' }

/**
 * Runs a parse job (worker) and exposes its state to a form:
 *   idle -> loading (progress) -> [inspect (CSV: choose columns) -> loading] -> ready | error
 * Cancelled / replaced jobs are ignored; the job is cancelled on unmount.
 */
export function useParseJob() {
  const [state, setState] = useState(IDLE)
  const job = useRef(null)
  const generation = useRef(0) // identifies the current job; callbacks of replaced jobs are ignored

  const cancel = useCallback(() => {
    generation.current++
    job.current?.cancel()
    job.current = null
    setState(IDLE)
  }, [])

  const start = useCallback((request, input) => {
    job.current?.cancel()
    const gen = ++generation.current
    const mine = runParse(request, {
      onProgress: (progress) => {
        if (generation.current === gen) setState((s) => (s.status === 'loading' ? { ...s, progress } : s))
      },
      onInspect: (inspection) => {
        if (generation.current === gen) setState((s) => ({ ...s, status: 'inspect', inspection }))
      },
    })
    job.current = mine
    setState({ status: 'loading', input, progress: { phase: 'read' } })
    mine.promise.then(
      (result) => {
        if (generation.current === gen) setState((s) => ({ ...s, status: 'ready', result }))
      },
      (error) => {
        if (generation.current === gen && !(error instanceof ParseCancelled)) setState((s) => ({ ...s, status: 'error', error: error.message }))
      },
    )
  }, [])

  const build = useCallback((lat, lon) => {
    setState((s) => ({ ...s, status: 'loading', progress: { phase: 'build' } }))
    job.current?.build(lat, lon)
  }, [])

  useEffect(() => () => {
    generation.current++
    job.current?.cancel()
  }, [])

  return { state, start, build, cancel }
}

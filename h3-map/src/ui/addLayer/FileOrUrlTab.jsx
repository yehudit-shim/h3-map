import { useEffect, useState } from 'react'
import { checkUrl } from '../../data/loaders/client.js'
import { addParsedDataLayer } from '../layerActions.js'
import { Button } from '../Button.jsx'
import { Field, Segmented } from '../controls.jsx'
import { baseName, nameFromUrl } from './names.js'
import { ErrorBox, FilePicker, ProgressBar, ResultPanel } from './shared.jsx'
import { useParseJob } from './useParseJob.js'

/**
 * Shared flow of the GeoJSON and CSV tabs: choose a file or URL -> parse in the worker (progress,
 * cancel, errors) -> optional `inspect` step (CSV column choice) -> summary -> add to the map.
 * @param {{format:'geojson'|'csv', accept:string, hint:string, initialFile?:File|null, onDone:()=>void,
 *   renderInspect?: (ctx:{inspection:object, build:(lat:string,lon:string)=>void, cancel:()=>void}) => import('react').ReactNode,
 *   renderReport?: (result:object) => import('react').ReactNode}} props
 */
export default function FileOrUrlTab({ format, accept, hint, initialFile, onDone, renderInspect, renderReport }) {
  const { state, start, build, cancel } = useParseJob()
  const [mode, setMode] = useState('file')
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState(null)

  const loadFile = (file) => start({ format, source: { file } }, { origin: 'file', fileName: file.name, name: baseName(file.name) })
  const loadUrl = (e) => {
    e?.preventDefault()
    const checked = checkUrl(url)
    setUrlError(checked.error ?? null)
    if (checked.error) return
    start({ format, source: { url: checked.url } }, { origin: 'url', url: checked.url, name: nameFromUrl(checked.url) })
  }

  // A file dropped on the map opens this tab with the file already chosen. No "already started" guard:
  // start() replaces a running job, so React StrictMode's second effect run restarts it safely.
  useEffect(() => {
    if (initialFile) loadFile(initialFile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const busy = state.status === 'loading'
  const add = (typeId, name) => {
    addParsedDataLayer({ input: { ...state.input, format }, result: state.result, typeId, name })
    onDone()
  }

  return (
    <div className="space-y-3">
      <Segmented aria-label="Data origin" value={mode} onChange={setMode} options={[{ value: 'file', label: 'File' }, { value: 'url', label: 'URL' }]} />
      {mode === 'file' ? (
        <FilePicker accept={accept} label={`${format === 'csv' ? 'CSV' : 'GeoJSON'} file`} hint={hint} disabled={busy} onFile={loadFile} />
      ) : (
        <form onSubmit={loadUrl} className="space-y-1">
          <Field label={`${format === 'csv' ? 'CSV' : 'GeoJSON'} URL`} htmlFor={`${format}-url`}>
            <div className="flex gap-2">
              <input
                id={`${format}-url`}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={format === 'csv' ? 'https://…/points.csv' : 'https://…/data.geojson'}
                spellCheck={false}
                className="h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2 text-[13px] outline-none placeholder:text-muted focus-visible:border-accent"
              />
              <Button type="submit" variant="solid" disabled={busy || !url.trim()}>Load</Button>
            </div>
          </Field>
          {urlError && <div className="text-[12px] text-danger" role="alert">{urlError}</div>}
          <p className="text-[11px] text-muted">The server must allow cross-origin requests (CORS). The URL is saved with the project and reloaded next time.</p>
        </form>
      )}
      {busy && <ProgressBar progress={state.progress} onCancel={cancel} />}
      {state.status === 'error' && <ErrorBox>{state.error}</ErrorBox>}
      {state.status === 'inspect' && renderInspect?.({ inspection: state.inspection, build, cancel })}
      {state.status === 'ready' && (
        <ResultPanel key={state.result.featureCount + state.input.name} result={state.result} defaultName={state.input.name} onAdd={add}>
          {renderReport?.(state.result)}
        </ResultPanel>
      )}
      {state.status === 'ready' && state.input.origin === 'file' && (
        <p className="text-[11px] text-muted">The file's contents are not saved in the browser. After a reload you will be asked to choose the file again.</p>
      )}
    </div>
  )
}

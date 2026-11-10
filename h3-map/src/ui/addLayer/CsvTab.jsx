import { useState } from 'react'
import { Download } from 'lucide-react'
import { badRowsToCsv } from '../../data/loaders/csvParse.js'
import { formatNumber } from '../../lib/format.js'
import { Button } from '../Button.jsx'
import { Field, Select } from '../controls.jsx'
import { download } from '../layerActions.js'
import FileOrUrlTab from './FileOrUrlTab.jsx'

/** Column picker shown after the header was read. Auto-detected columns are preselected. */
function ColumnPicker({ inspection, build, cancel }) {
  const { columns, types, detected, sample, rowCount } = inspection
  const [lat, setLat] = useState(detected?.lat ?? '')
  const [lon, setLon] = useState(detected?.lon ?? '')
  const options = [{ value: '', label: 'Choose a column…' }, ...columns.map((c) => ({ value: c, label: types[c] === 'number' ? c : `${c} (has non-numeric values)` }))]
  const ready = lat && lon && lat !== lon
  return (
    <div className="space-y-2.5 rounded-lg border border-line bg-raised/50 p-3" data-testid="csv-columns">
      <div className="text-[12px]">
        <span className="font-medium">{formatNumber(rowCount)} rows</span>, {columns.length} columns.{' '}
        {detected ? (
          <span className="text-ok" data-testid="csv-detected">Latitude and longitude columns were detected: check them below.</span>
        ) : (
          <span className="text-warn" data-testid="csv-undetected">Could not detect the latitude and longitude columns. Choose them.</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Latitude column" htmlFor="csv-lat"><Select id="csv-lat" value={lat} onChange={setLat} options={options} /></Field>
        <Field label="Longitude column" htmlFor="csv-lon"><Select id="csv-lon" value={lon} onChange={setLon} options={options} /></Field>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-muted">
              {columns.slice(0, 8).map((c) => (
                <th key={c} className="whitespace-nowrap pr-3 font-normal">{c} <span className="opacity-60">{types[c] === 'number' ? '#' : 'a'}</span></th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono">
            {sample.map((row, i) => (
              <tr key={i} className="border-t border-line/60">
                {columns.slice(0, 8).map((c) => <td key={c} className="max-w-[110px] truncate whitespace-nowrap pr-3">{String(row[c] ?? '')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={cancel}>Cancel</Button>
        <Button variant="solid" disabled={!ready} onClick={() => build(lat, lon)} data-testid="csv-load">Load points</Button>
      </div>
    </div>
  )
}

/** Rows that could not become points: count, the first few, and a download of all recorded ones. */
export function BadRowsReport({ result }) {
  const { report, csv } = result
  if (!report?.badCount) return null
  const shown = report.bad.slice(0, 8)
  return (
    <details className="rounded-md border border-line bg-raised/50 p-2 text-[12px]" data-testid="bad-rows">
      <summary className="cursor-pointer select-none font-medium">{formatNumber(report.badCount)} bad row{report.badCount === 1 ? '' : 's'} skipped</summary>
      <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-muted">
        {shown.map((b) => <li key={b.row}>row {b.row}: {b.reason}</li>)}
        {report.badCount > shown.length && <li>… and {formatNumber(report.badCount - shown.length)} more</li>}
      </ul>
      <Button
        size="sm"
        variant="outline"
        className="mt-2"
        onClick={() => download('bad-rows.csv', badRowsToCsv(report.bad, csv?.columns ?? []), 'text/csv')}
      >
        <Download size={13} aria-hidden="true" /> Download bad rows (CSV){report.badTruncated ? ` · first ${formatNumber(report.bad.length)}` : ''}
      </Button>
    </details>
  )
}

export default function CsvTab({ initialFile, onDone }) {
  return (
    <FileOrUrlTab
      format="csv"
      accept=".csv,.tsv,.txt,text/csv"
      hint="CSV with a header row and latitude / longitude columns"
      initialFile={initialFile}
      onDone={onDone}
      renderInspect={(ctx) => <ColumnPicker {...ctx} />}
      renderReport={(result) => <BadRowsReport result={result} />}
    />
  )
}

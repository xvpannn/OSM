import { useState, useEffect, useRef, useCallback } from 'react'
import type { View, Workspace, Lane, Signal, Stats, NewsItem } from '../types'
import {
  fetchDatasets, fetchSignals, fetchStats, fetchStatus, fetchNews,
  deleteSignal, purgeDataset, mergeDatasets, fmt
} from '../api'

interface Props { 
  onNavigate: (v: View, countryCode?: 'us' | 'uk') => void
  initialCountry: 'us' | 'uk'
}

interface LogLine { type: 'log' | 'error' | 'sys'; text: string }

const EMPTY_STATS: Stats = { processed_filings: 0, signals_stored: 0, sec_signals: 0 }

const formatInjectedAt = (ts?: string) => {
  if (!ts) return 'INJECTED AT: UNKNOWN'
  try {
    const cleanTs = ts.includes('T') ? ts : ts.replace(' ', 'T')
    const d = new Date(cleanTs)
    if (isNaN(d.getTime())) return `INJECTED AT: ${ts}`
    const pad = (n: number) => String(n).padStart(2, '0')
    const hours = pad(d.getHours())
    const minutes = pad(d.getMinutes())
    const day = pad(d.getDate())
    const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
    const month = monthNames[d.getMonth()]
    const year = d.getFullYear()
    return `INJECTED AT ${hours}.${minutes} ${day} ${month} ${year}`
  } catch {
    return `INJECTED AT: ${ts}`
  }
}

const displayDatasetName = (name: string) => {
  if (name === 'default') return 'DATA#1';
  if (name === 'all') return 'ALL BATCHES';
  return name.toUpperCase();
};

export default function DashboardView({ onNavigate, initialCountry }: Props) {
  const [workspace,    setWorkspace]    = useState<Workspace>('etl')
  const lane: Lane = 'sec'
  const [dataset,      setDataset]      = useState('')
  const [datasets,     setDatasets]     = useState<string[]>([])
  const [signals,      setSignals]      = useState<Signal[]>([])
  const [stats,        setStats]        = useState<Stats>(EMPTY_STATS)
  const [newsList,     setNewsList]     = useState<NewsItem[]>([])
  const [activeTarget, setActiveTarget] = useState<Signal | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [logLines,     setLogLines]     = useState<LogLine[]>([])
  const [newDsName,    setNewDsName]    = useState('')
  const [etlMode,      setEtlMode]      = useState<'inject' | 'create'>('create')
  const [etlDs,        setEtlDs]        = useState('')
  const [mergeTarget,  setMergeTarget]  = useState('')
  const [dateMode,     setDateMode]     = useState<'live' | 'custom'>('live')
  const [startDate,    setStartDate]    = useState('')
  const [endDate,      setEndDate]      = useState('')
  const [country,      setCountry]      = useState<'us' | 'uk'>(initialCountry)
  const [etlQuery,     setEtlQuery]     = useState('')
  const [etlCompany,   setEtlCompany]   = useState('')
  const [etlEbitdaMin, setEtlEbitdaMin] = useState('')
  const [etlEbitdaMax, setEtlEbitdaMax] = useState('')
  const [ukApiKey,     setUkApiKey]     = useState(() => localStorage.getItem('osm_uk_api_key') || '')
  const logRef  = useRef<HTMLDivElement>(null)
  const esRef   = useRef<EventSource | null>(null)

  useEffect(() => {
    localStorage.setItem('osm_uk_api_key', ukApiKey)
  }, [ukApiKey])

  const loadAll = useCallback(async (ds: string, ln: Lane, activeCountry: 'us' | 'uk' = 'us') => {
    try {
      const [sigs, st, dsList, nw] = await Promise.all([
        fetchSignals(ln, ds, activeCountry),
        fetchStats(ds, activeCountry),
        fetchDatasets(activeCountry),
        fetchNews(ds, activeCountry)
      ])
      setSignals(sigs)
      setStats(st)
      setDatasets(dsList)
      setNewsList(nw)
      setActiveTarget(prev =>
        prev ? (sigs.find(s => s.id === prev.id) ?? sigs[0] ?? null) : (sigs[0] ?? null)
      )
    } catch { }
  }, [])

  useEffect(() => {
    fetchStatus().then(s => setIsExtracting(s.isRunning))
  }, [])

  useEffect(() => {
    switchCountry(initialCountry)
  }, [initialCountry])

  const switchCountry = async (c: 'us' | 'uk') => {
    setCountry(c)
    if (c === 'uk' && workspace === 'news') {
      setWorkspace('data')
    }
    // Clear/delete active state of views to guarantee complete visual isolation
    setDataset('')
    setEtlDs('')
    setSignals([])
    setStats(EMPTY_STATS)
    setNewsList([])
    setActiveTarget(null)
    setEtlQuery('')
    setEtlCompany('')
    setEtlEbitdaMin('')
    setEtlEbitdaMax('')

    try {
      const dsList = await fetchDatasets(c)
      setDatasets(dsList)
      if (dsList.length > 0) {
        const preferred = dsList.find(d => d !== 'default') || 'default'
        setDataset(preferred)
        setEtlDs(preferred)
        await loadAll(preferred, lane, c)
      }
    } catch {
      setDatasets([])
    }
  }

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logLines])

  const tickerItems = signals.slice(0, 10)

  const runExtraction = () => {
    if (isExtracting) return
    const target = etlMode === 'create'
      ? newDsName.trim().replace(/\s+/g, '_').toLowerCase()
      : etlDs
    if (!target) { alert('Please enter a valid dataset name.'); return }

    if (dateMode === 'custom' && (!startDate || !endDate)) {
      alert('Please fill in both Start Date and End Date for custom range.')
      return
    }

    setIsExtracting(true)
    setLogLines([{ type: 'sys', text: `[SYS] Connecting to pipeline agent for dataset: "${target}" (${country.toUpperCase()})...` }])

    const token = localStorage.getItem('osm_session_token') || ''
    let trackUrl = `/api/track?dataset=${encodeURIComponent(target)}&country=${encodeURIComponent(country)}&token=${encodeURIComponent(token)}`
    if (country === 'uk' && ukApiKey.trim()) {
      trackUrl += `&apiKey=${encodeURIComponent(ukApiKey.trim())}`
    }
    if (dateMode === 'custom' && startDate && endDate) {
      trackUrl += `&startdate=${startDate}&enddate=${endDate}`
    }
    if (country === 'uk') {
      if (etlQuery.trim()) {
        trackUrl += `&query=${encodeURIComponent(etlQuery.trim())}`
      }
      if (etlCompany.trim()) {
        trackUrl += `&company=${encodeURIComponent(etlCompany.trim())}`
      }
      const minVal = parseFloat(etlEbitdaMin)
      const maxVal = parseFloat(etlEbitdaMax)
      if (!isNaN(minVal) && minVal > 0) trackUrl += `&ebitda-min=${minVal}`
      if (!isNaN(maxVal) && maxVal > 0) trackUrl += `&ebitda-max=${maxVal}`
    }

    const es = new EventSource(trackUrl)
    esRef.current = es

    es.onmessage = (ev) => {
      const data = JSON.parse(ev.data)
      if (data.type === 'log')      setLogLines(p => [...p, { type: 'log', text: data.message }])
      else if (data.type === 'error') setLogLines(p => [...p, { type: 'error', text: data.message }])
      else if (data.type === 'complete') {
        es.close()
        setLogLines(p => [...p, { type: 'sys', text: `[SYS] Pipeline run completed. Exit code: ${data.code}` }])
        setIsExtracting(false)
        setDataset(target)
        setEtlDs(target)
        loadAll(target, lane, country)

        // Reset input for next custom run
        setNewDsName('')
      }
    }

    es.onerror = () => {
      es.close()
      setLogLines(p => [...p, { type: 'error', text: '[SYS] EventSource connection failed. Ensure Express server is running on port 3001.' }])
      setIsExtracting(false)
    }
  }

  useEffect(() => () => { esRef.current?.close() }, [])

  const switchDataset = (ds: string) => {
    setDataset(ds)
    setEtlDs(ds)
    loadAll(ds, lane, country)
  }


  const handleDelete = async (id: number) => {
    if (!confirm(`Confirm PURGE operation on Signal ID: SIG-${id}?\nThis action is permanent.`)) return
    try {
      await deleteSignal(id, country)
      setActiveTarget(null)
      await loadAll(dataset, lane, country)
    } catch (e: any) { alert('Purge failed: ' + e.message) }
  }

  const handlePurgeDataset = async () => {
    if (!confirm(`PURGE DATASET "${displayDatasetName(dataset)}"?\nThis permanently deletes ALL signals for this dataset.`)) return
    try {
      await purgeDataset(dataset, country)
      const dsList = await fetchDatasets(country)
      const remaining = dsList.filter(d => d !== dataset)
      const nextDs = remaining[0] || 'default'
      setDataset(nextDs)
      setEtlDs(nextDs)
      await loadAll(nextDs, lane, country)
    } catch (e: any) { alert('Purge failed: ' + e.message) }
  }

  const handleMerge = async () => {
    if (!mergeTarget || mergeTarget === dataset) return
    if (!confirm(`Merge "${displayDatasetName(dataset)}" into "${displayDatasetName(mergeTarget)}"?`)) return
    try {
      await mergeDatasets(dataset, mergeTarget, country)
      setDataset(mergeTarget)
      await loadAll(mergeTarget, lane, country)
    } catch (e: any) { alert('Merge failed: ' + e.message) }
  }

  const urgencyColor = (u: string) =>
    u === 'CRITICAL' ? 'text-red-500' : u === 'HIGH' || u === 'MEDIUM' ? 'text-amber-500' : 'text-zinc-300'

  const barColor = (u: string) =>
    u === 'CRITICAL' ? 'bg-red-500' : u === 'HIGH' || u === 'MEDIUM' ? 'bg-amber-500' : 'bg-zinc-400'

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-300 overflow-hidden font-sans relative z-0">
      {/* Apple-style background elements */}
      <div className="fixed inset-0 z-[-1] bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-zinc-900 via-zinc-950 to-black pointer-events-none" />
      <div className="absolute top-[10%] left-[-10%] w-[40vw] h-[40vh] bg-emerald-900/15 rounded-full blur-[120px] pointer-events-none z-[-1] animate-pulse-slow" />
      <div className="absolute top-[40%] right-[-10%] w-[30vw] h-[50vh] bg-blue-900/10 rounded-full blur-[120px] pointer-events-none z-[-1] animate-pulse-slow" style={{ animationDelay: '2s' }} />

      <header className="flex-none h-12 border-b border-white/10 bg-black/40 backdrop-blur-2xl flex items-center justify-between px-4 z-50">
        <div className="flex items-center gap-6 h-full">
          <button
            onClick={() => onNavigate('landing')}
            className="text-white text-lg font-bold tracking-tighter flex items-center gap-2 hover:text-zinc-300 transition-colors font-mono mr-2"
          >
            <span className="w-2 h-2 bg-white rounded-full animate-pulse" /> OSM
          </button>

          <div className="flex bg-zinc-900 border border-zinc-800/60 p-0.5 rounded-lg items-center">
            {(['etl', 'data', 'news'] as Workspace[]).filter(ws => ws !== 'news' || country === 'us').map(ws => (
              <button
                key={ws}
                onClick={() => setWorkspace(ws)}
                className={`px-3 py-1 text-[9px] font-mono uppercase tracking-widest rounded-md font-bold transition-all ${
                  workspace === ws
                    ? 'bg-zinc-800 text-white shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {ws === 'etl' ? 'Database' : ws === 'data' ? 'Terminal' : 'News Feed'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 h-full border-l border-zinc-800/50 pl-6">
            <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-mono font-bold">Dataset:</span>
            <select
              value={dataset}
              onChange={e => switchDataset(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-300 font-bold font-mono outline-none px-2.5 py-1 uppercase rounded-md cursor-pointer hover:border-zinc-700 transition"
            >
              {datasets.length === 0 ? (
                <option value="" disabled>NO DATASETS</option>
              ) : (
                datasets.map(ds => <option key={ds} value={ds}>{displayDatasetName(ds)}</option>)
              )}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-6 h-full">
          {/* Premium country selection toggle placed immediately to the left of the Standby Mode / Extraction Running status */}
          <div className="flex bg-zinc-900 border border-zinc-800/60 p-0.5 rounded-lg items-center gap-0.5 font-mono">
            {(['us', 'uk'] as const).map(c => (
              <button
                key={c}
                onClick={() => onNavigate('dashboard', c)}
                className={`px-3 py-1 text-[9px] font-mono uppercase tracking-widest rounded-md font-bold transition-all ${
                  country === c
                    ? 'bg-zinc-800 text-white shadow-sm font-black border border-white/10'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {c.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-4 text-[10px] font-mono uppercase tracking-widest h-full pl-6 border-l border-zinc-800/50">
            <span className="flex items-center gap-2 font-bold">
              {workspace === 'etl' ? (
                isExtracting ? (
                  <>
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                    </span>
                    <span className="text-white">Extraction Running</span>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-zinc-600" />
                    <span className="text-zinc-500">Standby Mode</span>
                  </>
                )
              ) : (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                  </span>
                  <span className="text-green-500 font-bold">Terminal Active</span>
                </>
              )}
            </span>
            <span className="text-zinc-500">OP: <span className="text-zinc-300 max-w-[150px] truncate inline-block align-bottom">{localStorage.getItem('osm_user_email') || 'GUEST_01'}</span></span>
            <button
              onClick={() => {
                localStorage.removeItem('osm_session_token');
                localStorage.removeItem('osm_user_email');
                localStorage.removeItem('osm_is_master');
                onNavigate('landing');
              }}
              className="px-2.5 py-1 bg-red-950/25 hover:bg-red-500 border border-red-900/40 hover:border-red-500 text-red-500 hover:text-black text-[8px] font-bold rounded transition-all tracking-wider uppercase active:scale-[0.96]"
            >
              Disconnect Node
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden relative z-10">

        {workspace === 'etl' && (
          <div className="h-full overflow-y-auto p-6 lg:p-10 animate-apple-in">
            <div className="max-w-4xl mx-auto flex flex-col gap-8">

              <div className="flex justify-between items-end border-b border-zinc-800/40 pb-6">
                <div>
                  <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-2 font-bold">Extraction Pipeline</p>
                  <h1 className="text-3xl font-bold text-white tracking-tight uppercase">
                    {country === 'uk'
                      ? 'Corporate Accounts Ingestion'
                      : lane === 'sec'
                      ? 'Wealth Management Extraction'
                      : 'SBA Credit Gap Extraction'}
                  </h1>
                </div>
                <div className="text-right">
                  <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest mb-1.5 font-bold">Target Endpoint</div>
                  <div className="text-xs font-mono text-zinc-300 bg-zinc-950 border border-zinc-800 px-3 py-1.5 rounded-lg shadow-sm">
                    {country === 'uk'
                      ? 'api.company-information.service.gov.uk'
                      : lane === 'sec'
                      ? 'api.sec.gov/edgar/form4'
                      : 'data.sba.gov/foia/7a'}
                  </div>
                </div>
              </div>

              <div>
                <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-4 font-bold">Database Core Stats</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { label: 'Processed Filings',   val: stats.processed_filings, color: 'text-white' },
                    { label: 'Wealth Signals',      val: stats.sec_signals,        color: 'text-white' },
                    { label: 'Total Active',        val: stats.sec_signals,        color: 'text-green-500' },
                  ].map(s => (
                    <div key={s.label} className="border border-white/10 bg-white/[0.03] backdrop-blur-2xl p-5 rounded-2xl transition-all duration-500 hover:scale-[1.02] hover:border-white/20 hover:bg-white/5 shadow-lg">
                      <div className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">{s.label}</div>
                      <div className={`text-3xl font-extrabold font-mono mt-1 ${s.color}`}>{s.val}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border border-white/10 bg-white/[0.02] backdrop-blur-2xl p-6 rounded-2xl shadow-xl">
                <p className="text-[10px] font-mono text-zinc-300 uppercase tracking-widest mb-5 font-bold flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-white rounded-full" /> Track Mode Configuration
                </p>
                <div className="flex gap-6 mb-5">
                  {(['inject', 'create'] as const).map(m => (
                    <label key={m} className="flex items-center gap-2 cursor-pointer group">
                      <input type="radio" checked={etlMode === m} onChange={() => setEtlMode(m)} className="accent-white cursor-pointer" />
                      <span className={`text-[9px] uppercase tracking-widest font-bold font-mono transition ${etlMode === m ? 'text-white' : 'text-zinc-500 group-hover:text-zinc-300'}`}>
                        {m === 'inject' ? 'Inject to Existing' : 'Create New Dataset'}
                      </span>
                    </label>
                  ))}
                </div>

                {etlMode === 'inject' ? (
                  <select
                    value={etlDs}
                    onChange={e => setEtlDs(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 font-mono px-3 py-3 outline-none rounded-lg focus:border-zinc-700 transition cursor-pointer"
                  >
                    {datasets.length === 0 ? (
                      <option value="" disabled>NO DATASETS</option>
                    ) : (
                      datasets.map(ds => <option key={ds} value={ds}>INJECT TO: {displayDatasetName(ds)}</option>)
                    )}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={newDsName}
                    onChange={e => setNewDsName(e.target.value)}
                    placeholder="e.g. PORTFOLIO_OMEGA"
                    className="w-full bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 font-mono px-3 py-3 outline-none rounded-lg focus:border-zinc-700 transition uppercase"
                  />
                )}

                <div className="mt-4 pt-4 border-t border-zinc-800/40">
                  <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest mb-3 font-bold">Date Range</p>
                  <div className="flex gap-6 mb-3">
                    {(['live', 'custom'] as const).map(m => (
                      <label key={m} className="flex items-center gap-2 cursor-pointer group">
                        <input type="radio" checked={dateMode === m} onChange={() => setDateMode(m)} className="accent-white cursor-pointer" />
                        <span className={`text-[9px] uppercase tracking-widest font-bold font-mono transition ${dateMode === m ? 'text-white' : 'text-zinc-500 group-hover:text-zinc-300'}`}>
                          {m === 'live' ? 'Live Feed (Last 24h)' : 'Custom Date Range'}
                        </span>
                      </label>
                    ))}
                  </div>
                  {dateMode === 'custom' && (
                    <div className="grid grid-cols-2 gap-3 mt-4">
                      <div>
                        <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest mb-1.5 font-bold">Start Date</div>
                        <input
                          type="date"
                          value={startDate}
                          onChange={e => setStartDate(e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 font-mono px-3 py-2 outline-none rounded-lg focus:border-zinc-700 transition"
                        />
                      </div>
                      <div>
                        <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest mb-1.5 font-bold">End Date</div>
                        <input
                          type="date"
                          value={endDate}
                          onChange={e => setEndDate(e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 font-mono px-3 py-2 outline-none rounded-lg focus:border-zinc-700 transition"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {country === 'uk' && (
                  <div className="mt-4 pt-4 border-t border-zinc-800/40 flex flex-col gap-4 animate-apple-in">
                    <div>
                      <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest mb-1.5 font-bold">Companies House API Key <span className="text-red-500 font-bold">*</span></div>
                      <input
                        type="password"
                        value={ukApiKey}
                        onChange={e => setUkApiKey(e.target.value)}
                        placeholder="Enter your UK Companies House API Key"
                        required
                        className="w-full bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 font-mono px-3 py-2.5 outline-none rounded-lg focus:border-zinc-700 transition"
                      />
                      <div className="text-[8px] font-mono text-zinc-600 mt-1 uppercase">Stored securely in your local browser session cache</div>
                      <div className="text-[8px] font-mono text-zinc-500 mt-1.5 leading-relaxed">
                        Here is <a href="https://developer.company-information.service.gov.uk/how-to-create-an-application" target="_blank" rel="noreferrer" className="text-white underline hover:text-zinc-300 transition font-bold">how you create your own API key (it's free!)</a>
                      </div>
                    </div>
                    <div>
                      <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest mb-1.5 font-bold">Search Query <span className="text-zinc-600">(optional)</span></div>
                      <input
                        type="text"
                        value={etlQuery}
                        onChange={e => setEtlQuery(e.target.value)}
                        placeholder="e.g. technology, energy, retail"
                        className="w-full bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 font-mono px-3 py-2.5 outline-none rounded-lg focus:border-zinc-700 transition"
                      />
                      <div className="text-[8px] font-mono text-zinc-600 mt-1 uppercase">Leave blank for dynamic sector rotation</div>
                    </div>
                    <div>
                      <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest mb-1.5 font-bold">EBITDA Filter <span className="text-zinc-600">(£ GBP — optional)</span></div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <input
                            type="number"
                            value={etlEbitdaMin}
                            onChange={e => setEtlEbitdaMin(e.target.value)}
                            placeholder="Min e.g. 500000"
                            min="0"
                            className="w-full bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 font-mono px-3 py-2.5 outline-none rounded-lg focus:border-zinc-700 transition"
                          />
                          <div className="text-[8px] font-mono text-zinc-600 mt-1 uppercase">Minimum EBITDA (£)</div>
                        </div>
                        <div>
                          <input
                            type="number"
                            value={etlEbitdaMax}
                            onChange={e => setEtlEbitdaMax(e.target.value)}
                            placeholder="Max e.g. 50000000"
                            min="0"
                            className="w-full bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 font-mono px-3 py-2.5 outline-none rounded-lg focus:border-zinc-700 transition"
                          />
                          <div className="text-[8px] font-mono text-zinc-600 mt-1 uppercase">Maximum EBITDA (£)</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="border border-white/10 bg-black/40 backdrop-blur-2xl flex flex-col rounded-2xl overflow-hidden shadow-2xl">
                <div className="bg-zinc-900/60 border-b border-zinc-800/40 px-4 py-3 flex justify-between items-center select-none">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                    <span className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                    <span className="w-3 h-3 rounded-full bg-[#27c93f]" />
                    <span className="text-[10px] font-mono text-zinc-500 ml-2 uppercase tracking-widest font-bold">Terminal extraction process</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${isExtracting ? 'bg-amber-500 animate-pulse' : 'bg-zinc-600'}`} />
                    <span className="text-[9px] font-mono text-zinc-400 uppercase tracking-widest font-bold">
                      {isExtracting ? 'Engine Active' : 'Engine Idle'}
                    </span>
                  </div>
                </div>

                <div className="border-b border-zinc-800/40 p-4 flex justify-between items-center bg-zinc-900/20">
                  <div className="flex gap-2 items-center">
                    {dataset !== 'default' && (
                      <button
                        onClick={handlePurgeDataset}
                        className="text-[9px] font-mono text-red-500 px-3 py-1.5 border border-red-900/40 bg-red-950/20 rounded-md hover:bg-red-500 hover:text-black transition uppercase tracking-wider font-bold"
                      >
                        PURGE DATASET
                      </button>
                    )}
                    <button
                      onClick={runExtraction}
                      disabled={isExtracting}
                      className={`px-6 py-2.5 font-mono font-bold text-xs uppercase tracking-widest rounded-md flex items-center gap-2 border transition-all ${
                        isExtracting
                          ? 'bg-zinc-900 text-zinc-600 border-zinc-800 cursor-not-allowed'
                          : 'bg-green-500 text-black border-green-500 hover:bg-black hover:text-green-500 hover:scale-[1.02]'
                      }`}
                    >
                      {isExtracting ? 'Extracting...' : 'Stealth Track (Extract live)'}
                    </button>
                    <a
                      href={`/api/export?dataset=${encodeURIComponent(dataset)}&country=${encodeURIComponent(country)}&token=${encodeURIComponent(localStorage.getItem('osm_session_token') || '')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-6 py-2.5 bg-zinc-900 text-white border border-zinc-800 font-mono font-bold text-xs uppercase tracking-widest rounded-md flex items-center gap-2 transition-all hover:bg-white hover:text-black hover:scale-[1.02]"
                    >
                      ↓ Export CSV
                    </a>
                  </div>
                </div>

                <div
                  ref={logRef}
                  className="h-96 overflow-y-auto bg-black/90 p-6 font-mono text-xs leading-relaxed border-t border-zinc-900"
                >
                  {logLines.length === 0 ? (
                    <div className="text-zinc-600 uppercase tracking-widest font-bold">&gt; AWAITING EXECUTION COMMAND...</div>
                  ) : logLines.map((l, i) => (
                    <div
                      key={i}
                      className={
                        l.type === 'error' ? 'text-red-500 font-bold uppercase mt-1' :
                        l.type === 'sys'   ? 'text-amber-500 font-bold mt-1 uppercase' :
                        'text-zinc-300 uppercase'
                      }
                    >
                      {l.text}
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        )}

        {workspace === 'data' && (
          <div className="h-full flex overflow-hidden animate-apple-in">

            <section className="w-[320px] lg:w-[25%] border-r border-white/10 flex flex-col bg-black/40 backdrop-blur-2xl flex-none z-10">
              <div className="flex-none p-4 border-b border-white/10 flex flex-col gap-3 bg-transparent">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-xs font-mono font-bold text-white uppercase tracking-wider">
                      Wealth Stream
                    </h2>
                    <p className="text-[9px] font-mono text-zinc-500 mt-1 uppercase">
                      Filter: Financial Metrics
                    </p>
                  </div>
                  <span className="font-mono text-[9px] bg-zinc-900 border border-zinc-800 text-zinc-400 px-2 py-0.5 rounded-md font-bold">
                    {signals.length} RECORDS
                  </span>
                </div>
                {signals.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <a
                      href={`/api/export?dataset=${encodeURIComponent(dataset)}&country=${encodeURIComponent(country)}&token=${encodeURIComponent(localStorage.getItem('osm_session_token') || '')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="w-full text-center py-2 bg-zinc-900 hover:bg-white text-zinc-300 hover:text-black border border-zinc-800 font-mono font-bold text-[9px] uppercase tracking-widest rounded transition-all active:scale-[0.98]"
                    >
                      ↓ Export {dataset === 'all' ? 'All Batches' : `Batch: ${displayDatasetName(dataset)}`} to CSV
                    </a>
                    {dataset !== 'default' && dataset !== 'all' && (
                      <button
                        onClick={handlePurgeDataset}
                        className="w-full text-center py-2 bg-red-950/20 hover:bg-red-500 text-red-500 hover:text-black border border-red-900/40 font-mono font-bold text-[9px] uppercase tracking-widest rounded transition-all active:scale-[0.98]"
                      >
                        Purge Dataset
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto bg-transparent">
                {signals.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-center p-6">
                    <div className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest font-bold">
                      No records found.<br />Run a track command first.
                    </div>
                  </div>
                ) : signals.map(item => {
                  const isActive = activeTarget?.id === item.id
                  const indicator = country === 'uk'
                    ? `${item.employees || 0} Employees`
                    : `${(item.sell_ratio * 100).toFixed(1)}% Sold`
                  return (
                    <div
                      key={item.id}
                      onClick={() => setActiveTarget(item)}
                      className={`p-4 border-b border-white/5 cursor-pointer transition-all duration-300 ${
                        isActive 
                          ? 'bg-white/10 border-l-2 border-l-white shadow-inner' 
                          : 'bg-transparent hover:bg-white/5'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-1.5">
                        <span className={`text-sm font-bold truncate pr-2 ${urgencyColor(item.urgency)}`}>
                          {item.company_name}
                        </span>
                        <span className={`text-xs font-mono px-2 py-0.5 rounded-md font-black whitespace-nowrap border ${
                          country === 'uk'
                            ? 'bg-zinc-950 border-green-900/60 text-green-400'
                            : item.transaction_value > 0
                            ? 'bg-zinc-950 border-green-900/60 text-green-400'
                            : 'bg-zinc-950 border-zinc-800 text-zinc-500'
                        }`}>
                          {country === 'uk' ? item.ebitda_estimate || '—' : item.transaction_value > 0 ? fmt(item.transaction_value) : '—'}
                        </span>
                      </div>
                      <div className="text-[10px] font-mono flex justify-between items-end mt-1">
                        <div className="text-zinc-500 truncate pr-2 max-w-[60%] uppercase leading-relaxed">
                          {country === 'uk' ? (
                            <>
                              <span className="inline-block px-1 py-0 mr-1 border border-blue-500/50 text-blue-400 font-bold text-[8px] rounded-sm">
                                UK CO
                              </span>
                              {item.company_number || '—'}<br />
                              <span className="text-zinc-600 font-bold">{item.signal_date || '—'}</span>
                            </>
                          ) : (
                            <>
                              <span className={`inline-block px-1 py-0 mr-1 border font-bold text-[8px] rounded-sm ${
                                item.form_type === '4' ? 'border-white/20 text-white' :
                                item.form_type === '144' ? 'border-amber-500/50 text-amber-500' :
                                item.form_type === '8-K' ? 'border-zinc-600 text-zinc-500' :
                                'border-green-500/50 text-green-400'
                              }`}>
                                {`F-${item.form_type}`}
                              </span>
                              {item.ticker !== 'N/A' ? item.ticker : ''}<br />
                              <span className="text-zinc-600 font-bold">{item.signal_date}</span>
                            </>
                          )}
                        </div>
                        <div className={`uppercase tracking-wider font-bold ${urgencyColor(item.urgency)}`}>
                          {indicator}
                        </div>
                      </div>
                      <div className="mt-2.5 flex flex-col gap-1 select-none">
                        <div className="flex items-center gap-1.5 text-[8px] font-mono text-zinc-400 uppercase tracking-wider bg-zinc-900/30 border border-zinc-800/45 px-2 py-0.5 rounded w-fit">
                          <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full" />
                          BATCH: {item.dataset}
                        </div>
                        {item.injected_at && (
                          <div className="text-[7.5px] font-mono text-zinc-500 uppercase tracking-widest pl-0.5 font-bold leading-normal">
                            {formatInjectedAt(item.injected_at)}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="flex-1 overflow-hidden flex flex-col relative bg-transparent">
              {!activeTarget ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-transparent z-20">
                  <div className="w-12 h-12 rounded-full border border-zinc-800 flex items-center justify-center text-zinc-600 mb-4 animate-pulse">
                    ⌘
                  </div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-2">INTELLIGENCE CONSOLE</h3>
                  <p className="text-[10px] text-zinc-500 max-w-xs uppercase font-mono tracking-widest leading-relaxed">
                    No target selected. Choose a prospect from the left lane to inspect its full vetted data profile.
                  </p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto animate-apple-fade pb-16">
                  
                  <div className="p-8 lg:p-10 border-b border-white/10 flex flex-col sm:flex-row justify-between sm:items-center gap-6 sticky top-0 z-30 backdrop-blur-3xl bg-black/40">
                    <div>
                      <div className="flex items-center gap-3 mb-3 flex-wrap">
                        <span className="font-mono text-[9px] bg-zinc-900 border border-zinc-700 px-2 py-0.5 text-white font-bold rounded-md uppercase">
                          {country === 'uk' ? 'UK Company Profile' : activeTarget.form_type === 'SBA' ? 'SBA 7(a) Loan' : `SEC Form ${activeTarget.form_type}`}
                        </span>
                        <span className="font-mono text-[9px] border border-zinc-800 px-2 py-0.5 text-zinc-500 font-bold rounded-md">
                          SIG-{activeTarget.id}
                        </span>
                        <span className="font-mono text-[9px] bg-zinc-900/60 border border-zinc-850 px-2 py-0.5 text-zinc-300 font-bold rounded-md uppercase tracking-wider">
                          BATCH: {activeTarget.dataset}
                        </span>
                        {activeTarget.injected_at && (
                          <span className="font-mono text-[9px] bg-zinc-900/40 border border-zinc-850 px-2 py-0.5 text-zinc-400 font-bold rounded-md uppercase tracking-wider">
                            {formatInjectedAt(activeTarget.injected_at)}
                          </span>
                        )}
                        <span className="font-mono text-[9px] text-zinc-500 font-bold">{activeTarget.signal_date}</span>
                      </div>
                      <h1 className="text-3xl font-extrabold text-white tracking-tight uppercase">{activeTarget.company_name}</h1>
                      <div className="mt-3.5 max-w-xl text-[10px] font-mono text-zinc-300 border border-zinc-800/80 bg-zinc-900/30 p-4 leading-relaxed uppercase rounded-lg">
                        {country === 'uk' ? (
                          `${activeTarget.company_name} is a UK registered company (${activeTarget.company_number || '—'}) operating under SIC code ${activeTarget.sic_codes || '—'}. EBITDA is estimated at ${activeTarget.ebitda_estimate || '—'} on a turnover of ${activeTarget.turnover || '—'}. Registered address is ${activeTarget.registered_address || '—'}.`
                        ) : activeTarget.form_type === '144' ? (
                          `${activeTarget.insider_name} (${activeTarget.title || 'Insider'}) filed intent to sell ${activeTarget.shares_sold > 0 ? activeTarget.shares_sold.toLocaleString() : 'shares'} of ${activeTarget.company_name} (~${fmt(activeTarget.transaction_value)}) with planned sale date ${activeTarget.signal_date}.`
                        ) : (
                          `${activeTarget.insider_name} (${activeTarget.title || 'Insider'}) sold ${activeTarget.shares_sold > 0 ? activeTarget.shares_sold.toLocaleString() : 'shares'} of ${activeTarget.company_name} for ${fmt(activeTarget.transaction_value)} — ${activeTarget.sell_ratio > 0 ? `${(activeTarget.sell_ratio * 100).toFixed(1)}%` : 'restricted'} of holdings.`
                        )}
                      </div>
                    </div>
                    <div className="sm:text-right border-l-2 sm:border-l-0 sm:border-r-2 border-white pl-4 sm:pl-0 sm:pr-4">
                      <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest mb-1 font-bold">
                        {country === 'uk' ? 'EBITDA Estimate' : 'Disposal Value (USD)'}
                      </div>
                      <div className="text-4xl font-extrabold text-white tracking-tighter font-mono">
                        {country === 'uk' ? activeTarget.ebitda_estimate || '—' : fmt(activeTarget.transaction_value)}
                      </div>
                    </div>
                  </div>

                  <div className="p-8 lg:p-10 border-b border-white/10 bg-transparent">
                    <h3 className="text-[10px] font-mono font-bold text-white uppercase tracking-widest mb-6 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-white rounded-full" /> Objective Scoring &amp; Risk Metrics
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                      {country === 'uk' ? (
                        <div>
                          <div className="flex justify-between text-[10px] font-mono uppercase font-bold mb-2">
                            <span className="text-zinc-500 tracking-wider">
                              Turnover / EBITDA Profile
                            </span>
                            <span className="text-white font-extrabold tracking-widest">
                              {activeTarget.turnover || '—'} Turnover
                            </span>
                          </div>
                          <div className="relative w-full h-3 bg-zinc-900 border border-zinc-800 p-0.5 rounded-full overflow-hidden">
                            <div
                              className="absolute top-0 left-0 h-full transition-all duration-1000 rounded-full bg-blue-500"
                              style={{ width: '100%' }}
                            />
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="flex justify-between text-[10px] font-mono uppercase font-bold mb-2">
                            <span className="text-zinc-500 tracking-wider">
                              Sell Ratio
                            </span>
                            <span className="text-white font-extrabold tracking-widest">
                              {`${(activeTarget.sell_ratio * 100).toFixed(1)}% Sold`}
                            </span>
                          </div>
                          <div className="relative w-full h-3 bg-zinc-900 border border-zinc-800 p-0.5 rounded-full overflow-hidden">
                            <div
                              className={`absolute top-0 left-0 h-full transition-all duration-1000 rounded-full ${barColor(activeTarget.urgency)}`}
                              style={{ width: `${Math.min(100, Math.round(activeTarget.sell_ratio * 100))}%` }}
                            />
                          </div>
                        </div>
                      )}
                      <div className="border-l-2 border-white pl-6 py-1">
                        <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest mb-1.5 font-bold">System Assessment</div>
                        <div className={`text-sm font-mono font-bold uppercase tracking-widest ${urgencyColor(activeTarget.urgency)}`}>
                          {country === 'uk' ? `${activeTarget.urgency}: Profile Active` : `${activeTarget.urgency}: Liquidation Event`}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-8 lg:p-10 bg-transparent flex-1">
                    <div className="flex justify-between items-center mb-8">
                      <h3 className="text-[9px] font-mono font-bold text-white uppercase tracking-widest flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-white rounded-full" /> Vetted Target Data Profile
                      </h3>
                      <div className="flex gap-2 items-center">
                        <button
                          onClick={() => handleDelete(activeTarget.id)}
                          className="text-[9px] font-mono text-red-500 px-3 py-1.5 border border-red-900/40 bg-red-950/20 rounded-md hover:bg-red-500 hover:text-black transition font-bold"
                        >
                          PURGE SIGNAL
                        </button>
                        <span className="text-[9px] font-mono text-black px-2 py-1 border border-osm-yellow bg-osm-yellow font-bold rounded-md">PROD MODE DATA</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {(country === 'uk' ? [
                        { label: 'Company Name',            value: activeTarget.company_name,                                  hi: true },
                        { label: 'Company Number',          value: activeTarget.company_number || '—',                         hi: false },
                        { label: 'SIC Code & Description',  value: activeTarget.sic_codes || '—',                              hi: true },
                        { label: 'Registered Address',      value: activeTarget.registered_address || '—',                      hi: false },
                        { label: 'EBITDA Estimate',         value: activeTarget.ebitda_estimate || '—',                        hi: true },
                        { label: 'Turnover',                value: activeTarget.turnover || '—',                               hi: false },
                        { label: 'Employees',               value: activeTarget.employees ? String(activeTarget.employees) : '—', hi: false },
                        { label: 'Directors',               value: activeTarget.directors || '—',                              hi: true },
                        { label: 'Owners (PSC)',            value: activeTarget.owners_psc || '—',                             hi: false },
                        { label: 'Decision Makers',         value: activeTarget.decision_makers || '—',                        hi: true },
                        { label: 'Source URL',              value: null, url: activeTarget.source_url },
                        { label: 'Verification Status',     value: 'SIGNAL_COMPANIES_HOUSE_VERIFIED',                          hi: true },
                      ] : [
                        { label: 'Owner / Insider',         value: activeTarget.insider_name,                                 hi: true },
                        { label: 'Role / Title',            value: activeTarget.title || 'Insider',                           hi: false },
                        { label: 'Company / Ticker',        value: `${activeTarget.company_name} (${activeTarget.ticker})`,  hi: false },
                        { label: 'Shares Sold / Intended',  value: activeTarget.shares_sold > 0 ? activeTarget.shares_sold.toLocaleString() : '—', hi: true },
                        { label: 'Shares Remaining',        value: activeTarget.shares_remaining > 0 ? activeTarget.shares_remaining.toLocaleString() : '—', hi: false },
                        { label: 'Sell Ratio',              value: activeTarget.sell_ratio > 0 ? `${(activeTarget.sell_ratio * 100).toFixed(1)}%` : 'restricted', hi: true },
                        { label: 'Transaction Value',       value: fmt(activeTarget.transaction_value),                      hi: false },
                        { label: 'Filing URL',              value: null, url: activeTarget.source_url },
                        { label: 'Transaction Type',        value: activeTarget.form_type === '144' ? 'Intent to Sell (Form 144)' : 'Open Market Disposal (Form 4)', hi: false },
                        { label: 'Verification Status',     value: 'SIGNAL_SEC_VERIFIED',                                    hi: true },
                      ]).map((md: any) => (
                        <div key={md.label} className={`pl-4 py-3 rounded-lg border transition ${
                          md.hi 
                            ? 'border-white/20 bg-white/[0.05] shadow-lg scale-[1.01]' 
                            : 'border-white/5 bg-white/[0.02]'
                        }`}>
                          <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest mb-1 font-bold">{md.label}</div>
                          {md.url ? (
                            <a href={md.url} target="_blank" rel="noreferrer" className="text-xs font-mono text-white underline hover:text-zinc-300 transition uppercase break-all">
                              {country === 'uk' ? 'Companies House Official Source Link' : 'SEC Official Source Link'}
                            </a>
                          ) : (
                            <div className={`text-xs font-mono break-words uppercase ${md.hi ? 'text-white font-bold' : 'text-zinc-300'}`}>
                              {md.value}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {workspace === 'news' && (
          <div className="h-full overflow-y-auto p-6 lg:p-10 animate-apple-in">
            <div className="max-w-4xl mx-auto flex flex-col gap-8">
              <div className="flex justify-between items-end border-b border-white/10 pb-6">
                <div>
                  <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-2 font-bold">Live Intelligence Feed</p>
                  <h1 className="text-3xl font-bold text-white tracking-tight uppercase">
                    Material Events (8-K)
                  </h1>
                </div>
                <div className="text-right">
                  <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest mb-1.5 font-bold">News Filter</div>
                  <div className="text-xs font-mono text-zinc-300 bg-zinc-950 border border-zinc-800 px-3 py-1.5 rounded-lg shadow-sm">
                    CRITICAL ITEMS ONLY
                  </div>
                </div>
              </div>

              {newsList.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-center p-6 border border-white/10 bg-white/[0.02] backdrop-blur-2xl rounded-2xl">
                  <div className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest font-bold">
                    No material events found for this dataset.
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {newsList.map(news => (
                    <div key={news.id} className="border border-white/10 bg-white/[0.03] backdrop-blur-2xl p-6 rounded-2xl hover:bg-white/5 transition-all shadow-lg flex flex-col gap-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-3 mb-2">
                            <span className="font-mono text-[9px] bg-red-950 border border-red-900 px-2 py-0.5 text-red-500 font-bold rounded-md uppercase tracking-wider">
                              CRITICAL
                            </span>
                            <span className="font-mono text-[9px] border border-zinc-800 px-2 py-0.5 text-zinc-400 font-bold rounded-md">
                              SEC Form 8-K
                            </span>
                            <span className="text-[9px] font-mono text-zinc-500 font-bold">{news.published_at}</span>
                          </div>
                          <h2 className="text-xl font-bold text-white uppercase">{news.company_name} <span className="text-zinc-500">({news.ticker})</span></h2>
                        </div>
                        <a href={news.url} target="_blank" rel="noreferrer" className="text-[9px] font-mono text-white border border-white/20 bg-white/5 hover:bg-white hover:text-black px-3 py-1.5 rounded transition uppercase tracking-wider font-bold">
                          View Filing
                        </a>
                      </div>
                      <div className="text-xs font-mono text-zinc-400 bg-black/40 border border-white/5 p-4 rounded-xl leading-relaxed uppercase">
                        Material Event Code: <span className="text-white font-bold">{news.item_codes}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <div className="fixed bottom-0 left-0 w-full h-8 bg-zinc-950 border-t border-zinc-800/40 z-[100] flex items-center overflow-hidden">
        <div className="flex-none bg-white text-black font-mono text-[9px] font-bold px-3 h-full flex items-center gap-2 uppercase tracking-widest">
          <span className="w-1.5 h-1.5 bg-black rounded-full animate-pulse" /> LIVE SYS FEED
        </div>
        <div className="flex-1 overflow-hidden relative h-full flex items-center bg-zinc-950">
          {tickerItems.length > 0 ? (
            <div className="absolute whitespace-nowrap animate-ticker text-[10px] font-mono text-zinc-300 font-bold flex gap-8">
              {[...tickerItems, ...tickerItems].map((item, i) => (
                <span key={i} className={
                  item.urgency === 'CRITICAL' ? 'text-red-500' :
                  item.urgency === 'HIGH' || item.urgency === 'MEDIUM' ? 'text-amber-500' :
                  'text-zinc-300'
                }>
                  {country === 'uk'
                    ? `UK: PROFILE [${item.company_name}] NO: ${item.company_number || '—'} EBITDA: ${item.ebitda_estimate || '—'}`
                    : `SEC: FORM ${item.form_type} [${item.company_name}] VAL: ${item.transaction_value > 0 ? fmt(item.transaction_value) : 'RESTRICTED SALE'}`}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-[10px] font-mono text-zinc-500 ml-4">SYS: IDLE CHK OK — NO ACTIVE SIGNALS</span>
          )}
        </div>
      </div>
    </div>
  )
}

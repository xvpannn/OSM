import { useState, useEffect, useRef } from 'react'
import type { View, Signal } from '../types'
import { fetchStats, fetchSignals, fmt } from '../api'

interface Props { onNavigate: (v: View, countryCode?: 'us' | 'uk') => void }

interface MixedSignal extends Signal {
  countryCode: 'us' | 'uk'
}

export default function LandingView({ onNavigate }: Props) {
  const [time,       setTime]       = useState('')
  const [stats,      setStats]      = useState({ signals_stored: 0, processed_filings: 0 })
  const [latest,     setLatest]     = useState('--')
  const [radarList,  setRadarList]  = useState<MixedSignal[]>([])
  const [tickerHtml, setTickerHtml] = useState('')

  const howItWorksRef = useRef<HTMLDivElement>(null)

  const scrollToHowItWorks = () => {
    howItWorksRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    const tick = () => {
      const t = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      }).format(new Date())
      setTime(`${t} WITA`)
    }
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        const [statsUs, statsUk, signalsUs, signalsUk] = await Promise.all([
          fetchStats('all', 'us').catch(() => ({ signals_stored: 0, processed_filings: 0 })),
          fetchStats('all', 'uk').catch(() => ({ signals_stored: 0, processed_filings: 0 })),
          fetchSignals('sec', 'all', 'us').catch(() => []),
          fetchSignals('sec', 'all', 'uk').catch(() => [])
        ])

        setStats({
          signals_stored: (statsUs?.signals_stored || 0) + (statsUk?.signals_stored || 0),
          processed_filings: (statsUs?.processed_filings || 0) + (statsUk?.processed_filings || 0)
        })

        const combined: MixedSignal[] = [
          ...signalsUs.map(s => ({ ...s, countryCode: 'us' as const })),
          ...signalsUk.map(s => ({ ...s, countryCode: 'uk' as const }))
        ].sort((a, b) => new Date(b.signal_date).getTime() - new Date(a.signal_date).getTime())

        setRadarList(combined)

        if (combined.length > 0) {
          const first = combined[0]
          const info = first.countryCode === 'us'
            ? `${first.ticker || first.company_name} [US SEC FORM ${first.form_type} DISPOSED]`
            : `${first.company_name} [UK CH EBITDA: ${first.ebitda_estimate || 'VETTED'}]`
          setLatest(info)
        }

        const merged = combined.slice(0, 10)
        if (merged.length > 0) {
          const html = merged.map(i => {
            const isUk = i.countryCode === 'uk'
            const colorClass =
              i.urgency === 'CRITICAL' ? 'text-red-500 font-extrabold' :
              i.urgency === 'HIGH' || i.urgency === 'MEDIUM' ? 'text-amber-500 font-bold' :
              'text-white'

            const badge = isUk
              ? `<span class="bg-zinc-800 text-white border border-zinc-700 px-1 rounded text-[8px] mr-1.5 font-mono font-bold">UK</span>`
              : `<span class="bg-zinc-800 text-white border border-zinc-700 px-1 rounded text-[8px] mr-1.5 font-mono font-bold">US</span>`

            const content = isUk
              ? `${i.company_name} | EBITDA: ${i.ebitda_estimate || 'N/A'}`
              : `SEC: ${i.ticker || 'N/A'} [FORM ${i.form_type}] VAL: ${i.transaction_value > 0 ? fmt(i.transaction_value) : 'RESTRICTED SALE'}`

            return `<span class="inline-flex items-center mx-6 select-none ${colorClass}">${badge} ${content}</span>`
          }).join('')
          setTickerHtml(html + html)
        } else {
          setTickerHtml('<span class="text-zinc-500 px-6 font-mono text-[10px]">SYS: IDLE CHK OK — NO ACTIVE SIGNALS IN DEFAULT/GLOBAL POOLS</span>')
        }
      } catch (err) {
        console.error("Failed to load landing view stats:", err)
      }
    }
    load()
  }, [])

  return (
    <div className="min-h-screen w-full bg-zinc-950 flex flex-col p-4 md:pt-4 md:px-10 md:pb-16 relative font-sans overflow-x-hidden select-none z-0">
      <div className="fixed inset-0 z-[-1] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900 via-zinc-950 to-black pointer-events-none" />

      {/* Monochrome ambient glows */}
      <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vh] bg-[radial-gradient(ellipse_at_center,_rgba(255,255,255,0.04)_0%,_transparent_75%)] rounded-full pointer-events-none z-[-1]" />
      <div className="absolute top-[20%] right-[-10%] w-[40vw] h-[60vh] bg-[radial-gradient(ellipse_at_center,_rgba(255,255,255,0.03)_0%,_transparent_75%)] rounded-full pointer-events-none z-[-1]" />
      <div className="absolute bottom-[-10%] left-[20%] w-[60vw] h-[50vh] bg-[radial-gradient(ellipse_at_center,_rgba(255,255,255,0.02)_0%,_transparent_75%)] rounded-full pointer-events-none z-[-1]" />

      <div className="absolute inset-0 grid-bg opacity-[0.04] pointer-events-none z-[-1]" />

      <header className="flex justify-between items-center animate-apple-fade relative z-10">
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 bg-white rounded-full animate-pulse shadow-[0_0_8px_#ffffff]" />
          <span className="font-mono text-xs uppercase tracking-widest text-zinc-500 font-bold">OSM Quantitative Node v2.6</span>
        </div>
        <div className="font-mono text-xs text-white font-bold tracking-widest">{time || '--:--:-- WITA'}</div>
      </header>

      <main className="max-w-5xl mx-auto w-full text-center mt-4 md:mt-6 mb-3 flex flex-col justify-center items-center py-1 animate-apple-in relative z-10">
        <div className="relative mb-2 animate-apple-fade flex justify-center items-center">
          <div className="w-12 h-12 rounded-full border border-zinc-800/60 bg-zinc-950/80 flex items-center justify-center text-zinc-500 font-mono relative overflow-hidden group hover:border-white/50 transition-all duration-500 select-none cursor-pointer">
            <span className="absolute inset-0 bg-white/[0.02] rounded-full scale-0 group-hover:scale-100 transition-all duration-700" />
            <span className="absolute w-2 h-2 bg-white rounded-full animate-ping opacity-60" />
            <span className="relative text-sm font-bold text-white font-mono">⌘</span>
          </div>
        </div>

        <h1 className="text-5xl md:text-7xl font-extrabold tracking-[0.45em] uppercase text-gradient select-none font-mono leading-none pl-[0.45em]">
          OSM
        </h1>

        <p className="text-zinc-300 font-mono text-[10px] md:text-xs uppercase tracking-[0.3em] max-w-2xl mt-2.5 leading-relaxed font-bold">
          OPERATOR SYSTEM MANAGEMENT
        </p>

        <p className="text-zinc-500 font-mono text-[9px] md:text-[10px] uppercase tracking-widest max-w-2xl mt-2 mb-6 leading-relaxed">
          A dual-jurisdiction quantitative intelligence engine vetting real-time corporate insider disposal and restricted stock intent signals across both US and UK markets.
        </p>

        {/* Global Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 max-w-4xl w-full mb-5">
          <div className="premium-card py-3 px-4 flex flex-col items-center justify-center rounded-xl relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-[2px] bg-zinc-800/40 group-hover:bg-white/60 transition-all duration-500" />
            <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest mb-1 font-bold">Combined Vetted Signals</span>
            <span className="text-xl md:text-2xl font-bold text-white font-mono tracking-tight">{stats.signals_stored} STORED</span>
          </div>
          <div className="premium-card py-3 px-4 flex flex-col items-center justify-center rounded-xl relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-[2px] bg-zinc-800/40 group-hover:bg-white/60 transition-all duration-500" />
            <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest mb-1 font-bold">Processed Filings</span>
            <span className="text-xl md:text-2xl font-bold text-white font-mono tracking-tight">{stats.processed_filings} TOTAL</span>
          </div>
          <div className="premium-card py-3 px-4 flex flex-col items-center justify-center rounded-xl relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-[2px] bg-zinc-800/40 group-hover:bg-white/60 transition-all duration-500" />
            <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest mb-1 font-bold">UK Ingestion Mode</span>
            <span className="text-xl md:text-2xl font-bold text-white font-mono tracking-tight">XBRL CRAWLER</span>
          </div>
          <div className="premium-card py-3 px-4 flex flex-col items-center justify-center rounded-xl relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-[2px] bg-zinc-800/40 group-hover:bg-white/60 transition-all duration-500" />
            <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest mb-1 font-bold">US Ingestion Mode</span>
            <span className="text-xl md:text-2xl font-bold text-white font-mono tracking-tight">EDGAR LIVE FEED</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-lg justify-center">
          <button
            onClick={() => onNavigate('dashboard', 'us')}
            className="flex-1 bg-white hover:bg-zinc-200 text-black font-mono font-bold text-xs uppercase tracking-widest py-3 transition-all rounded-lg hover:scale-[1.02] shadow-lg active:scale-[0.98]"
          >
            🇺🇸 Enter US Terminal
          </button>
          <button
            onClick={() => onNavigate('dashboard', 'uk')}
            className="flex-1 bg-zinc-900 hover:bg-zinc-800 text-white border border-zinc-700 font-mono font-bold text-xs uppercase tracking-widest py-3 transition-all rounded-lg hover:scale-[1.02] shadow-lg active:scale-[0.98]"
          >
            🇬🇧 Enter UK Terminal
          </button>
          <button
            onClick={scrollToHowItWorks}
            className="sm:w-48 bg-zinc-950 hover:bg-zinc-900 text-zinc-300 border border-zinc-800 font-mono font-bold text-xs uppercase tracking-widest py-3 transition-all rounded-lg hover:scale-[1.02] active:scale-[0.98]"
          >
            ⚙ Mechanisms
          </button>
        </div>
      </main>

      {/* Global Live Vetting Radar */}
      <section className="max-w-4xl mx-auto w-full mt-12 md:mt-16 mb-6 premium-card p-4 rounded-xl relative overflow-hidden group">
        <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white to-transparent animate-scan" />

        <div className="relative z-10">
          <div className="flex items-center justify-between mb-4 border-b border-zinc-800/30 pb-3">
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500/80" />
                <span className="w-2 h-2 rounded-full bg-yellow-500/80" />
                <span className="w-2 h-2 rounded-full bg-green-500/80" />
              </div>
              <span className="h-3.5 w-[1px] bg-zinc-800" />
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white"></span>
              </span>
              <span className="text-[10px] font-mono text-zinc-300 uppercase tracking-widest font-bold">OSM DUAL-JURISDICTION PIPELINE FEED</span>
            </div>
            <span className="text-[8px] font-mono text-white uppercase tracking-widest animate-pulse font-bold bg-white/10 border border-white/20 px-2 py-0.5 rounded">
              SYNCED ACTIVE (US & UK)
            </span>
          </div>

          <div className="h-44 overflow-hidden border border-zinc-900/60 bg-zinc-950/80 rounded-lg p-3 relative select-none">
            {radarList.length === 0 ? (
              <div className="text-[10px] font-mono text-zinc-500 uppercase p-2 text-center mt-12">
                No active signals found in default databases — run the US or UK scraper in the terminals first.
              </div>
            ) : (
              <div className="flex flex-col animate-ticker-vertical hover:[animation-play-state:paused] cursor-pointer">
                {[...radarList, ...radarList].map((item, idx) => {
                  const isUk = item.countryCode === 'uk'
                  return (
                    <div
                      key={`${item.id}-${idx}`}
                      className="grid grid-cols-6 text-[10px] font-mono border-b border-zinc-900/25 py-3 text-zinc-400 items-center transition-colors hover:bg-zinc-900/40 px-2"
                    >
                      <div className="col-span-1">
                        <span className="bg-zinc-800 text-white border border-zinc-700 px-2 py-0.5 rounded text-[8px] font-bold">
                          {isUk ? 'UK' : 'US'}
                        </span>
                      </div>
                      <div className="col-span-3 truncate pr-2 text-white font-bold">
                        {item.company_name}
                        <span className="text-zinc-600 font-normal ml-2">{item.signal_date}</span>
                      </div>
                      <div className="col-span-1 text-zinc-300 font-bold">
                        {isUk
                          ? `${item.ebitda_estimate || 'N/A'}`
                          : item.transaction_value > 0 ? fmt(item.transaction_value) : 'RESTRICTED'
                        }
                      </div>
                      <div className={`col-span-1 text-right uppercase tracking-wider font-bold ${
                        item.urgency === 'CRITICAL' ? 'text-red-500' :
                        item.urgency === 'HIGH' || item.urgency === 'MEDIUM' ? 'text-amber-500' :
                        'text-zinc-400'
                      }`}>
                        {item.urgency}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Universal Mechanism Section */}
      <section
        ref={howItWorksRef}
        className="max-w-5xl mx-auto w-full premium-card p-8 md:p-12 mt-4 mb-4 rounded-2xl scroll-mt-6 animate-fade-in-up relative overflow-hidden group"
      >
        <div className="absolute top-0 left-0 w-full h-[2px] bg-zinc-800/30 group-hover:bg-white/40 transition-all duration-700" />
        <div className="border-b border-zinc-800/30 pb-6 mb-8 text-left">
          <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-2 font-bold">System Dataflow Mechanisms</p>
          <h2 className="text-3xl font-extrabold text-white tracking-tight uppercase">
            HOW IT WORKS: JURISDICTION PIPELINES
          </h2>
          <p className="text-xs text-zinc-500 font-mono mt-2 uppercase tracking-wide">
            Automated vetting engines optimized for the unique regulatory structures of both US and UK markets.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

          {/* US EDGAR Ingestion Pipeline */}
          <div className="bg-zinc-950/60 border border-zinc-900 p-6 rounded-xl flex flex-col justify-between text-left relative overflow-hidden group hover:border-white/20 transition-all">
            <div className="absolute top-0 left-0 w-full h-[1px] bg-zinc-800/40 group-hover:bg-white/30 transition-all" />
            <div>
              <div className="flex items-center gap-3 mb-4">
                <span className="font-mono text-[9px] text-black bg-white px-2 py-0.5 rounded-full font-bold">US JURISDICTION</span>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">EDGAR SEC Vetting Engine</h3>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed font-sans mb-6">
                Monitors real-time regulatory filings from major corporate insiders to discover high-value liquidity indicators and restricted stock sell intents.
              </p>

              <div className="space-y-6">
                <div className="border-l-2 border-white/30 pl-3">
                  <h4 className="text-[10px] font-mono font-bold text-zinc-200 uppercase tracking-widest mb-1">01. Multi-Lane Ingestion (EDGAR Feed)</h4>
                  <p className="text-[11px] text-zinc-500 font-mono">
                    Queries the SEC Live XML feeds, parsing Form 4 (executive acquisitions/disposals) and Form 144 (intent to sell restricted shares up to 90 days in advance).
                  </p>
                </div>
                <div className="border-l-2 border-white/30 pl-3">
                  <h4 className="text-[10px] font-mono font-bold text-zinc-200 uppercase tracking-widest mb-1">02. Mathematical Vetting (Sell Ratio)</h4>
                  <p className="text-[11px] text-zinc-500 font-mono">
                    Calculates holding reduction percentage: <code className="text-white bg-white/10 px-1 rounded">R = Sold / (Sold + Remaining)</code>. A strict 5% threshold filters out small transaction noise.
                  </p>
                </div>
                <div className="border-l-2 border-white/30 pl-3">
                  <h4 className="text-[10px] font-mono font-bold text-zinc-200 uppercase tracking-widest mb-1">03. Urgency Grading Model</h4>
                  <p className="text-[11px] text-zinc-500 font-mono">
                    Categorizes prospects dynamically: <span className="text-red-500 font-bold">CRITICAL</span> (value &gt; $10M or ratio &gt; 50%), <span className="text-amber-500 font-bold">HIGH</span> (value &gt; $1M by C-suite executives), or <span className="text-zinc-400 font-bold">MEDIUM</span>.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-3 bg-black/90 border border-zinc-900 rounded-lg font-mono text-[9px] text-zinc-400 mt-8">
              <div className="flex justify-between text-zinc-500 mb-1">
                <span>us_vetting_engine.ts</span>
                <span className="text-white font-bold">ACTIVE</span>
              </div>
              <div className="text-white font-semibold">IF R &lt; 0.05 =&gt; DISMISS_SIGNAL</div>
              <div className="text-zinc-500 mt-1">DB: edgar_data.sqlite (processed_filings / hnwi_signals)</div>
            </div>
          </div>

          {/* UK Companies House Pipeline */}
          <div className="bg-zinc-950/60 border border-zinc-900 p-6 rounded-xl flex flex-col justify-between text-left relative overflow-hidden group hover:border-white/20 transition-all">
            <div className="absolute top-0 left-0 w-full h-[1px] bg-zinc-800/40 group-hover:bg-white/30 transition-all" />
            <div>
              <div className="flex items-center gap-3 mb-4">
                <span className="font-mono text-[9px] text-black bg-white px-2 py-0.5 rounded-full font-bold">UK JURISDICTION</span>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">Companies House XBRL Crawler</h3>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed font-sans mb-6">
                Ingests financial statements directly in structured XBRL format using the UK Government's API and recursively traces ultimate individual beneficial ownership.
              </p>

              <div className="space-y-6">
                <div className="border-l-2 border-white/30 pl-3">
                  <h4 className="text-[10px] font-mono font-bold text-zinc-200 uppercase tracking-widest mb-1">01. Companies House Ingestion &amp; XBRL Parsing</h4>
                  <p className="text-[11px] text-zinc-500 font-mono">
                    Stream-reads government XBRL/iXBRL financial files directly, parsing balance sheets and income statements to extract operating profit and depreciation.
                  </p>
                </div>
                <div className="border-l-2 border-white/30 pl-3">
                  <h4 className="text-[10px] font-mono font-bold text-zinc-200 uppercase tracking-widest mb-1">02. Mathematical EBITDA Extraction</h4>
                  <p className="text-[11px] text-zinc-500 font-mono">
                    Computes financial strength indicators with a conservative floor estimate: <code className="text-white bg-white/10 px-1 rounded">EBITDA = Operating Profit + Depreciation</code>.
                  </p>
                </div>
                <div className="border-l-2 border-white/30 pl-3">
                  <h4 className="text-[10px] font-mono font-bold text-zinc-200 uppercase tracking-widest mb-1">03. Ownership PSC Chain Tracing</h4>
                  <p className="text-[11px] text-zinc-500 font-mono">
                    Recursively traverses corporate ownership hierarchies (Persons with Significant Control) to uncover the actual individual behind complex layers of holding companies.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-3 bg-black/90 border border-zinc-900 rounded-lg font-mono text-[9px] text-zinc-400 mt-8">
              <div className="flex justify-between text-zinc-500 mb-1">
                <span>uk_xbrl_pipeline.ts</span>
                <span className="text-white font-bold">ACTIVE</span>
              </div>
              <div className="text-white font-semibold">TRACER: 600 req / 5 min LIMIT CONTROL</div>
              <div className="text-zinc-500 mt-1">DB: edgar_data_uk.sqlite (processed_filings / hnwi_signals)</div>
            </div>
          </div>

        </div>

        <div className="border-t border-zinc-800/30 pt-8 mt-10 flex flex-col sm:flex-row gap-4 justify-center">
          <button
            onClick={() => onNavigate('dashboard', 'us')}
            className="flex-1 max-w-xs bg-white hover:bg-zinc-200 text-black font-mono font-bold text-xs uppercase tracking-widest py-4 transition-all rounded-lg hover:scale-[1.02] shadow-lg"
          >
            🇺🇸 US Terminal
          </button>
          <button
            onClick={() => onNavigate('dashboard', 'uk')}
            className="flex-1 max-w-xs bg-zinc-900 hover:bg-zinc-800 text-white border border-zinc-700 font-mono font-bold text-xs uppercase tracking-widest py-4 transition-all rounded-lg hover:scale-[1.02] shadow-lg"
          >
            🇬🇧 UK Terminal
          </button>
          <button
            onClick={() => onNavigate('library')}
            className="flex-1 max-w-xs bg-zinc-950 hover:bg-zinc-900 text-zinc-300 border border-zinc-800 font-mono font-bold text-xs uppercase tracking-widest py-4 transition-all rounded-lg hover:scale-[1.02]"
          >
            ⊞ Manual &amp; Documentation Library
          </button>
        </div>

        <div className="mt-10 pt-6 border-t border-zinc-800/20 flex justify-between items-center text-[9px] font-mono text-zinc-500 uppercase tracking-widest">
          <span>© {new Date().getFullYear()} OSM QUANTITATIVE LABS</span>
          <span>STATUS: SECURE_STANDBY</span>
        </div>
      </section>

      {/* Marquee Footer Live Stream ticker */}
      <div className="fixed bottom-0 left-0 w-screen h-8 bg-zinc-950 border-t border-zinc-800/40 z-[100] flex items-center overflow-hidden">
        <div className="flex-none bg-white text-black font-mono text-[9px] font-bold px-3 h-full flex items-center gap-2 uppercase tracking-widest">
          <span className="w-1.5 h-1.5 bg-black rounded-full animate-pulse" />
          UNIVERSAL FEED
        </div>
        <div className="flex-1 overflow-hidden relative h-full flex items-center bg-zinc-950">
          {tickerHtml ? (
            <div
              className="absolute whitespace-nowrap animate-ticker text-[10px] font-mono text-zinc-300 font-bold flex gap-8"
              dangerouslySetInnerHTML={{ __html: tickerHtml }}
            />
          ) : (
            <span className="text-[10px] font-mono text-zinc-500 ml-4">SYS: IDLE CHK OK — NO ACTIVE SIGNALS</span>
          )}
        </div>
      </div>
    </div>
  )
}

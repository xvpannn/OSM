import { useState } from 'react'
import type { View } from '../types'

type DocId = 'overview' | 'etl' | 'canonical' | 'math'

interface Props { onNavigate: (v: View) => void }

const DOCS: { id: DocId; label: string }[] = [
  { id: 'overview',    label: '1. Dual-Jurisdiction System Overview' },
  { id: 'etl',         label: '2. Ingestion & Crawling Pipelines' },
  { id: 'canonical',   label: '3. Unified Canonical Object Model' },
  { id: 'math',        label: '4. Mathematical Vetting & PSC Math' },
]

export default function LibraryView({ onNavigate }: Props) {
  const [active, setActive] = useState<DocId>('overview')

  return (
    <div className="absolute inset-0 bg-black flex flex-col fade-in select-none">
      <header className="h-14 border-b border-zinc-800 bg-black flex items-center justify-between px-6 flex-none">
        <div className="flex items-center gap-3">
          <span className="w-2.5 h-2.5 bg-white rounded-none animate-pulse" />
          <span className="font-mono text-xs uppercase tracking-widest font-bold text-white">OSM Documentation Library</span>
        </div>
        <button
          onClick={() => onNavigate('landing')}
          className="text-xs font-mono text-white hover:text-zinc-300 uppercase tracking-widest font-bold transition"
        >
          ← Back to Node
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-64 border-r border-zinc-850 bg-black p-4 flex flex-col gap-1 font-mono text-xs flex-none">
          <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-3 px-3 font-bold">Chapters</div>
          {DOCS.map(d => (
            <button
              key={d.id}
              onClick={() => setActive(d.id)}
              className={`text-left py-2.5 px-3 transition-colors rounded ${
                active === d.id
                  ? 'text-white font-bold bg-zinc-900 border-l-2 border-white pl-3'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-950'
              }`}
            >
              {d.label}
            </button>
          ))}
        </aside>

        <main className="flex-1 bg-black p-8 md:p-12 overflow-y-auto leading-relaxed">
          {active === 'overview' && (
            <article className="max-w-4xl text-left">
              <h1 className="text-3xl font-extrabold text-white mb-6 tracking-tight font-mono">1. DUAL-JURISDICTION SYSTEM OVERVIEW</h1>
              <p className="text-zinc-400 mb-6 text-sm">
                The OSM Intelligence System is an infrastructure-first, high-fidelity regulatory data intelligence node designed to crawl, vet, and store market liquidity signals. By expanding into both US and UK markets, OSM acts as a universal gateway bridging governmental filings with private wealth management workflows.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div className="border border-zinc-800 p-5 rounded-lg bg-zinc-950/30">
                  <h3 className="font-mono text-xs text-emerald-450 uppercase font-bold mb-2">🇺🇸 US Market Node</h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Watches corporate officers, C-suite executives, and major stakeholders. Parses transactions representing high-volume stock disposals (Form 4) and prospective restricted stock sales (Form 144) to evaluate liquidity events before they occur.
                  </p>
                </div>
                <div className="border border-zinc-800 p-5 rounded-lg bg-zinc-950/30">
                  <h3 className="font-mono text-xs text-blue-400 uppercase font-bold mb-2">🇬🇧 UK Market Node</h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Queries Companies House API and stream-reads government financial XBRL/iXBRL files directly to calculate operating margins, estimate real-time EBITDA, and trace ownership chains recursively back to the final individual controllers.
                  </p>
                </div>
              </div>

              <div className="border-l-2 border-white bg-zinc-900/35 p-4 mb-6">
                <h4 className="text-xs font-bold text-white uppercase tracking-widest font-mono mb-2">Architectural Highlights</h4>
                <ul className="list-disc list-inside text-xs text-zinc-400 space-y-1.5 font-mono">
                  <li><strong>Isolated Persistence</strong>: Parallel SQLite databases (<code className="text-white">edgar_data.sqlite</code> and <code className="text-white">edgar_data_uk.sqlite</code>) prevent file locking on concurrent executions.</li>
                  <li><strong>Duplicate Prevention</strong>: Unique constraints on URLs and filing metadata prevent duplicate entries from appearing in both pipelines.</li>
                  <li><strong>Deterministic Engine</strong>: 100% rule-based calculations without AI hallucination, guaranteeing exact compliance math.</li>
                </ul>
              </div>
            </article>
          )}

          {active === 'etl' && (
            <article className="max-w-4xl text-left">
              <h1 className="text-3xl font-extrabold text-white mb-6 tracking-tight font-mono">2. INGESTION &amp; CRAWLING PIPELINES</h1>
              <p className="text-zinc-400 mb-6 text-sm">
                OSM employs dedicated async pipelines to crawl structured government registries. To prevent API blocking, both crawlers feature native rate-limiting.
              </p>
              
              <div className="space-y-6 text-sm">
                <h3 className="text-sm font-bold text-white uppercase tracking-widest font-mono border-b border-zinc-900 pb-2">🇺🇸 US Ingestion Lanes</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { title: 'Lane A: SEC Form 4', desc: 'Queries real-time SEC EDGAR live feeds. Parses executive transactions representing stock disposals, mapping the shares sold vs remaining holding.' },
                    { title: 'Lane B: SEC Form 144', desc: 'Parses the intent to dispose of restricted securities. Captures prospective liquidity pipelines up to 90 days before actual market disposal.' },
                    { title: 'Lane C: SEC 8-K Feed', desc: 'Scrapes live 8-K material agreements representing major corporate merges, acquisitions, or restructuring events.' },
                  ].map(p => (
                    <div key={p.title} className="border border-zinc-800 p-4 bg-zinc-950/20 rounded-lg flex flex-col justify-between">
                      <h4 className="font-bold text-emerald-400 font-mono text-xs uppercase mb-1">{p.title}</h4>
                      <p className="text-[11px] text-zinc-400 leading-relaxed mt-2">{p.desc}</p>
                    </div>
                  ))}
                </div>

                <h3 className="text-sm font-bold text-white uppercase tracking-widest font-mono border-b border-zinc-900 pb-2 pt-4">🇬🇧 UK Ingestion Lanes</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    { title: 'Lane D: CH Accounts Filing & XBRL Ingestion', desc: 'Streams and downloads accounts files from Companies House. Parses structured XBRL/iXBRL tags to extract Operating Profit, Depreciation, and Turnover, yielding clean EBITDA calculations.' },
                    { title: 'Lane E: Persons of Significant Control (PSC) Chain Tracing', desc: 'Connects to Companies House REST gateway. Traces ownership nodes recursively through nested parent holding corporations until identifying the ultimate beneficial individual.' },
                  ].map(p => (
                    <div key={p.title} className="border border-zinc-800 p-4 bg-zinc-950/20 rounded-lg flex flex-col justify-between">
                      <h4 className="font-bold text-blue-400 font-mono text-xs uppercase mb-1">{p.title}</h4>
                      <p className="text-[11px] text-zinc-400 leading-relaxed mt-2">{p.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          )}

          {active === 'canonical' && (
            <article className="max-w-4xl text-left">
              <h1 className="text-3xl font-extrabold text-white mb-6 tracking-tight font-mono">3. UNIFIED CANONICAL OBJECT MODEL</h1>
              <p className="text-zinc-400 mb-6 text-sm">
                Both jurisdictions consolidate raw government data variants into a single, standardized, deterministic database matrix. UK-specific corporate fields exist dynamically to represent deep financial profiles.
              </p>
              
              <div className="bg-zinc-950 border border-zinc-900 rounded-lg p-6 font-mono text-xs text-zinc-350 leading-relaxed overflow-x-auto">
                <span className="text-zinc-550 font-bold">{'// Unified database model mapping (US & UK)'}</span><br/>
                {'{'}<br/>
                &nbsp;&nbsp;<span className="text-zinc-500">"company_name"</span>: <span className="text-emerald-400">"ARM LIMITED"</span>,<br/>
                &nbsp;&nbsp;<span className="text-zinc-500">"dataset"</span>: <span className="text-emerald-400">"default"</span>,<br/>
                &nbsp;&nbsp;<span className="text-zinc-500">"country"</span>: <span className="text-emerald-400">"uk"</span>, <span className="text-zinc-550">{'// "us" or "uk"'}</span><br/>
                &nbsp;&nbsp;<span className="text-zinc-500">"urgency"</span>: <span className="text-emerald-400">"CRITICAL"</span>,<br/>
                &nbsp;&nbsp;<span className="text-zinc-500">"signal_date"</span>: <span className="text-emerald-400">"2026-05-19"</span>,<br/>
                &nbsp;&nbsp;<span className="text-zinc-500">"source_url"</span>: <span className="text-emerald-400">"https://find-and-update.company-information.service.gov.uk/company/02546250"</span>,<br/>
                <br/>
                &nbsp;&nbsp;<span className="text-zinc-550">{'// --- US SEC SPECIFIC FIELDS ---'}</span><br/>
                &nbsp;&nbsp;<span className="text-zinc-500">"ticker"</span>: <span className="text-zinc-400">"ARM (null for UK)"</span>,<br/>
                &nbsp;&nbsp;<span className="text-zinc-550">"insider_name"</span>: <span className="text-zinc-400">"Rene Haas (null for UK)"</span>,<br/>
                &nbsp;&nbsp;<span className="text-zinc-550">"transaction_value"</span>: <span className="text-zinc-400">0.00</span>,<br/>
                &nbsp;&nbsp;<span className="text-zinc-555">"sell_ratio"</span>: <span className="text-zinc-400">0.00</span>,<br/>
                <br/>
                &nbsp;&nbsp;<span className="text-zinc-550">{'// --- UK COMPANIES HOUSE SPECIFIC FIELDS ---'}</span><br/>
                &nbsp;&nbsp;<span className="text-zinc-500">"company_number"</span>: <span className="text-emerald-400">"02546250"</span>,<br/>
                &nbsp;&nbsp;<span className="text-zinc-500">"sic_codes"</span>: <span className="text-emerald-400">"62012 — Software development"</span>,<br/>
                &nbsp;&nbsp;<span className="text-zinc-500">"ebitda_estimate"</span>: <span className="text-emerald-400">"£1,250,000,000"</span>,<br/>
                &nbsp;&nbsp;<span className="text-zinc-500">"turnover"</span>: <span className="text-emerald-400">"£2,680,000,000"</span>,<br/>
                &nbsp;&nbsp;<span className="text-zinc-500">"employees"</span>: <span className="text-emerald-400">3400</span>,<br/>
                &nbsp;&nbsp;<span className="text-zinc-500">"owners_psc"</span>: <span className="text-emerald-400">"SoftBank Group Corp. — 100% shares"</span>,<br/>
                &nbsp;&nbsp;<span className="text-zinc-500">"decision_makers"</span>: <span className="text-emerald-400">"Rene Haas (Appointed Director)"</span><br/>
                {'}'}
              </div>
            </article>
          )}

          {active === 'math' && (
            <article className="max-w-4xl text-left">
              <h1 className="text-3xl font-extrabold text-white mb-6 tracking-tight font-mono">4. MATHEMATICAL VETTING &amp; PSC MATH</h1>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 text-xs font-mono">
                
                {/* US Mathematical Model */}
                <div className="border border-zinc-800 p-5 rounded-lg bg-zinc-950/20">
                  <h3 className="text-sm font-bold text-emerald-450 uppercase mb-3">🇺🇸 US Model Mathematics</h3>
                  
                  <div className="bg-black border border-zinc-900 p-4 rounded mb-4">
                    <span className="text-white font-bold block mb-1">1. Form 4 Sell-Ratio formula</span>
                    <code>R = Shares Sold / (Shares Sold + Shares Remaining)</code>
                    <p className="mt-2 text-zinc-500">Transactions where R &lt; 5% are immediately dismissed to filter out routine option-exercises or tax-withholding noise.</p>
                  </div>

                  <div className="bg-black border border-zinc-900 p-4 rounded">
                    <span className="text-white font-bold block mb-1">2. Urgency Grades</span>
                    <ul className="list-disc list-inside space-y-1 mt-1 text-zinc-400">
                      <li><strong className="text-red-500">CRITICAL</strong>: Value &gt; $10,000,000 OR Ratio &gt; 50%.</li>
                      <li><strong className="text-amber-500">HIGH</strong>: Value &gt; $1,000,000 (C-Suite officers).</li>
                      <li><strong className="text-zinc-300">MEDIUM</strong>: Ratio between 5% and 20%.</li>
                    </ul>
                  </div>
                </div>

                {/* UK Mathematical Model */}
                <div className="border border-zinc-800 p-5 rounded-lg bg-zinc-950/20">
                  <h3 className="text-sm font-bold text-blue-450 uppercase mb-3">🇬🇧 UK Model Mathematics</h3>
                  
                  <div className="bg-black border border-zinc-900 p-4 rounded mb-4">
                    <span className="text-white font-bold block mb-1">1. EBITDA Estimator Formula</span>
                    <code>EBITDA = Operating Profit + Depreciation</code>
                    <p className="mt-2 text-zinc-500">Extracts tags directly from XBRL instance files. Represents a robust operational cash-flow floor estimate.</p>
                  </div>

                  <div className="bg-black border border-zinc-900 p-4 rounded">
                    <span className="text-white font-bold block mb-1">2. PSC Vetting &amp; Grading</span>
                    <ul className="list-disc list-inside space-y-1 mt-1 text-zinc-400">
                      <li><strong className="text-red-500">CRITICAL</strong>: EBITDA &gt; £10M OR direct individual beneficial ownership &gt; 75%.</li>
                      <li><strong className="text-amber-500">HIGH</strong>: EBITDA &gt; £1M OR control chains with &gt; 25% ownership.</li>
                      <li><strong className="text-zinc-300">MEDIUM</strong>: Active UK directors with verifiable local registered address.</li>
                    </ul>
                  </div>
                </div>

              </div>
            </article>
          )}
        </main>
      </div>
    </div>
  )
}

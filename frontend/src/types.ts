export interface Signal {
  id: number
  company_name: string
  ticker: string
  insider_name: string
  title: string
  form_type: string
  transaction_value: number
  sell_ratio: number
  urgency: string
  signal_date: string
  source_url: string
  dataset: string
  shares_sold: number
  shares_remaining: number
  injected_at?: string

  // UK company profile fields
  company_number?: string
  sic_codes?: string
  registered_address?: string
  ebitda_estimate?: string
  turnover?: string
  employees?: number
  directors?: string
  owners_psc?: string
  decision_makers?: string
}

export interface Stats {
  processed_filings: number
  signals_stored: number
  sec_signals: number
}

export interface NewsItem {
  id: number
  company_name: string
  ticker: string
  item_codes: string
  url: string
  published_at: string
  dataset: string
}

export type View      = 'landing' | 'library' | 'dashboard' | 'access'
export type Workspace = 'etl' | 'data' | 'news'
export type Lane      = 'sec'

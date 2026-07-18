export type DatePreset =
  | "Today"
  | "Last 7 Days"
  | "Last 14 Days"
  | "Last 30 Days"
  | "Month to Date"
  | "All Time"
  | "Custom Date";

export type SectionId =
  | "overview"
  | "strategy-pnl"
  | "account-equity"
  | "positions"
  | "trade-logs"
  | "diagnostics";

export type AccountOption = {
  account_id: string;
  broker_name?: string;
  initial_equity?: number | string;
  is_live?: boolean;
  [key: string]: unknown;
};

export type FilterOptions = {
  strategies: string[];
  accounts: AccountOption[];
};

export type TradeExecution = {
  timestamp?: string;
  strategy_name?: string;
  broker_account_id?: string;
  symbol?: string;
  sec_type?: string;
  side?: string;
  quantity?: number | string;
  price?: number | string;
  commission?: number | string;
  realized_pnl?: number | string;
  status?: string;
  notes?: string;
  strike?: number | string;
  expiry_date?: string;
  [key: string]: unknown;
};

export type AccountEquity = {
  date?: string;
  timestamp?: string;
  broker_account_id?: string;
  equity_value?: number | string;
  [key: string]: unknown;
};

export type StrategyDailyPnl = {
  date?: string;
  strategy_name?: string;
  broker_account_id?: string;
  total_equity?: number | string;
  daily_pnl?: number | string | null;
  realized_pnl?: number | string | null;
  unrealized_pnl?: number | string | null;
  commission?: number | string | null;
  total_pnl?: number | string | null;
  gross_market_value?: number | string | null;
  net_market_value?: number | string | null;
  valuation_status?: "VALUED" | "PARTIAL" | "UNPRICED" | string;
  calculation_source?: "REALIZED_ONLY" | "MARK_TO_MARKET" | string;
  updated_at?: string;
  [key: string]: unknown;
};

export type StrategyPosition = {
  snapshot_at?: string;
  trading_date?: string;
  strategy_name?: string;
  broker_account_id?: string;
  symbol?: string;
  local_symbol?: string;
  sec_type?: string;
  currency?: string;
  expiry_date?: string;
  strike?: number | string;
  right?: string;
  quantity?: number | string;
  average_cost?: number | string;
  multiplier?: number | string;
  mark_price?: number | string | null;
  previous_close?: number | string | null;
  price_change?: number | string | null;
  price_change_percent?: number | string | null;
  market_value?: number | string | null;
  day_change?: number | string | null;
  day_change_percent?: number | string | null;
  cost_basis?: number | string;
  unrealized_pnl?: number | string | null;
  gain_loss_percent?: number | string | null;
  mark_source?: string;
  source?: string;
  [key: string]: unknown;
};

export type DashboardQuery = {
  strategy: string;
  accountId: string;
  startDate: string;
  endDate: string;
  timezone: string;
  section: SectionId;
  includeExec: boolean;
  includePerf: boolean;
  includePnl: boolean;
  includePositions: boolean;
};

export type DashboardData = {
  execRows: TradeExecution[];
  perfRows: AccountEquity[];
  pnlRows: StrategyDailyPnl[];
  positionRows: StrategyPosition[];
};

export type KpiCards = {
  accountNav: number | null;
  navChange: number | null;
  navChangePercent: number | null;
  openPnl: number | null;
  periodPnl: number | null;
  totalCommission: number;
  periodPnlRecords: number;
  periodPnlPendingRecords: number;
  totalTrades: number;
  openPositions: number;
  openStrategies: number;
  pricedPositions: number;
};

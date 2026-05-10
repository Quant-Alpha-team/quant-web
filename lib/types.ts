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
  daily_pnl?: number | string;
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
};

export type DashboardData = {
  execRows: TradeExecution[];
  perfRows: AccountEquity[];
  pnlRows: StrategyDailyPnl[];
};

export type KpiCards = {
  currentEquity: number;
  equityChange: number;
  totalPnl: number;
  openTrades: number;
  totalCommission: number;
};

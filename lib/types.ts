export type DatePreset =
  | "Today"
  | "Last 7 Days"
  | "Last 14 Days"
  | "Last 30 Days"
  | "Month to Date"
  | "Last 10 Years"
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
};

export type StrategyVersionOption = {
  version: string | null;
  strategy_name: string;
  is_active: boolean;
};

export type StrategyFamilyOption = {
  family: string;
  versions: StrategyVersionOption[];
};

export type FilterOptions = {
  strategy_families: StrategyFamilyOption[];
  accounts: AccountOption[];
};

export type TradeExecution = {
  timestamp?: string;
  strategy_name?: string;
  strategy_family?: string;
  strategy_version?: string | null;
  broker_account_id?: string;
  symbol?: string;
  sec_type?: string;
  side?: string;
  quantity?: number | string;
  price?: number | string;
  commission?: number | string | null;
  realized_pnl?: number | string | null;
  status?: string;
  notes?: string | null;
};

export type AccountEquity = {
  date?: string;
  timestamp?: string;
  broker_account_id?: string;
  equity_value?: number | string;
};

export type StrategyDailyPnl = {
  date?: string;
  strategy_name?: string;
  strategy_family?: string;
  strategy_version?: string | null;
  broker_account_id?: string;
  daily_pnl?: number | string | null;
  realized_pnl?: number | string | null;
  unrealized_pnl?: number | string | null;
  commission?: number | string | null;
  valuation_status?: "VALUED" | "PARTIAL" | "UNPRICED" | string;
  calculation_source?: "REALIZED_ONLY" | "MARK_TO_MARKET" | string;
};

export type StrategyPosition = {
  snapshot_at?: string;
  strategy_name?: string;
  strategy_family?: string;
  strategy_version?: string | null;
  broker_account_id?: string;
  symbol?: string;
  local_symbol?: string | null;
  sec_type?: string;
  currency?: string;
  expiry_date?: string | null;
  strike?: number | string | null;
  right?: string | null;
  quantity?: number | string;
  average_cost?: number | string;
  mark_price?: number | string | null;
  market_value?: number | string | null;
  day_change?: number | string | null;
  cost_basis?: number | string;
  unrealized_pnl?: number | string | null;
  gain_loss_percent?: number | string | null;
  source?: string;
};

export type DashboardQuery = {
  strategyFamilies: string[];
  strategyVersions: string[];
  strategyScopes?: StrategyScope[];
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

export type StrategyScope = {
  strategyFamily: string;
  strategyVersion: string;
};

export type DatasetScopeMetadata = {
  requested: number;
  completed: number;
  incomplete: number;
  failed: number;
  incompleteLabels: string[];
  failedLabels: string[];
};

export type DatasetMetadata = {
  requested: boolean;
  fetched: number;
  total: number | null;
  truncated: boolean;
  complete: boolean;
  error: string | null;
  invalidRows: number;
  scopes: DatasetScopeMetadata;
};

export type DashboardDataMetadata = {
  requestedAt: string;
  completedAt: string;
  partial: boolean;
  datasets: {
    executions: DatasetMetadata;
    equity: DatasetMetadata;
    pnl: DatasetMetadata;
    positions: DatasetMetadata;
  };
};

export type DashboardData = {
  execRows: TradeExecution[];
  perfRows: AccountEquity[];
  pnlRows: StrategyDailyPnl[];
  positionRows: StrategyPosition[];
  meta: DashboardDataMetadata;
};

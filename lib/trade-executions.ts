import type { TradeExecution } from "@/lib/types";

type TradeExecutionFieldKind = "string" | "string?" | "number" | "number?";

export const TRADE_EXECUTION_ROW_SCHEMA = {
  timestamp: "string",
  strategy_name: "string",
  strategy_family: "string",
  broker_account_id: "string",
  symbol: "string",
  exchange: "string?",
  primary_exchange: "string?",
  sec_type: "string",
  side: "string",
  status: "string",
  strategy_version: "string?",
  notes: "string?",
  quantity: "number",
  price: "number",
  commission: "number?",
  realized_pnl: "number?",
} as const satisfies Record<keyof TradeExecution, TradeExecutionFieldKind>;

function actualExchange(value: string | undefined) {
  const normalized = value?.trim().toUpperCase();
  return normalized && normalized !== "SMART" && normalized !== "UNKNOWN"
    ? normalized
    : undefined;
}

export function tradeExecutionExchange(
  row: Pick<TradeExecution, "exchange" | "primary_exchange">,
) {
  return actualExchange(row.exchange) ?? actualExchange(row.primary_exchange);
}

export const TRADE_LOG_INSTRUMENT_COLUMNS = [
  { key: "symbol", label: "Symbol", read: (row: TradeExecution) => row.symbol },
  { key: "exchange", label: "Exchange", read: tradeExecutionExchange },
  { key: "type", label: "Type", read: (row: TradeExecution) => row.sec_type },
] as const satisfies readonly {
  key: string;
  label: string;
  read: (row: TradeExecution) => string | undefined;
}[];

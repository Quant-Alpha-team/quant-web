import type { TradeExecution } from "@/lib/types";

type TradeExecutionFieldKind = "string" | "string?" | "number" | "number?";

export const TRADE_EXECUTION_ROW_SCHEMA = {
  timestamp: "string",
  strategy_name: "string",
  strategy_family: "string",
  broker_account_id: "string",
  symbol: "string",
  exchange: "string?",
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

export const TRADE_LOG_INSTRUMENT_COLUMNS = [
  { key: "symbol", label: "Symbol", field: "symbol" },
  { key: "exchange", label: "Exchange", field: "exchange" },
  { key: "type", label: "Type", field: "sec_type" },
] as const satisfies readonly {
  key: string;
  label: string;
  field: keyof TradeExecution;
}[];

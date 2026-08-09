import { createLogger } from "./logger-core.mjs";

type LogFields = Record<string, unknown>;
type LogFunction = (message: string, fields?: LogFields) => void;

const logger = createLogger({ readySource: "logger.ts:0" });

export const logInfo: LogFunction = logger.logInfo;
export const logWarning: LogFunction = logger.logWarning;
export const logError: LogFunction = logger.logError;

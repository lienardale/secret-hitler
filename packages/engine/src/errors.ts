import type { EngineError, EngineErrorCode } from "./types";

export function engineError(code: EngineErrorCode, message: string): EngineError {
  return { code, message };
}

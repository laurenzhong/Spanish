import type { ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";

export class ExpressionAssistError extends Error {
  constructor(readonly code: ApiErrorCode, readonly status: number) {
    super(code); this.name = "ExpressionAssistError";
  }
}

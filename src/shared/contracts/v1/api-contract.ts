export const API_VERSION = "v1" as const;

export const API_ERROR_CODES = [
  "VALIDATION_FAILED",
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "RESOURCE_NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "PROTOCOL_VERSION_UNSUPPORTED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export type ApiError = Readonly<{
  code: ApiErrorCode;
  message: string;
  retryable: boolean;
  requestId?: string;
  details?: Readonly<Record<string, unknown>>;
}>;

export type ErrorResponse = Readonly<{
  apiVersion: typeof API_VERSION;
  error: ApiError;
}>;

export type PageInfo = Readonly<{
  nextCursor: string | null;
  hasMore: boolean;
}>;

export type SuccessResponse<T = unknown> = Readonly<{
  apiVersion: typeof API_VERSION;
  data: T;
  page?: PageInfo;
}>;

export type AuthSessionIdentity = Readonly<{
  userId: string;
  email: string | null;
}>;

const retryableByDefault: Readonly<Record<ApiErrorCode, boolean>> = {
  VALIDATION_FAILED: false,
  AUTH_REQUIRED: false,
  FORBIDDEN: false,
  RESOURCE_NOT_FOUND: false,
  CONFLICT: false,
  RATE_LIMITED: true,
  PROTOCOL_VERSION_UNSUPPORTED: false,
  PROVIDER_TIMEOUT: true,
  PROVIDER_UNAVAILABLE: true,
  INTERNAL_ERROR: true,
};

export class ContractParseError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ContractParseError";
  }
}

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return (
    typeof value === "string" &&
    API_ERROR_CODES.some((candidate) => candidate === value)
  );
}

export function defaultRetryable(code: string): boolean {
  if (!isApiErrorCode(code)) {
    throw new ContractParseError(
      "VALIDATION_FAILED",
      `Unknown API error code: ${code}`,
    );
  }
  return retryableByDefault[code];
}

export function parseErrorResponse(input: unknown): ErrorResponse {
  const response = requireRecord(input, "Response must be an object.");
  requireAllowedKeys(response, ["apiVersion", "error"]);
  requireSupportedVersion(response.apiVersion);
  const rawError = requireRecord(
    response.error,
    "Error response must include an error object.",
  );
  requireAllowedKeys(rawError, [
    "code",
    "message",
    "retryable",
    "requestId",
    "details",
  ]);

  if (!isApiErrorCode(rawError.code)) {
    throw new ContractParseError(
      "VALIDATION_FAILED",
      "Error response contains an unknown error code.",
    );
  }
  if (
    typeof rawError.message !== "string" ||
    rawError.message.length === 0 ||
    rawError.message.length > 500
  ) {
    throw new ContractParseError(
      "VALIDATION_FAILED",
      "Error response must include a message.",
    );
  }
  if (typeof rawError.retryable !== "boolean") {
    throw new ContractParseError(
      "VALIDATION_FAILED",
      "Error response must include retryable as a boolean.",
    );
  }

  const requestId = optionalString(rawError.requestId, "requestId");
  if (
    requestId !== undefined &&
    !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)
  ) {
    throw new ContractParseError(
      "VALIDATION_FAILED",
      "requestId has an invalid format.",
    );
  }
  const details =
    rawError.details === undefined
      ? undefined
      : requireRecord(rawError.details, "details must be an object.");

  return {
    apiVersion: API_VERSION,
    error: {
      code: rawError.code,
      message: rawError.message,
      retryable: rawError.retryable,
      ...(requestId === undefined ? {} : { requestId }),
      ...(details === undefined ? {} : { details }),
    },
  };
}

export function parseSuccessResponse<T = unknown>(
  input: unknown,
): SuccessResponse<T> {
  const response = requireRecord(input, "Response must be an object.");
  requireAllowedKeys(response, ["apiVersion", "data", "page"]);
  requireSupportedVersion(response.apiVersion);
  if (!("data" in response)) {
    throw new ContractParseError(
      "VALIDATION_FAILED",
      "Success response must include data.",
    );
  }

  return {
    apiVersion: API_VERSION,
    data: response.data as T,
    ...(response.page === undefined ? {} : { page: parsePageInfo(response.page) }),
  };
}

export function parseAuthSessionResponse(input: unknown): AuthSessionIdentity {
  const response = parseSuccessResponse(input);
  const data = requireRecord(
    response.data,
    "Auth session response must include a data object.",
  );
  requireAllowedKeys(data, ["userId", "email"]);

  if (
    typeof data.userId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      data.userId,
    )
  ) {
    throw new ContractParseError(
      "VALIDATION_FAILED",
      "Auth session userId must be a UUID.",
    );
  }
  if (data.email !== null && typeof data.email !== "string") {
    throw new ContractParseError(
      "VALIDATION_FAILED",
      "Auth session email must be a string or null.",
    );
  }

  return { userId: data.userId, email: data.email };
}

function parsePageInfo(input: unknown): PageInfo {
  const page = requireRecord(input, "page must be an object.");
  requireAllowedKeys(page, ["nextCursor", "hasMore"]);
  const nextCursor = page.nextCursor;
  if (
    nextCursor !== null &&
    (typeof nextCursor !== "string" ||
      nextCursor.length === 0 ||
      nextCursor.length > 512)
  ) {
    throw new ContractParseError(
      "VALIDATION_FAILED",
      "nextCursor must be a string or null.",
    );
  }
  if (typeof page.hasMore !== "boolean") {
    throw new ContractParseError(
      "VALIDATION_FAILED",
      "hasMore must be a boolean.",
    );
  }
  return { nextCursor, hasMore: page.hasMore };
}

function requireSupportedVersion(value: unknown): asserts value is typeof API_VERSION {
  if (value !== API_VERSION) {
    throw new ContractParseError(
      "PROTOCOL_VERSION_UNSUPPORTED",
      `Unsupported API version: ${String(value)}`,
    );
  }
}

function requireRecord(
  value: unknown,
  message: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ContractParseError("VALIDATION_FAILED", message);
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ContractParseError(
      "VALIDATION_FAILED",
      `${field} must be a string.`,
    );
  }
  return value;
}

function requireAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
) {
  const allowed = new Set(allowedKeys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new ContractParseError(
      "VALIDATION_FAILED",
      "Response contains an unsupported field.",
    );
  }
}

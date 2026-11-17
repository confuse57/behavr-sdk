import { BehavrApiErrorPayload } from "./types";

/**
 * Error codes the BEHAVR API returns inside FastAPI's `detail` object, e.g.
 * `{ "detail": { "error": "original_pending", "message": "..." } }`, or at the
 * top level of the payload.
 */
function detailObject(payload: BehavrApiErrorPayload | undefined): Record<string, unknown> | undefined {
  const detail = payload?.detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    return detail as Record<string, unknown>;
  }
  return undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function payloadCode(payload: BehavrApiErrorPayload | undefined): string | undefined {
  return nonEmptyString(detailObject(payload)?.error) ?? nonEmptyString(payload?.error);
}

function payloadMessage(payload: BehavrApiErrorPayload | undefined): string | undefined {
  const detail = detailObject(payload);
  return (
    nonEmptyString(detail?.message) ??
    nonEmptyString(payload?.detail) ??
    nonEmptyString(payload?.message) ??
    nonEmptyString(payload?.error)
  );
}

export class BehavrApiError extends Error {
  public readonly status: number;
  public readonly payload: BehavrApiErrorPayload | undefined;
  /** Machine-readable error code from the API (e.g. "original_pending"), if any. */
  public readonly code: string | undefined;

  constructor(status: number, payload: BehavrApiErrorPayload | undefined, fallbackMessage: string) {
    const message = payloadMessage(payload) || fallbackMessage;
    super(`BEHAVR API error (${status}): ${message}`);
    this.name = "BehavrApiError";
    this.status = status;
    this.payload = payload;
    this.code = payloadCode(payload);
  }
}

/** 404 `memory_not_found`: the memory does not exist for this API key (or was deleted). */
export class MemoryNotFoundError extends BehavrApiError {
  constructor(status: number, payload: BehavrApiErrorPayload | undefined, fallbackMessage: string) {
    super(status, payload, fallbackMessage);
    this.name = "MemoryNotFoundError";
  }
}

/** 404 `original_not_available`: the memory has no retained original. */
export class OriginalNotAvailableError extends BehavrApiError {
  constructor(status: number, payload: BehavrApiErrorPayload | undefined, fallbackMessage: string) {
    super(status, payload, fallbackMessage);
    this.name = "OriginalNotAvailableError";
  }
}

/** 409 `original_pending`: the original is still being processed; retry shortly. */
export class OriginalPendingError extends BehavrApiError {
  constructor(status: number, payload: BehavrApiErrorPayload | undefined, fallbackMessage: string) {
    super(status, payload, fallbackMessage);
    this.name = "OriginalPendingError";
  }
}

/** 409 `memory_processing`: the memory can't be deleted until processing finishes. */
export class MemoryProcessingError extends BehavrApiError {
  constructor(status: number, payload: BehavrApiErrorPayload | undefined, fallbackMessage: string) {
    super(status, payload, fallbackMessage);
    this.name = "MemoryProcessingError";
  }
}

/**
 * Build the most specific error for a failed response. Unknown codes (e.g.
 * `deletion_incomplete`, `original_temporarily_unavailable`) stay a plain
 * `BehavrApiError` with `code` set.
 */
export function createApiError(
  status: number,
  payload: BehavrApiErrorPayload | undefined,
  fallbackMessage: string
): BehavrApiError {
  const code = payloadCode(payload);
  if (status === 404 && code === "memory_not_found") {
    return new MemoryNotFoundError(status, payload, fallbackMessage);
  }
  if (status === 404 && code === "original_not_available") {
    return new OriginalNotAvailableError(status, payload, fallbackMessage);
  }
  if (status === 409 && code === "original_pending") {
    return new OriginalPendingError(status, payload, fallbackMessage);
  }
  if (status === 409 && code === "memory_processing") {
    return new MemoryProcessingError(status, payload, fallbackMessage);
  }
  return new BehavrApiError(status, payload, fallbackMessage);
}

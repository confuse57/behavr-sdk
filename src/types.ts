export interface BehavrClientOptions {
  /** API key for the BEHAVR API (required). */
  apiKey: string;
  /** Override the API base URL. Defaults to the production Railway URL. */
  baseUrl?: string;
}

/**
 * File to upload for `remember()`. Accepts a path on disk, a Buffer (with an
 * optional filename), or a native Blob/File instance.
 */
export type RememberFile =
  | string
  | Buffer
  | { buffer: Buffer; filename: string }
  | Blob;

export interface RememberOptions {
  file: RememberFile;
  externalUserId?: string;
  /** Which business/client this memory belongs to. Backend defaults to "default". */
  clientId?: string;
  /** Which agent within the client. Backend defaults to "default". */
  agentId?: string;
  /**
   * Keep a metadata-stripped copy of the original photo so it can be fetched
   * later with `getOriginal()`. Photos only; off by default. When omitted, the
   * field is not sent.
   */
  retainImage?: boolean;
}

export interface RememberResult {
  memoryId: string;
  status: string;
  summary: string;
  /** Non-fatal notes from the API, e.g. "low_resolution". */
  warnings?: string[];
}

export interface AskOptions {
  question: string;
  externalUserId?: string;
  /** Which business/client this memory belongs to. Backend defaults to "default". */
  clientId?: string;
  /** Which agent within the client. Backend defaults to "default". */
  agentId?: string;
}

/** One memory the answer says it used (from the API's `source_details`). */
export interface SourceDetail {
  memoryId: string;
  title: string;
  /** ISO 8601 timestamp, when known. */
  createdAt?: string | null;
  category?: string | null;
  /** Short excerpt of the memory's extracted text. */
  snippet: string;
  /** True when `getOriginal()` can return a link for this memory. */
  hasOriginal: boolean;
  lowResolution: boolean;
}

export interface AskResult {
  answer: string;
  /** Every memory id that was in context for the answer. */
  sources: string[];
  /**
   * Up to 3 memories the answer says it used, as reported by the model; may be
   * incomplete. Empty when the API doesn't return any.
   */
  sourceDetails: SourceDetail[];
  /** Non-fatal notes from the API, e.g. "low_resolution_sources". */
  warnings?: string[];
  /** Ids in `sources` that are low resolution. */
  lowResolutionSources?: string[];
}

export interface ListOptions {
  externalUserId?: string;
  /** Which business/client this memory belongs to. Backend defaults to "default". */
  clientId?: string;
  /** Which agent within the client. Backend defaults to "default". */
  agentId?: string;
  /** Maximum number of memories to return. */
  limit?: number;
  /** Only return memories with this processing status. */
  status?: string;
}

/**
 * A stored memory as returned by `list()`. Keys from the API are converted
 * from snake_case to camelCase (e.g. `memory_id` -> `memoryId`).
 */
export interface Memory {
  memoryId: string;
  title?: string;
  category?: string;
  status?: string;
  summary?: string;
  thumbnailUrl?: string | null;
  /** ISO 8601 timestamp. */
  createdAt?: string;
  sourceType?: string;
  /** True when `getOriginal()` can return a link for this memory. */
  hasOriginal?: boolean;
  [key: string]: unknown;
}

export interface ListResponse {
  memories: Memory[];
  total: number;
}

export interface GetOriginalOptions {
  /** Link lifetime in seconds. The API clamps it to 60..3600 (default 900). */
  expiresIn?: number;
}

/** A short-lived signed link to a retained original. */
export interface OriginalLink {
  /** Anyone with this link can download the file until it expires. */
  url: string;
  /** ISO 8601 timestamp. */
  expiresAt: string;
  /** Lifetime in seconds, after clamping. */
  expiresIn: number;
}

export interface DeleteMemoryResult {
  memoryId: string;
  deleted: boolean;
  deletedMemories: number;
  deletedFiles: number;
}

export interface BehavrApiErrorPayload {
  message?: string;
  error?: string;
  [key: string]: unknown;
}

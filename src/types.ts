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
}

export interface RememberResult {
  memoryId: string;
  status: string;
  summary: string;
}

export interface AskOptions {
  question: string;
  externalUserId?: string;
  /** Which business/client this memory belongs to. Backend defaults to "default". */
  clientId?: string;
  /** Which agent within the client. Backend defaults to "default". */
  agentId?: string;
}

export interface AskResult {
  answer: string;
  sources: string[];
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
  [key: string]: unknown;
}

export interface ListResponse {
  memories: Memory[];
  total: number;
}

export interface BehavrApiErrorPayload {
  message?: string;
  error?: string;
  [key: string]: unknown;
}

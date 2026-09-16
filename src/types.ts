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
}

export interface RememberResult {
  memoryId: string;
  status: string;
  summary: string;
}

export interface AskOptions {
  question: string;
  externalUserId?: string;
}

export interface AskResult {
  answer: string;
  sources: string[];
}

export interface BehavrApiErrorPayload {
  message?: string;
  error?: string;
  [key: string]: unknown;
}

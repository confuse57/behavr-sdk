import { readFile } from "fs/promises";
import { basename } from "path";
import {
  BehavrApiError,
  MemoryNotFoundError,
  MemoryProcessingError,
  OriginalNotAvailableError,
  OriginalPendingError,
  createApiError,
} from "./errors";
import {
  AskOptions,
  AskResult,
  BehavrApiErrorPayload,
  BehavrClientOptions,
  DeleteMemoryResult,
  GetOriginalOptions,
  ListOptions,
  ListResponse,
  Memory,
  OriginalLink,
  RememberFile,
  RememberOptions,
  RememberResult,
  SourceDetail,
} from "./types";

const DEFAULT_BASE_URL = "https://behavr-backend-production.up.railway.app";

export class BehavrClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: BehavrClientOptions) {
    if (!options?.apiKey) {
      throw new Error("BehavrClient requires an `apiKey`.");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  /**
   * Upload a file so BEHAVR can remember it.
   */
  async remember(options: RememberOptions): Promise<RememberResult> {
    if (!options?.file) {
      throw new Error("remember() requires a `file`.");
    }

    const { blob, filename } = await toBlob(options.file);

    const form = new FormData();
    form.append("file", blob, filename);
    if (options.externalUserId) {
      form.append("external_user_id", options.externalUserId);
    }
    if (options.clientId) {
      form.append("client_id", options.clientId);
    }
    if (options.agentId) {
      form.append("agent_id", options.agentId);
    }
    if (typeof options.retainImage === "boolean") {
      form.append("retain_image", options.retainImage ? "true" : "false");
    }

    const res = await fetch(`${this.baseUrl}/v1/remember`, {
      method: "POST",
      headers: { "X-API-Key": this.apiKey },
      body: form,
    });

    const data = await parseJson(res);
    if (!res.ok) {
      throw createApiError(res.status, data, "Failed to remember file.");
    }

    const result: RememberResult = {
      memoryId: data.memory_id,
      status: data.status,
      summary: data.summary,
    };
    if (Array.isArray(data?.warnings)) result.warnings = data.warnings;
    return result;
  }

  /**
   * Ask a question against BEHAVR's stored memories.
   */
  async ask(options: AskOptions): Promise<AskResult> {
    if (!options?.question) {
      throw new Error("ask() requires a `question`.");
    }

    const res = await fetch(`${this.baseUrl}/v1/ask`, {
      method: "POST",
      headers: {
        "X-API-Key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question: options.question,
        ...(options.externalUserId ? { external_user_id: options.externalUserId } : {}),
        ...(options.clientId ? { client_id: options.clientId } : {}),
        ...(options.agentId ? { agent_id: options.agentId } : {}),
      }),
    });

    const data = await parseJson(res);
    if (!res.ok) {
      throw createApiError(res.status, data, "Failed to get answer.");
    }

    const result: AskResult = {
      answer: data.answer,
      sources: data.sources ?? [],
      sourceDetails: Array.isArray(data?.source_details)
        ? data.source_details.map(toSourceDetail)
        : [],
    };
    if (Array.isArray(data?.warnings)) result.warnings = data.warnings;
    if (Array.isArray(data?.low_resolution_sources)) {
      result.lowResolutionSources = data.low_resolution_sources;
    }
    return result;
  }

  /**
   * List stored memories, optionally filtered by user and status.
   */
  async list({ externalUserId, clientId, agentId, limit, status }: ListOptions = {}): Promise<ListResponse> {
    const params = new URLSearchParams();
    if (externalUserId) params.set("external_user_id", externalUserId);
    if (clientId) params.set("client_id", clientId);
    if (agentId) params.set("agent_id", agentId);
    if (limit !== undefined) params.set("limit", String(limit));
    if (status) params.set("status", status);

    const query = params.toString();
    const res = await fetch(`${this.baseUrl}/v1/memories${query ? `?${query}` : ""}`, {
      method: "GET",
      headers: { "X-API-Key": this.apiKey },
    });

    const data = await parseJson(res);
    if (!res.ok) {
      throw createApiError(res.status, data, "Failed to list memories.");
    }

    const memories: Memory[] = (data?.memories ?? []).map(camelizeKeys);
    return {
      memories,
      total: data?.total ?? memories.length,
    };
  }

  /**
   * Get a short-lived signed link to a memory's retained original (uploaded
   * with `retainImage: true`). Anyone with the link can download the file
   * until it expires, so don't log or store it.
   *
   * Throws `MemoryNotFoundError` (404), `OriginalNotAvailableError` (404) or
   * `OriginalPendingError` (409). Other failures throw `BehavrApiError`.
   * Error messages never contain the signed link.
   */
  async getOriginal(memoryId: string, options: GetOriginalOptions = {}): Promise<OriginalLink> {
    requireMemoryId(memoryId, "getOriginal");

    const params = new URLSearchParams();
    if (options.expiresIn !== undefined) {
      if (!Number.isInteger(options.expiresIn)) {
        throw new Error("getOriginal() `expiresIn` must be a whole number of seconds.");
      }
      params.set("expires_in", String(options.expiresIn));
    }
    const query = params.toString();

    const res = await fetch(
      `${this.baseUrl}/v1/memories/${encodeURIComponent(memoryId)}/original${query ? `?${query}` : ""}`,
      { method: "GET", headers: { "X-API-Key": this.apiKey } }
    );

    const data = await parseJson(res);
    if (!res.ok) {
      throw createApiError(res.status, withoutUrls(data), "Failed to get original.");
    }
    if (typeof data?.url !== "string" || !data.url) {
      // Deliberately does not include the response body.
      throw new Error("getOriginal(): unexpected response from the BEHAVR API.");
    }

    return {
      url: data.url,
      expiresAt: data.expires_at,
      expiresIn: data.expires_in,
    };
  }

  /**
   * Delete one memory and everything derived from it (thumbnail, any
   * retained original). Copies outside BEHAVR's live storage, such as
   * infrastructure backups, are not covered. Scoped to the API key, not to
   * `clientId`. Deleting the same memory twice throws
   * `MemoryNotFoundError`.
   *
   * Throws `MemoryNotFoundError` (404) or `MemoryProcessingError` (409, still
   * processing). A 500 with code `deletion_incomplete` means the request
   * should be repeated; it is not retried automatically.
   */
  async deleteMemory(memoryId: string): Promise<DeleteMemoryResult> {
    requireMemoryId(memoryId, "deleteMemory");

    const res = await fetch(`${this.baseUrl}/v1/memories/${encodeURIComponent(memoryId)}`, {
      method: "DELETE",
      headers: { "X-API-Key": this.apiKey },
    });

    const data = await parseJson(res);
    if (!res.ok) {
      throw createApiError(res.status, data, "Failed to delete memory.");
    }

    return {
      memoryId: data.memory_id,
      deleted: data.deleted,
      deletedMemories: data.deleted_memories,
      deletedFiles: data.deleted_files,
    };
  }
}

function requireMemoryId(memoryId: unknown, method: string): void {
  if (typeof memoryId !== "string" || !memoryId.trim()) {
    throw new Error(`${method}() requires a \`memoryId\`.`);
  }
}

function toSourceDetail(raw: Record<string, any>): SourceDetail {
  return {
    memoryId: raw?.memory_id,
    title: raw?.title ?? "",
    createdAt: raw?.created_at ?? null,
    category: raw?.category ?? null,
    snippet: raw?.snippet ?? "",
    hasOriginal: raw?.has_original === true,
    lowResolution: raw?.low_resolution === true,
  };
}

const URL_PATTERN = /https?:\/\/\S+/gi;

/**
 * Defensive scrub for getOriginal() error payloads: drop any `url` field and
 * blank out anything that looks like a link, so a signed URL can never end up
 * in an exception message or a logged payload.
 */
function withoutUrls(value: any): BehavrApiErrorPayload | undefined {
  const scrub = (v: any): any => {
    if (typeof v === "string") return v.replace(URL_PATTERN, "[link removed]");
    if (Array.isArray(v)) return v.map(scrub);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, inner] of Object.entries(v)) {
        if (k === "url") continue;
        out[k] = scrub(inner);
      }
      return out;
    }
    return v;
  };
  return value === undefined ? undefined : scrub(value);
}

function camelizeKeys(obj: Record<string, unknown>): Memory {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  return out as Memory;
}

async function toBlob(file: RememberFile): Promise<{ blob: Blob; filename: string }> {
  if (typeof file === "string") {
    const buffer = await readFile(file);
    return { blob: new Blob([toArrayBuffer(buffer)]), filename: basename(file) };
  }

  if (Buffer.isBuffer(file)) {
    return { blob: new Blob([toArrayBuffer(file)]), filename: "upload.bin" };
  }

  if (file instanceof Blob) {
    const filename = (file as File).name || "upload.bin";
    return { blob: file, filename };
  }

  if ("buffer" in file && "filename" in file) {
    return { blob: new Blob([toArrayBuffer(file.buffer)]), filename: file.filename };
  }

  throw new Error(
    "Unsupported `file` value. Pass a file path (string), a Buffer, a { buffer, filename } object, or a Blob/File."
  );
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
}

async function parseJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export {
  BehavrApiError,
  MemoryNotFoundError,
  MemoryProcessingError,
  OriginalNotAvailableError,
  OriginalPendingError,
};
export * from "./types";

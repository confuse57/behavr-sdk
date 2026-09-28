import { readFile } from "fs/promises";
import { basename } from "path";
import { BehavrApiError } from "./errors";
import {
  AskOptions,
  AskResult,
  BehavrClientOptions,
  ListOptions,
  ListResponse,
  Memory,
  RememberFile,
  RememberOptions,
  RememberResult,
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

    const res = await fetch(`${this.baseUrl}/v1/remember`, {
      method: "POST",
      headers: { "X-API-Key": this.apiKey },
      body: form,
    });

    const data = await parseJson(res);
    if (!res.ok) {
      throw new BehavrApiError(res.status, data, "Failed to remember file.");
    }

    return {
      memoryId: data.memory_id,
      status: data.status,
      summary: data.summary,
    };
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
      throw new BehavrApiError(res.status, data, "Failed to get answer.");
    }

    return {
      answer: data.answer,
      sources: data.sources ?? [],
    };
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
      throw new BehavrApiError(res.status, data, "Failed to list memories.");
    }

    const memories: Memory[] = (data?.memories ?? []).map(camelizeKeys);
    return {
      memories,
      total: data?.total ?? memories.length,
    };
  }
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

export { BehavrApiError };
export * from "./types";

import { readFile } from "fs/promises";
import { basename } from "path";
import { BehavrApiError } from "./errors";
import {
  AskOptions,
  AskResult,
  BehavrClientOptions,
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

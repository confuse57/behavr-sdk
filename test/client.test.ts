import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  BehavrApiError,
  BehavrClient,
  MemoryNotFoundError,
  MemoryProcessingError,
  OriginalNotAvailableError,
  OriginalPendingError,
} from "../src/index";

const BASE = "https://api.example.test";
const SIGNED = "https://storage.example.test/originals/mem-1/original.jpg?X-Goog-Signature=abc123";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Replace fetch with a stub that records calls and returns one canned response. */
function mockFetch(status: number, body: unknown): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body,
    });
    const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, { status });
  }) as typeof fetch;
  return calls;
}

const client = () => new BehavrClient({ apiKey: "bhv_test_key", baseUrl: `${BASE}/` });
const detail = (error: string, message: string) => ({ detail: { error, message } });

// ---------------------------------------------------------------- remember

const file = { buffer: Buffer.from("fake-image"), filename: "photo.jpg" };

for (const [retainImage, expected] of [
  [true, "true"],
  [false, "false"],
] as const) {
  test(`remember() sends retain_image=${expected} when retainImage is ${retainImage}`, async () => {
    const calls = mockFetch(200, { memory_id: "mem-1", status: "queued", summary: "" });
    await client().remember({ file, retainImage });
    const form = calls[0].body as FormData;
    assert.equal(form.get("retain_image"), expected);
  });
}

test("remember() omits retain_image when retainImage is not given and keeps the result shape", async () => {
  const calls = mockFetch(200, { memory_id: "mem-1", status: "queued", summary: "" });
  const result = await client().remember({ file, clientId: "c1" });
  const form = calls[0].body as FormData;
  assert.equal(calls[0].url, `${BASE}/v1/remember`);
  assert.equal(calls[0].method, "POST");
  assert.equal(form.has("retain_image"), false);
  assert.equal(form.get("client_id"), "c1");
  assert.deepEqual(result, { memoryId: "mem-1", status: "queued", summary: "" });
});

test("remember() passes through warnings", async () => {
  mockFetch(200, { memory_id: "mem-1", status: "queued", summary: "", warnings: ["low_resolution"] });
  const result = await client().remember({ file, retainImage: true });
  assert.deepEqual(result.warnings, ["low_resolution"]);
});

test("remember() 422 for retain_image on a video is a BehavrApiError with code", async () => {
  mockFetch(422, detail("RETAIN_IMAGE_PHOTOS_ONLY", "retain_image=true is only supported for photos, not videos."));
  await assert.rejects(client().remember({ file, retainImage: true }), (err: unknown) => {
    assert.ok(err instanceof BehavrApiError);
    assert.equal(err.status, 422);
    assert.equal(err.code, "RETAIN_IMAGE_PHOTOS_ONLY");
    assert.match(err.message, /only supported for photos/);
    return true;
  });
});

// --------------------------------------------------------------------- ask

test("ask() maps source_details to camelCase and keeps sources", async () => {
  mockFetch(200, {
    answer: "It was a receipt.",
    sources: ["mem-1", "mem-2"],
    warnings: ["low_resolution_sources"],
    low_resolution_sources: ["mem-2"],
    source_details: [
      {
        memory_id: "mem-1",
        title: "Receipt",
        created_at: "2026-11-01T10:00:00Z",
        category: "document",
        snippet: "Total 42.00",
        has_original: true,
        low_resolution: false,
      },
    ],
  });
  const result = await client().ask({ question: "What was it?" });
  assert.equal(result.answer, "It was a receipt.");
  assert.deepEqual(result.sources, ["mem-1", "mem-2"]);
  assert.deepEqual(result.sourceDetails, [
    {
      memoryId: "mem-1",
      title: "Receipt",
      createdAt: "2026-11-01T10:00:00Z",
      category: "document",
      snippet: "Total 42.00",
      hasOriginal: true,
      lowResolution: false,
    },
  ]);
  assert.deepEqual(result.warnings, ["low_resolution_sources"]);
  assert.deepEqual(result.lowResolutionSources, ["mem-2"]);
});

test("ask() returns sourceDetails [] when the API omits source_details", async () => {
  mockFetch(200, { answer: "No completed captures.", sources: [] });
  const result = await client().ask({ question: "Anything?" });
  assert.deepEqual(result, { answer: "No completed captures.", sources: [], sourceDetails: [] });
});

// -------------------------------------------------------------------- list

test("list() exposes hasOriginal", async () => {
  mockFetch(200, {
    memories: [
      { memory_id: "mem-1", title: "A", has_original: true, created_at: "2026-11-01T10:00:00Z" },
      { memory_id: "mem-2", title: "B", has_original: false },
    ],
    total: 2,
  });
  const { memories } = await client().list();
  assert.equal(memories[0].hasOriginal, true);
  assert.equal(memories[0].createdAt, "2026-11-01T10:00:00Z");
  assert.equal(memories[1].hasOriginal, false);
});

// ------------------------------------------------------------- getOriginal

test("getOriginal() builds the URL, encodes the id and maps the response", async () => {
  const calls = mockFetch(200, { url: SIGNED, expires_at: "2026-11-17T10:15:00Z", expires_in: 300 });
  const link = await client().getOriginal("mem/1", { expiresIn: 300 });
  assert.equal(calls[0].url, `${BASE}/v1/memories/mem%2F1/original?expires_in=300`);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].headers["X-API-Key"], "bhv_test_key");
  assert.deepEqual(link, { url: SIGNED, expiresAt: "2026-11-17T10:15:00Z", expiresIn: 300 });
});

test("getOriginal() omits expires_in when not given", async () => {
  const calls = mockFetch(200, { url: SIGNED, expires_at: "2026-11-17T10:15:00Z", expires_in: 900 });
  await client().getOriginal("mem-1");
  assert.equal(calls[0].url, `${BASE}/v1/memories/mem-1/original`);
});

test("getOriginal() rejects an empty id or a fractional expiresIn without calling the API", async () => {
  const calls = mockFetch(200, {});
  await assert.rejects(client().getOriginal(""), /requires a `memoryId`/);
  await assert.rejects(client().getOriginal("mem-1", { expiresIn: 1.5 }), /whole number/);
  assert.equal(calls.length, 0);
});

const originalErrors: Array<[string, number, unknown, Function]> = [
  ["memory_not_found", 404, detail("memory_not_found", "Memory not found."), MemoryNotFoundError],
  [
    "original_not_available",
    404,
    detail("original_not_available", "This memory has no retained original."),
    OriginalNotAvailableError,
  ],
  [
    "original_pending",
    409,
    detail("original_pending", "The original is still being processed; retry shortly."),
    OriginalPendingError,
  ],
];

for (const [code, status, body, ErrorClass] of originalErrors) {
  test(`getOriginal() ${status} ${code} throws ${ErrorClass.name}`, async () => {
    mockFetch(status, body);
    await assert.rejects(client().getOriginal("mem-1"), (err: unknown) => {
      assert.ok(err instanceof ErrorClass);
      assert.ok(err instanceof BehavrApiError);
      assert.equal((err as BehavrApiError).status, status);
      assert.equal((err as BehavrApiError).code, code);
      assert.equal((err as BehavrApiError).name, ErrorClass.name);
      return true;
    });
  });
}

test("getOriginal() 503 is a plain BehavrApiError with code, and is not retried", async () => {
  const calls = mockFetch(503, detail("original_temporarily_unavailable", "Could not create a link right now; retry shortly."));
  await assert.rejects(client().getOriginal("mem-1"), (err: unknown) => {
    assert.ok(err instanceof BehavrApiError);
    assert.equal(err.constructor, BehavrApiError);
    assert.equal(err.code, "original_temporarily_unavailable");
    return true;
  });
  assert.equal(calls.length, 1);
});

test("getOriginal() never puts a link into the error message or payload", async () => {
  mockFetch(503, {
    url: SIGNED,
    detail: { error: "original_temporarily_unavailable", message: `failed to sign ${SIGNED}` },
  });
  await assert.rejects(client().getOriginal("mem-1"), (err: unknown) => {
    assert.ok(err instanceof BehavrApiError);
    const everything = `${err.message} ${err.stack} ${JSON.stringify(err.payload)}`;
    assert.ok(!everything.includes("storage.example.test"), everything);
    assert.ok(!everything.includes("X-Goog-Signature"), everything);
    return true;
  });
});

test("getOriginal() unexpected success body throws without echoing it", async () => {
  mockFetch(200, { link: SIGNED });
  await assert.rejects(client().getOriginal("mem-1"), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.ok(!err.message.includes("storage.example.test"));
    return true;
  });
});

// ------------------------------------------------------------ deleteMemory

test("deleteMemory() sends DELETE and maps the result", async () => {
  const calls = mockFetch(200, { memory_id: "mem-1", deleted: true, deleted_memories: 1, deleted_files: 3 });
  const result = await client().deleteMemory("mem-1");
  assert.equal(calls[0].url, `${BASE}/v1/memories/mem-1`);
  assert.equal(calls[0].method, "DELETE");
  assert.deepEqual(result, { memoryId: "mem-1", deleted: true, deletedMemories: 1, deletedFiles: 3 });
});

test("deleteMemory() rejects an empty id without calling the API", async () => {
  const calls = mockFetch(200, {});
  await assert.rejects(client().deleteMemory("  "), /requires a `memoryId`/);
  assert.equal(calls.length, 0);
});

test("deleteMemory() 404 throws MemoryNotFoundError", async () => {
  mockFetch(404, detail("memory_not_found", "Memory not found."));
  await assert.rejects(client().deleteMemory("mem-1"), MemoryNotFoundError);
});

test("deleteMemory() 409 throws MemoryProcessingError", async () => {
  mockFetch(409, detail("memory_processing", "Memory is still processing; retry when it is completed or failed."));
  await assert.rejects(client().deleteMemory("mem-1"), (err: unknown) => {
    assert.ok(err instanceof MemoryProcessingError);
    assert.ok(err instanceof BehavrApiError);
    assert.equal(err.status, 409);
    return true;
  });
});

test("deleteMemory() 500 deletion_incomplete is a plain BehavrApiError with code, and is not retried", async () => {
  const calls = mockFetch(500, detail("deletion_incomplete", "Deletion did not finish."));
  await assert.rejects(client().deleteMemory("mem-1"), (err: unknown) => {
    assert.equal((err as object).constructor, BehavrApiError);
    assert.equal((err as BehavrApiError).code, "deletion_incomplete");
    assert.match((err as BehavrApiError).message, /^BEHAVR API error \(500\): Deletion did not finish\.$/);
    return true;
  });
  assert.equal(calls.length, 1);
});

// ------------------------------------------------------------------ errors

test("error messages are read from detail, top-level fields, or fall back", async () => {
  mockFetch(401, { detail: "Invalid API key." });
  await assert.rejects(client().ask({ question: "q" }), /BEHAVR API error \(401\): Invalid API key\.$/);

  mockFetch(400, { error: "bad_request", message: "Top-level message." });
  await assert.rejects(client().ask({ question: "q" }), (err: unknown) => {
    assert.equal((err as BehavrApiError).code, "bad_request");
    assert.match((err as Error).message, /Top-level message\./);
    return true;
  });

  mockFetch(502, "");
  await assert.rejects(client().ask({ question: "q" }), /BEHAVR API error \(502\): Failed to get answer\./);

  mockFetch(502, "<html>Bad gateway</html>");
  await assert.rejects(client().ask({ question: "q" }), /Bad gateway/);
});

test("a 404 with an unknown code is a plain BehavrApiError", async () => {
  mockFetch(404, { detail: "Not Found" });
  await assert.rejects(client().getOriginal("mem-1"), (err: unknown) => {
    assert.equal((err as object).constructor, BehavrApiError);
    assert.equal((err as BehavrApiError).code, undefined);
    return true;
  });
});

# behavr-sdk

Official Node.js / TypeScript SDK for the [BEHAVR](https://behavr-backend-production.up.railway.app) API.

Wraps the live endpoints:

- `POST /v1/remember` — upload a file so BEHAVR can remember it
- `POST /v1/ask` — ask a question against your stored memories
- `GET /v1/memories` — list your stored memories
- `GET /v1/memories/{id}/original` — short-lived link to a retained original photo
- `DELETE /v1/memories/{id}` — delete a memory

## Installation

```bash
npm install behavr-sdk
```

## Quick start

```ts
import { BehavrClient } from "behavr-sdk";

const behavr = new BehavrClient({ apiKey: process.env.BEHAVR_API_KEY! });

// Remember a file
const remembered = await behavr.remember({
  file: "./notes.txt", // path, Buffer, { buffer, filename }, or Blob/File
  externalUserId: "user-123", // optional
});
console.log(remembered);
// { memoryId: "...", status: "...", summary: "..." }

// Ask a question
const answer = await behavr.ask({
  question: "What did I say about the Q3 roadmap?",
  externalUserId: "user-123", // optional
});
console.log(answer);
// { answer: "...", sources: ["memory_id_1", "memory_id_2"], sourceDetails: [...] }
```

CommonJS works the same way:

```js
const { BehavrClient } = require("behavr-sdk");
```

## Config options

```ts
new BehavrClient({
  apiKey: "your-api-key", // required
  baseUrl: "https://behavr-backend-production.up.railway.app", // optional, override for custom domains
});
```

| Option    | Required | Default                                                 |
| --------- | -------- | -------------------------------------------------------- |
| `apiKey`  | yes      | —                                                          |
| `baseUrl` | no       | `https://behavr-backend-production.up.railway.app`       |

## `remember(options)`

| Option           | Type                                                        | Required |
| ---------------- | ------------------------------------------------------------ | -------- |
| `file`           | file path (`string`) \| `Buffer` \| `{ buffer, filename }` \| `Blob`/`File` | yes      |
| `externalUserId` | `string`                                                      | no       |
| `clientId`       | `string`                                                      | no       |
| `agentId`        | `string`                                                      | no       |
| `retainImage`    | `boolean`                                                     | no       |

Returns `{ memoryId, status, summary }`, plus `warnings` (e.g. `["low_resolution"]`)
when the API sends any.

### `retainImage`

Off by default. Without it, the uploaded photo is deleted after analysis and
only the thumbnail and extracted text are kept. With `retainImage: true`,
BEHAVR keeps a copy of the original photo that you can fetch later with
`getOriginal()`.

- Photos only. Sending it with a video fails with a `422`.
- JPEG, PNG and WebP originals are kept. Other formats (including HEIC) are
  analysed as usual, but the original is not kept.
- Retained uploads are limited to 25 MB (larger fails with a `413`).
- Metadata such as EXIF (including GPS location) is stripped from the kept copy.
- You are responsible for getting your end users' consent before uploading
  their images and before turning on `retainImage`, and for deleting their
  memories when they ask.

```ts
const { memoryId } = await behavr.remember({ file: "./receipt.jpg", retainImage: true });
```

## `ask(options)`

| Option           | Type     | Required |
| ---------------- | -------- | -------- |
| `question`       | `string` | yes      |
| `externalUserId` | `string` | no       |
| `clientId`       | `string` | no       |
| `agentId`        | `string` | no       |

Returns `{ answer, sources, sourceDetails }`:

- `sources` — every memory id that was in context for the answer (unchanged).
- `sourceDetails` — up to 3 memories the answer says it used, as reported by
  the model; it may be incomplete, and is `[]` when there are none. Each entry
  is `{ memoryId, title, createdAt, category, snippet, hasOriginal, lowResolution }`.

`warnings` and `lowResolutionSources` are included when the API sends them.

```ts
const { answer, sourceDetails } = await behavr.ask({ question: "What was the total?" });
for (const s of sourceDetails) {
  console.log(s.title, s.memoryId, s.hasOriginal ? "(original available)" : "");
}
```

## `list(options?)`

| Option           | Type     | Required |
| ---------------- | -------- | -------- |
| `externalUserId` | `string` | no       |
| `clientId`       | `string` | no       |
| `agentId`        | `string` | no       |
| `limit`          | `number` | no       |
| `status`         | `string` | no       |

Returns `{ memories, total }`. Memory fields are camelCased (`memory_id` → `memoryId`).
Each memory includes `hasOriginal`, which is `true` once a retained original
can be fetched with `getOriginal()`.

```ts
const result = await behavr.list({ externalUserId: "customer_123" });
console.log(result.memories); // array of {memoryId, title, category, ...}
console.log(result.total);
```

## `getOriginal(memoryId, options?)`

Returns a short-lived signed link to a memory's retained original (uploaded
with `retainImage: true`).

| Option      | Type     | Required | Notes                                              |
| ----------- | -------- | -------- | -------------------------------------------------- |
| `expiresIn` | `number` | no       | Seconds. Clamped to 60–3600 by the API (default 900). |

Returns `{ url, expiresAt, expiresIn }`. Anyone with the `url` can download the
file until it expires, so don't log it, store it or send it anywhere you
wouldn't send the photo itself. The SDK never includes the link in error
messages.

```ts
import { OriginalPendingError, OriginalNotAvailableError } from "behavr-sdk";

try {
  const { url, expiresAt } = await behavr.getOriginal(memoryId, { expiresIn: 300 });
  // hand `url` to the user who owns the photo
} catch (err) {
  if (err instanceof OriginalPendingError) {
    // still being processed; try again shortly
  } else if (err instanceof OriginalNotAvailableError) {
    // no original was kept for this memory
  } else {
    throw err;
  }
}
```

## `deleteMemory(memoryId)`

Permanently deletes one memory and the data BEHAVR derived from it, including
its thumbnail and any retained original.

Returns `{ memoryId, deleted, deletedMemories, deletedFiles }`.

- Deleting the same memory twice throws `MemoryNotFoundError`, because nothing
  of it remains.
- A memory that is still processing can't be deleted yet: this throws
  `MemoryProcessingError` (`409`). Retry once it has completed or failed.
- If the API returns a `500` with `code === "deletion_incomplete"`, the memory
  is already hidden but not fully removed. Repeat the call. The SDK does not
  retry automatically.

> **Note:** `getOriginal()` and `deleteMemory()` act on any memory under your
> API key. They are **not** limited by `clientId`, `agentId` or
> `externalUserId`, so check on your server that the caller owns the memory
> before calling them.

## Scoping memories

Memories are scoped in a hierarchy, from broadest to narrowest:

1. **Account** — your API key.
2. **`clientId`** — which business/client the memory belongs to.
3. **`agentId`** — which agent within that client.
4. **`externalUserId`** — the end user the memory is about.

`externalUserId`, `clientId` and `agentId` are all optional on `remember()`,
`ask()` and `list()`. If you omit
`clientId` or `agentId`, the backend stores them as `"default"`, so existing
code keeps working unchanged.

```ts
await behavr.remember({
  file: "./invoice.pdf",
  clientId: "acme-corp",
  agentId: "support-bot",
  externalUserId: "customer_123",
});

await behavr.ask({
  question: "What was the invoice total?",
  clientId: "acme-corp",
  agentId: "support-bot",
});
```

> **Note:** `ask()` and `list()` only read memories stored under the
> `clientId` you pass (`"default"` if omitted). It is a filter your server
> controls, not a separate credential.

## ⚠️ Processing delay after `remember()`

`remember()` returns as soon as the file is uploaded — BEHAVR then processes
it (e.g. image/document understanding) in the background. If you call `ask()`
immediately after `remember()` resolves, the memory may not be ready yet and
`ask()` won't be able to use it.

For now, wait a bit (10-15 seconds is usually enough) before asking questions
about a just-uploaded file:

```ts
await behavr.remember({ file: "./photo.png" });
await new Promise((resolve) => setTimeout(resolve, 15000));
await behavr.ask({ question: "What's in this image?" });
```

If BEHAVR exposes a job-status endpoint in the future, the SDK can poll that
instead of relying on a fixed delay — tracked as a future improvement.

## Error handling

Failed requests throw a `BehavrApiError` with the HTTP `status`, the parsed
response `payload` and, when the API sends one, a machine-readable `code`
(e.g. `"deletion_incomplete"`). Some cases throw a subclass, so existing
`instanceof BehavrApiError` checks still catch everything:

| Class                       | Status | `code`                   | Thrown by                     |
| --------------------------- | ------ | ------------------------ | ----------------------------- |
| `MemoryNotFoundError`       | 404    | `memory_not_found`       | `getOriginal`, `deleteMemory` |
| `OriginalNotAvailableError` | 404    | `original_not_available` | `getOriginal`                 |
| `OriginalPendingError`      | 409    | `original_pending`       | `getOriginal`                 |
| `MemoryProcessingError`     | 409    | `memory_processing`      | `deleteMemory`                |

Anything else (for example `deletion_incomplete` or a `503`
`original_temporarily_unavailable`) is a plain `BehavrApiError` with `code`
set. The SDK never retries requests on its own.

```ts
import { BehavrApiError } from "behavr-sdk";

try {
  await behavr.ask({ question: "..." });
} catch (err) {
  if (err instanceof BehavrApiError) {
    console.error(err.status, err.code, err.message);
  }
}
```

### Changes in 0.4.0

All additions are backward compatible. One visible difference: when the API
puts its error message inside `detail` (as FastAPI does), `err.message` now
shows that message instead of the generic fallback text.

## Requirements

- Node.js 18+ (uses native `fetch`, `FormData`, and `Blob`)

## Development

```bash
npm install
npm run build   # compiles src/ -> dist/
npm test        # mocked unit tests (no network)
```

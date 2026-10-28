# behavr-sdk

Official Node.js / TypeScript SDK for the [BEHAVR](https://behavr-backend-production.up.railway.app) API.

Wraps the live endpoints:

- `POST /v1/remember` — upload a file so BEHAVR can remember it
- `POST /v1/ask` — ask a question against your stored memories
- `GET /v1/memories` — list your stored memories

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
// { answer: "...", sources: ["memory_id_1", "memory_id_2"] }
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

Returns `{ memoryId, status, summary }`.

## `ask(options)`

| Option           | Type     | Required |
| ---------------- | -------- | -------- |
| `question`       | `string` | yes      |
| `externalUserId` | `string` | no       |
| `clientId`       | `string` | no       |
| `agentId`        | `string` | no       |

Returns `{ answer, sources }`.

## `list(options?)`

| Option           | Type     | Required |
| ---------------- | -------- | -------- |
| `externalUserId` | `string` | no       |
| `clientId`       | `string` | no       |
| `agentId`        | `string` | no       |
| `limit`          | `number` | no       |
| `status`         | `string` | no       |

Returns `{ memories, total }`. Memory fields are camelCased (`memory_id` → `memoryId`).

```ts
const result = await behavr.list({ externalUserId: "customer_123" });
console.log(result.memories); // array of {memoryId, title, category, ...}
console.log(result.total);
```

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

Failed requests throw a `BehavrApiError` with the HTTP `status` and the parsed
response `payload`:

```ts
import { BehavrApiError } from "behavr-sdk";

try {
  await behavr.ask({ question: "..." });
} catch (err) {
  if (err instanceof BehavrApiError) {
    console.error(err.status, err.message, err.payload);
  }
}
```

## Requirements

- Node.js 18+ (uses native `fetch`, `FormData`, and `Blob`)

## Development

```bash
npm install
npm run build   # compiles src/ -> dist/
```

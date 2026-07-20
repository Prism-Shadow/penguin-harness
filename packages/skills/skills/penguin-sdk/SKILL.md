---
name: penguin-sdk
description: Build AI apps on the Penguin Harness SDK — self-contained projects, the createSession/run streaming loop, and a complete RAG recipe that ingests documents into a knowledge base and answers with citations behind a web UI.
short_description: Build AI and RAG apps on the Penguin Harness SDK.
short_description_zh: 基于 Penguin SDK 构建 AI 与 RAG 应用。
version: 1
updated: 2026-07-20T00:00:00Z
---

# Penguin Harness SDK

`@prismshadow/penguin-core` is the TypeScript SDK this agent itself runs on. Use it to build your own AI apps:

- An **Agent** loads its state (prompts, tools, skills) from `<root>/<project_id>/agents/<agent_id>/`. Creating an Agent whose directory is empty initializes it with defaults.
- A **Session** is one conversation of an Agent inside a **Workspace** directory.
- `session.run()` executes one task and streams every step (thinking, text, tool calls) as OmniMessages.

To have an agent perform a task, use the `run_subagent` tool — the SDK is for building applications, not for invoking agents.

## Before you start

If the user's message only invokes this skill (e.g. "use penguin-sdk skill") without a concrete app to build, ask the user what they want to build. But when the request names a concrete goal — even a single sentence like "build a RAG app that answers questions about these docs" — do **not** ask follow-up questions: build it end to end with the defaults in this skill (self-contained workspace project, project default model, BM25 retrieval, web UI styled per the web-design skill) and list the assumptions you made in your final reply.

## Project location

Create the app in the current workspace directory by default (the `CWD` value from your Environment section), as a self-contained project — do not place it under `<project_dir>` or depend on any path outside the project folder. Point the agent data root at a directory inside the project with `createAgent({ root })`, resolved from the source file so it stays relative:

```ts
const agent = await createAgent({ root: path.join(import.meta.dirname, "penguin_data") });
```

With every reference relative to the project, the user can move or copy the folder anywhere and it still runs.

## Setup

```bash
npm install @prismshadow/penguin-core tsx
```

If the package is not on your npm registry (it is developed in the PenguinHarness monorepo and may not be published), develop inside a checkout of the PenguinHarness repo instead: add your app as a workspace package under `packages/`, depend on `"@prismshadow/penguin-core": "workspace:*"`, then `pnpm install && pnpm build` at the repo root. Tell the user which route you took.

Configure a model for the app's data root, in this order — stop at the first that works:

1. `penguin config model add --root <data_dir> --model-id <id> --api-key <key> [--base-url <url>] [--client-type openai] --set-default` — prefer `--client-type openai --base-url <endpoint>` (works with any OpenAI-compatible endpoint; exact ids in the agenthub-models skill).
2. Environment variables cover the **credential only** (`DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …) — model selection still comes from the project config, whose preset default is `deepseek-v4-pro`. Env-only setup therefore works out of the box only with `DEEPSEEK_API_KEY`; for another vendor either run the CLI command above or pass a catalog `modelId` to `createSession`.

Model config lives in one hidden file under the data root's project directory: `.project_config.toml`. It is CLI-only — never read, print or edit it.

If neither route yields a usable credential, do not fake the verification: finish the build, report it as **unverified**, and tell the user exactly how to unblock you — in the Penguin web app, open this agent's settings via the **gear icon** on its card (Agents page) and add a model API key (e.g. `DEEPSEEK_API_KEY`) under the **key vault** tab. Vault keys are injected into your shell environment on the next task, so once the user has added one, you can run the self-test to completion.

## Streaming loop

The raw `run()` stream mixes model, event and session-meta payloads — always narrow with the exported guards (`isModelMessage`, `isCompleteModelMessage`, `isEventMessage`) before touching `payload.type`; accessing `msg.payload.type` directly does not typecheck.

```ts
import path from "node:path";
import readline from "node:readline/promises";
import { createAgent, isModelMessage, userText } from "@prismshadow/penguin-core";

const agent = await createAgent({ root: path.join(import.meta.dirname, "penguin_data") });
const session = await agent.createSession({ workspaceDir: process.cwd() });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
for (;;) {
  const line = await rl.question("> ");
  if (!line.trim()) break;
  // One run per user turn; the same Session keeps the conversation context.
  for await (const msg of session.run([userText(line)], {
    approve: async () => "allow", // demo only — a real app should ask its user ("deny" blocks the call)
  })) {
    if (isModelMessage(msg)) {
      const p = msg.payload;
      if (p.type === "partial_text" && p.event_type === "delta") process.stdout.write(p.text);
    }
  }
  process.stdout.write("\n");
}
rl.close();
session.dispose();
```

- `createSession({ workspaceDir, modelId })` — `workspaceDir` must already exist (omit for an auto temp dir); omit `modelId` for the project default model.
- The `approve` callback gates every tool call; **omitting it denies everything**.
- An Agent's behavior is edited in its `agent_state/` files (system_config.yaml, AGENTS.md, skills/), not in code.
- Call `session.dispose()` when done to release background processes.

## RAG knowledge app

The default recipe when the user wants an app that answers questions over a document set ("docs QA", "knowledge base", "chat with our docs", "become an expert on X"). The core contributes the agent loop only — retrieval is app code. Default to **lexical BM25**: no extra dependencies, no embedding credential, works offline. (Semantic upgrade: embed chunks via `@prismshadow/agenthub` — see the agenthub-models skill — and rank by cosine; only when an embedding-capable key is configured.)

```
my-app/
  package.json       # "type": "module"; scripts: ingest / start
  persona.md         # the embedded agent's role — write it per the agent-creation skill
  ingest.ts          # corpus/ → data/index.json; initializes penguin_data/, installs persona
  rag.ts             # BM25 retrieval over the chunk index
  server.ts          # POST /api/ask streams SSE; serves public/
  public/index.html  # chat UI — build it per the web-design skill
  corpus/            # collected source documents
  data/index.json    # generated chunk index
  penguin_data/      # agent data root (generated; model config lives here)
```

**Collect** — clone or fetch the sources into `corpus/`, keeping only text formats:

```bash
git clone --depth 1 <repo_url> corpus/<name>   # or curl pages into corpus/
find corpus -type f ! -regex '.*\.\(md\|mdx\|txt\|html?\)$' -delete && rm -rf corpus/*/.git
```

**Ingest** (`ingest.ts`) — split on markdown headings, cap chunk size, write one JSON index; also initialize `penguin_data/` and install the persona:

```ts
import fs from "node:fs";
import path from "node:path";
import { createAgent } from "@prismshadow/penguin-core";

const ROOT = import.meta.dirname;
const walk = (d: string): string[] =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

await createAgent({ root: path.join(ROOT, "penguin_data") });
fs.copyFileSync(path.join(ROOT, "persona.md"), path.join(
  ROOT, "penguin_data", "default_project", "agents", "default_agent", "agent_state", "AGENTS.md"));

const chunks: { id: number; source: string; heading: string; text: string }[] = [];
for (const f of walk(path.join(ROOT, "corpus")).filter((f) => /\.(md|mdx|txt|html?)$/i.test(f))) {
  const raw = fs.readFileSync(f, "utf8");
  const text = /\.html?$/i.test(f) ? raw.replace(/<[^>]+>/g, " ") : raw;
  const source = path.relative(ROOT, f);
  let heading = path.basename(f);
  for (const block of text.split(/^(?=#{1,3} )/m)) {
    heading = block.match(/^#{1,3} (.+)/)?.[1] ?? heading;
    for (let i = 0; i < block.length; i += 1500) {
      const piece = block.slice(i, i + 1500).trim();
      if (piece.length > 40) chunks.push({ id: chunks.length, source, heading, text: piece });
    }
  }
}
fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "data", "index.json"), JSON.stringify(chunks));
console.log(`indexed ${chunks.length} chunks`);
```

**Retrieve** (`rag.ts`) — standard BM25 (k1 = 1.2, b = 0.75); the tokenizer treats each CJK character as a token so Chinese queries work:

```ts
import fs from "node:fs";
import path from "node:path";

export interface Chunk { id: number; source: string; heading: string; text: string }

const tokenize = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+|[一-鿿]/g) ?? [];

export function loadIndex(): Chunk[] {
  return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "data", "index.json"), "utf8"));
}

export function search(chunks: Chunk[], query: string, k = 6): Chunk[] {
  const docs = chunks.map((c) => tokenize(`${c.heading} ${c.text}`));
  const avg = docs.reduce((n, d) => n + d.length, 0) / Math.max(docs.length, 1);
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const q = [...new Set(tokenize(query))];
  const score = (d: string[]): number => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let s = 0;
    for (const t of q) {
      const f = tf.get(t) ?? 0;
      if (f === 0) continue;
      const n = df.get(t) ?? 0;
      s += Math.log(1 + (docs.length - n + 0.5) / (n + 0.5)) *
        (f * 2.2) / (f + 1.2 * (0.25 + (0.75 * d.length) / avg));
    }
    return s;
  };
  return docs.map((d, i) => [score(d), i] as const)
    .filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).slice(0, k)
    .map(([, i]) => chunks[i]!);
}
```

**Answer & serve** (`server.ts`) — one Session per request (stateless QA), retrieved chunks numbered into the prompt, deltas streamed over SSE, sources sent as the final event. A pure QA session needs no tool calls — deny every approval; a denied or tool-less turn terminates normally. Do **not** clear the toolset with `tools: { builtin: [] }`: an empty tools array is sent to the provider verbatim and some OpenAI-compatible endpoints reject it with a 400, which surfaces as a silent empty answer.

```ts
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createAgent, isModelMessage, userText } from "@prismshadow/penguin-core";
import { loadIndex, search } from "./rag.ts";

const ROOT = import.meta.dirname;
const PUB = path.join(ROOT, "public");
const agent = await createAgent({ root: path.join(ROOT, "penguin_data") });
const chunks = loadIndex();
const MIME: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };

http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/ask") {
    let body = "";
    for await (const part of req) body += part;
    const { question } = JSON.parse(body) as { question: string };
    const hits = search(chunks, question);
    const context = hits.map((c, i) => `[${i + 1}] ${c.source} — ${c.heading}\n${c.text}`).join("\n\n");
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const session = await agent.createSession({ workspaceDir: ROOT });
    try {
      const prompt = `Answer from the context below; cite blocks inline as [1][2]. If the context is not enough, say so.\n\n${context}\n\nQuestion: ${question}`;
      for await (const msg of session.run([userText(prompt)], { approve: async () => "deny" })) {
        if (isModelMessage(msg)) {
          const p = msg.payload;
          if (p.type === "partial_text" && p.event_type === "delta")
            res.write(`data: ${JSON.stringify({ delta: p.text })}\n\n`);
        }
      }
      res.write(`data: ${JSON.stringify({ sources: hits.map((c) => ({ source: c.source, heading: c.heading, url: `/${c.source}` })) })}\n\n`);
    } finally {
      session.dispose();
      res.end();
    }
    return;
  }
  const pathname = (req.url ?? "/").split("?")[0] ?? "/";
  // /corpus/* serves the source documents read-only, so citation links resolve to real files.
  const inCorpus = pathname.startsWith("/corpus/");
  const base = inCorpus ? path.join(ROOT, "corpus") : PUB;
  const rel = inCorpus
    ? pathname.slice("/corpus/".length)
    : pathname === "/"
      ? "index.html"
      : pathname.slice(1);
  const file = path.normalize(path.join(base, rel));
  if (file.startsWith(base + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "text/plain" });
    res.end(fs.readFileSync(file));
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(Number(process.env.PORT ?? 4630), () => console.log("http://localhost:4630"));
```

**UI** (`public/index.html`) — a chat interface built per the web-design skill: message list, streamed assistant text appended delta by delta, the final `sources` event rendered as citation chips, an empty state inviting the first question with **3–4 example questions the corpus can actually answer** (pill chips; clicking one submits it), and a visible error state when `/api/ask` fails. Citation chips must be **real links, never bare text**: `<a href="<url>" target="_blank">` using the `url` field from the sources event (`/corpus/<path>`, which this server serves), labeled with the source path + heading. When the corpus was cloned from a public repository, prefer mapping the path to the canonical upstream page instead (e.g. the GitHub blob URL derived from the clone URL), so citations point at the real document online.

**Persona** (`persona.md`) — the embedded agent's role, written per the agent-creation skill. Shape: one role sentence ("You are an expert on X; you answer strictly from the provided context blocks"), citation and refusal rules, answer language follows the question.

## Verify before you hand over

Never declare the app done without running it:

1. `npm install` succeeds (or the workspace route builds).
2. Model configured for `penguin_data` (CLI or env var; no usable key → see Setup: ask the user to add one to this agent's key vault, and report the app as unverified for now).
3. `npm run ingest` prints `indexed N chunks` with N > 0.
4. Start `npm start` in the background, then ask a real question:
   `curl -N -sS -X POST localhost:4630/api/ask -H 'content-type: application/json' -d '{"question":"<something the corpus answers>"}'` — expect streamed `data:` deltas ending in a `sources` event. If nothing streams, the model call failed: re-check step 2 and the provider endpoint before touching the code.
   Then `curl` one of the returned source `url`s — it must return the document, not a 404 (citation links have to resolve).
5. Open the UI (or screenshot it) to confirm the layout renders.

Fix any failure and re-verify. Report with backtick-wrapped relative paths (`server.ts`, `public/index.html`, …), how to start the app, and the assumptions you made.

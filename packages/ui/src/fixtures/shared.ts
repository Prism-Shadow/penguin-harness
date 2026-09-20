/**
 * The locale-independent half of the dataset: code, commands, tool output, file contents,
 * ids, timings and prices. Code is code in every locale, so both `en.ts` and `zh.ts` build on
 * these exact values and only their prose differs.
 *
 * The story is the landing page's capture script (`packages/landing/scripts/capture-shots.mjs`):
 * an Agent collects the Claude Code docs and builds a BM25 RAG app that answers with [n]
 * citations. Turn 1 built it; turn 2 — the one running — adds a citation check and runs it.
 */
import type { GlyphName } from "../screens/glyph";
import type { DiffHunk, FileDiff, FileNode, ModelFixture, TraceLane } from "./types";

// ---------------------------------------------------------------------------
// Ids and times
// ---------------------------------------------------------------------------

export const SESSION_ID = "ses_7f3a9c21d4e8b650";
export const SUBAGENT_SESSION_ID = "ses_2b91e04c7a35d118";
export const WORKSPACE = "~/penguin/workspaces/claude-code-expert";
export const AGENT_ID = "default_agent";
export const REVIEWER_AGENT_ID = "docs-reviewer";

/** Turn 1 starts here; every other timestamp is derived from it so the story stays consistent. */
export const T0 = Date.parse("2026-09-14T06:02:07.412Z");
export const iso = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();

/** `HH:MM:SS.mmm` in UTC, as a Trace event row prints its time. */
export const clock = (offsetMs: number): string => iso(offsetMs).slice(11, 23);

// ---------------------------------------------------------------------------
// Turn 1: collect the corpus, write the app
// ---------------------------------------------------------------------------

export const CMD_COLLECT = `git clone --depth 1 https://github.com/ericbuess/claude-code-docs \\
  claude-code-expert/corpus/claude-code-docs
find claude-code-expert/corpus -type f ! -name '*.md' -delete
rm -rf claude-code-expert/corpus/claude-code-docs/.git
ls claude-code-expert/corpus/claude-code-docs | head -6`;

export const OUTPUT_COLLECT = `Cloning into 'claude-code-expert/corpus/claude-code-docs'...
remote: Enumerating objects: 214, done.
remote: Counting objects: 100% (214/214), done.
remote: Compressing objects: 100% (187/187), done.
Receiving objects: 100% (214/214), 1.38 MiB | 4.12 MiB/s, done.
amazon-bedrock.md
analytics.md
cli-reference.md
common-workflows.md
costs.md
data-usage.md`;

/** src/rag.ts as turn 1 wrote it (51 lines). */
export const RAG_TS_BEFORE = `// BM25 retrieval over corpus/ + a Session that answers with clickable [n] citations.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createAgent, isModelMessage, userText } from "@prismshadow/penguin-core";

const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const chunks = walk("corpus").flatMap((f) =>
  fs.readFileSync(f, "utf8").split(/\\n(?=#{1,3} )/).map((text) => ({ source: f, text })));

const tok = (s) => s.toLowerCase().match(/[a-z0-9]+|[\\u4e00-\\u9fff]/g) ?? [];
const docs = chunks.map((c) => tok(c.text));
const avg = docs.reduce((n, d) => n + d.length, 0) / Math.max(docs.length, 1);
const df = new Map();
for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
// BM25 (k1=1.2, b=0.75): idf weights rare terms, term frequency saturates, long chunks are penalized.
const score = (q, i) => {
  const d = docs[i];
  let s = 0;
  for (const w of new Set(tok(q))) {
    const f = d.filter((x) => x === w).length;
    if (!f) continue;
    const n = df.get(w) ?? 0;
    s += Math.log(1 + (docs.length - n + 0.5) / (n + 0.5)) * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * d.length / avg));
  }
  return s;
};
const agent = await createAgent({ root: "penguin_data" });

http.createServer(async (req, res) => {
  if (req.method !== "POST") { res.end(fs.readFileSync("public/index.html")); return; }
  let body = "";
  for await (const p of req) body += p;
  const { question } = JSON.parse(body);
  const hits = chunks.map((c, i) => [score(question, i), c]).filter(([s]) => s > 0)
    .sort((a, b) => b[0] - a[0]).slice(0, 6).map(([, c]) => c);
  res.writeHead(200, { "content-type": "text/event-stream" });
  const ctx = hits.map((c, i) => "[" + (i + 1) + "] " + c.source + "\\n" + c.text).join("\\n\\n");
  const session = await agent.createSession({ workspaceDir: process.cwd() });
  for await (const m of session.run([userText(ctx + "\\n\\nQ: " + question)], {
    approve: async () => "deny",
  })) {
    if (isModelMessage(m) && m.payload.type === "partial_text" && m.payload.event_type === "delta")
      res.write("data: " + JSON.stringify({ delta: m.payload.text }) + "\\n\\n");
  }
  res.write("data: " + JSON.stringify({ sources: hits.map((c) => c.source) }) + "\\n\\n");
  session.dispose();
  res.end();
}).listen(4630);
`;

const RAG_LINES = RAG_TS_BEFORE.split("\n");

/** The line the edit replaces, and what replaces it. */
const EDIT_OLD = "    .sort((a, b) => b[0] - a[0]).slice(0, 6).map(([, c]) => c);";
const EDIT_NEW = [
  "    .sort((a, b) => b[0] - a[0]).slice(0, 6).map(([, c]) => c)",
  "    // A citation must open a real file: drop hits whose source left the corpus.",
  "    .filter((c) => fs.existsSync(c.source));",
];

/** src/rag.ts after turn 2's edit (53 lines) — what the Files panel previews. */
export const RAG_TS_AFTER = RAG_TS_BEFORE.replace(EDIT_OLD, EDIT_NEW.join("\n"));

export const CMD_APP = `mkdir -p claude-code-expert/src claude-code-expert/public
cat > claude-code-expert/src/rag.ts <<'EOF'
${RAG_TS_BEFORE}EOF
wc -l claude-code-expert/src/rag.ts`;

export const OUTPUT_APP = "51 claude-code-expert/src/rag.ts";

// ---------------------------------------------------------------------------
// Turn 2: read, edit, add a test, review, run
// ---------------------------------------------------------------------------

export const RAG_PATH = "claude-code-expert/src/rag.ts";
export const TEST_PATH = "claude-code-expert/test/citations.test.ts";

/** `cat -n` rendering of lines [from, to] of the file, as read_file returns them. */
const catN = (lines: readonly string[], from: number, to: number): string =>
  lines
    .slice(from - 1, to)
    .map((line, i) => `${String(from + i).padStart(6)}\t${line}`)
    .join("\n");

export const READ_OFFSET = 32;
export const READ_LIMIT = 20;
export const OUTPUT_READ = catN(RAG_LINES, READ_OFFSET, READ_OFFSET + READ_LIMIT - 1);

/** The unified hunk for the edit: three lines of context either side of line 38. */
const EDIT_HUNK: DiffHunk = {
  header: "@@ -35,7 +35,9 @@",
  lines: [
    { kind: "context", text: RAG_LINES[34]!, oldNo: 35, newNo: 35 },
    { kind: "context", text: RAG_LINES[35]!, oldNo: 36, newNo: 36 },
    { kind: "context", text: RAG_LINES[36]!, oldNo: 37, newNo: 37 },
    { kind: "del", text: EDIT_OLD, oldNo: 38 },
    { kind: "add", text: EDIT_NEW[0]!, newNo: 38 },
    { kind: "add", text: EDIT_NEW[1]!, newNo: 39 },
    { kind: "add", text: EDIT_NEW[2]!, newNo: 40 },
    { kind: "context", text: RAG_LINES[38]!, oldNo: 39, newNo: 41 },
    { kind: "context", text: RAG_LINES[39]!, oldNo: 40, newNo: 42 },
    { kind: "context", text: RAG_LINES[40]!, oldNo: 41, newNo: 43 },
  ],
};

export const EDIT_DIFF: FileDiff = {
  path: RAG_PATH,
  language: "typescript",
  added: 3,
  removed: 1,
  hunks: [EDIT_HUNK],
};

const renderHunk = (h: DiffHunk): string =>
  [
    h.header,
    ...h.lines.map((l) => `${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}${l.text}`),
  ].join("\n");

export const EDIT_ARGS = { oldString: EDIT_OLD, newString: EDIT_NEW.join("\n") };
export const OUTPUT_EDIT = `Replaced 1 occurrence in "${RAG_PATH}".\n${renderHunk(EDIT_HUNK)}`;

export const TEST_TS = `import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const ask = async (question) => {
  const res = await fetch("http://localhost:4630/api/ask", { method: "POST", body: JSON.stringify({ question }) });
  const events = (await res.text()).split("\\n\\n").filter((e) => e.startsWith("data:"));
  return JSON.parse(events.at(-1).slice(5)).sources;
};

test("every citation resolves to a corpus file", async () => {
  const sources = await ask("How do I configure hooks?");
  assert.ok(sources.length > 0);
  for (const source of sources) assert.ok(fs.existsSync(source), source);
});

test("a question with no match cites nothing", async () => {
  assert.deepEqual(await ask("zzqx"), []);
});
`;

const TEST_LINES = TEST_TS.split("\n").slice(0, -1);

export const WRITE_DIFF: FileDiff = {
  path: TEST_PATH,
  language: "typescript",
  added: TEST_LINES.length,
  removed: 0,
  hunks: [
    {
      header: `@@ -0,0 +1,${TEST_LINES.length} @@`,
      lines: TEST_LINES.map((text, i) => ({ kind: "add" as const, text, newNo: i + 1 })),
    },
  ],
};

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;
export const OUTPUT_WRITE = `Created "${TEST_PATH}" (${TEST_LINES.length} lines, ${utf8Bytes(TEST_TS)} bytes).`;

export const CMD_TEST = `cd claude-code-expert && (npm start > /tmp/rag.log 2>&1 &) && sleep 2 && node --test test/`;

export const INDEX_HTML_PATH = "claude-code-expert/public/index.html";

export const INDEX_HTML = `<!doctype html>
<meta charset="utf-8" />
<title>Claude Code docs expert</title>
<div id="log"></div>
<input id="q" placeholder="Ask about Claude Code…" autofocus />
<script>
  // [n] -> a link to the n-th source; a marker past the last source stays plain text.
  const linkify = (text, sources) =>
    text.replace(/\\[(\\d+)\\]/g, (m, n) => (sources[n - 1] ? \`<a href="/\${sources[n - 1]}">\${m}</a>\` : m));
  q.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" || !q.value.trim()) return;
    const p = log.appendChild(document.createElement("p"));
    let text = "";
    for await (const d of ask(q.value)) {
      if (d.delta) p.textContent = text += d.delta;
      if (d.sources) p.innerHTML = linkify(text, d.sources);
    }
  });
</script>
`;

export const OUTPUT_READ_INDEX = catN(INDEX_HTML.split("\n").slice(0, -1), 1, 19);

// ---------------------------------------------------------------------------
// The final tree of turn 1's answer
// ---------------------------------------------------------------------------

export const TREE_BLOCK = `\`\`\`text
claude-code-expert/
├── package.json
├── corpus/claude-code-docs/   # the collected docs
├── src/rag.ts
└── public/index.html
\`\`\``;

export const RUN_COMMAND = "cd claude-code-expert && npm install && npm start";
export const APP_URL = "http://localhost:4630";

// ---------------------------------------------------------------------------
// Workspace file tree
// ---------------------------------------------------------------------------

const file = (
  path: string,
  sizeBytes: number,
  modifiedOffsetMs: number,
  change?: FileNode["change"],
): FileNode => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
  kind: "file",
  sizeBytes,
  modifiedIso: iso(modifiedOffsetMs),
  ...(change ? { change } : {}),
});

const dir = (path: string, children: FileNode[]): FileNode => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
  kind: "dir",
  children,
});

/**
 * The Workspace after turn 2's edits. `notesName` is the one localized file name: a note the
 * user dropped in, so the tree carries a CJK name in the zh dataset.
 */
export function workspaceTree(notesName: string): FileNode {
  return dir("claude-code-expert", [
    dir("claude-code-expert/corpus", [
      dir("claude-code-expert/corpus/claude-code-docs", [
        file("claude-code-expert/corpus/claude-code-docs/amazon-bedrock.md", 6_214, 18_400),
        file("claude-code-expert/corpus/claude-code-docs/analytics.md", 3_870, 18_400),
        file("claude-code-expert/corpus/claude-code-docs/cli-reference.md", 14_906, 18_400),
        file("claude-code-expert/corpus/claude-code-docs/common-workflows.md", 21_332, 18_400),
        file("claude-code-expert/corpus/claude-code-docs/costs.md", 5_128, 18_400),
        file("claude-code-expert/corpus/claude-code-docs/hooks.md", 17_655, 18_400),
        file("claude-code-expert/corpus/claude-code-docs/settings.md", 19_047, 18_400),
      ]),
    ]),
    dir("claude-code-expert/public", [file("claude-code-expert/public/index.html", 1_486, 21_950)]),
    dir("claude-code-expert/src", [
      file("claude-code-expert/src/rag.ts", utf8Bytes(RAG_TS_AFTER), 58_300, "modified"),
    ]),
    dir("claude-code-expert/test", [
      file("claude-code-expert/test/citations.test.ts", utf8Bytes(TEST_TS), 60_900, "added"),
    ]),
    file(`claude-code-expert/${notesName}`, 942, -3_600_000),
    file("claude-code-expert/package.json", 214, 21_950),
    file("claude-code-expert/README.md", 1_203, 22_010),
  ]);
}

// ---------------------------------------------------------------------------
// Models (real catalog rows: packages/core/src/state/model-catalog.ts)
// ---------------------------------------------------------------------------

/** The catalog's `cny()` conversion: CNY per MTok at 7 CNY/USD, rounded to 6 places. */
const cny = (cacheRead: number, cacheWrite: number, output: number) => {
  const r = (v: number): number => Math.round((v / 7) * 1e6) / 1e6;
  return { cacheRead: r(cacheRead), cacheWrite: r(cacheWrite), output: r(output) };
};
const usd = (cacheRead: number, cacheWrite: number, output: number) => ({
  cacheRead,
  cacheWrite,
  output,
});

/** Catalog rows without their localized notes; each locale adds `note` where it has one. */
export const MODEL_ROWS: readonly Omit<ModelFixture, "note">[] = [
  {
    provider: "deepseek",
    providerLabel: "DeepSeek",
    modelId: "deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro 0813",
    contextWindow: 1_000_000,
    supportsVision: false,
    pricing: cny(0.3, 9, 27),
    isDefault: true,
  },
  {
    provider: "deepseek",
    providerLabel: "DeepSeek",
    modelId: "deepseek-flash",
    displayName: "DeepSeek V4.1 Flash",
    contextWindow: 1_000_000,
    supportsVision: true,
    pricing: cny(0.04, 2, 8),
  },
  {
    provider: "anthropic",
    providerLabel: "Anthropic",
    modelId: "claude-fable-5",
    displayName: "Claude Fable 5",
    contextWindow: 1_000_000,
    supportsVision: true,
    pricing: usd(1, 12.5, 50),
  },
  {
    provider: "anthropic",
    providerLabel: "Anthropic",
    modelId: "claude-opus-5",
    displayName: "Claude Opus 5",
    contextWindow: 1_000_000,
    supportsVision: true,
    pricing: usd(0.5, 6.25, 25),
  },
  {
    provider: "anthropic",
    providerLabel: "Anthropic",
    modelId: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    contextWindow: 1_000_000,
    supportsVision: true,
    pricing: usd(0.2, 2.5, 10),
  },
  {
    provider: "openai",
    providerLabel: "OpenAI",
    modelId: "gpt-6-astra",
    displayName: "GPT-6 Astra",
    contextWindow: 1_050_000,
    supportsVision: true,
    pricing: usd(1, 12.5, 50),
  },
  {
    provider: "openai",
    providerLabel: "OpenAI",
    modelId: "gpt-5.6-luna",
    displayName: "GPT-5.6 Luna",
    contextWindow: 1_050_000,
    supportsVision: true,
    pricing: usd(0.02, 0.2, 1.2),
  },
  {
    provider: "google",
    providerLabel: "Google Gemini",
    modelId: "gemini-3.1-pro-preview",
    displayName: "Gemini 3.1 Pro (Preview)",
    contextWindow: 1_048_576,
    supportsVision: true,
    pricing: usd(0.2, 2, 12),
  },
  {
    provider: "moonshot",
    providerLabel: "Moonshot (Kimi)",
    modelId: "kimi-k3",
    displayName: "Kimi K3",
    contextWindow: 1_048_576,
    supportsVision: true,
    pricing: cny(2, 20, 100),
  },
  {
    provider: "zhipu",
    providerLabel: "Z.AI (GLM)",
    modelId: "glm-5.3",
    displayName: "GLM-5.3",
    contextWindow: 1_000_000,
    supportsVision: false,
    pricing: usd(0.26, 1.4, 4.4),
  },
];

// ---------------------------------------------------------------------------
// Trace timing (turn 1 settled, turn 2 still running)
// ---------------------------------------------------------------------------

export const TURN1_SPAN_MS = 25_840;
export const TURN2_START_MS = 31_200;
export const TURN2_SPAN_MS = 46_300;

export const TURN1_LANES: readonly TraceLane[] = [
  {
    name: "model",
    segments: [
      { kind: "thinking", startMs: 0, endMs: 2_380 },
      { kind: "text", startMs: 2_380, endMs: 2_610 },
      { kind: "toolgen", startMs: 2_610, endMs: 3_420 },
      { kind: "thinking", startMs: 18_420, endMs: 20_310 },
      { kind: "text", startMs: 20_310, endMs: 20_590 },
      { kind: "toolgen", startMs: 20_590, endMs: 21_880 },
      { kind: "text", startMs: 22_040, endMs: 25_840 },
    ],
  },
  {
    name: "exec_command",
    segments: [
      { kind: "exec", startMs: 3_420, endMs: 18_400 },
      { kind: "exec", startMs: 21_880, endMs: 21_950 },
    ],
  },
  {
    name: "other",
    segments: [
      { kind: "other", startMs: 18_400, endMs: 18_420 },
      { kind: "other", startMs: 21_950, endMs: 22_040 },
    ],
  },
];

export const TURN2_LANES: readonly TraceLane[] = [
  {
    name: "model",
    segments: [
      { kind: "thinking", startMs: 0, endMs: 3_140 },
      { kind: "toolgen", startMs: 3_140, endMs: 3_520 },
      { kind: "toolgen", startMs: 3_600, endMs: 5_010 },
      { kind: "toolgen", startMs: 6_250, endMs: 9_880 },
      { kind: "text", startMs: 10_720, endMs: 11_170 },
      { kind: "thinking", startMs: 11_170, endMs: 11_640 },
      { kind: "toolgen", startMs: 11_640, endMs: 11_780 },
      { kind: "toolgen", startMs: 11_780, endMs: 12_400 },
    ],
  },
  { name: "read_file", segments: [{ kind: "exec", startMs: 3_520, endMs: 3_561 }] },
  {
    name: "edit_file",
    segments: [
      { kind: "approvalWait", startMs: 5_010, endMs: 6_180 },
      { kind: "exec", startMs: 6_180, endMs: 6_214 },
    ],
  },
  {
    name: "write_file",
    segments: [
      { kind: "approvalWait", startMs: 9_880, endMs: 10_640 },
      { kind: "exec", startMs: 10_640, endMs: 10_663 },
    ],
  },
  { name: "run_subagent", segments: [{ kind: "exec", startMs: 11_780, endMs: TURN2_SPAN_MS }] },
  {
    name: "exec_command",
    segments: [{ kind: "approvalWait", startMs: 12_400, endMs: TURN2_SPAN_MS }],
  },
];

// ---------------------------------------------------------------------------
// Notices, forms, menus, secrets, plugins, the palette and usage (K-redesign §4.6)
// ---------------------------------------------------------------------------

/**
 * The accent options the picker draws, in the app's order: the stored `neutral` first — which
 * leaves the theme's own accent in place, and which the app paints `#6b7280` — then the five
 * presets `theme.css` declares.
 */
export const ACCENT_SWATCHES: readonly { id: string; color: string }[] = [
  { id: "neutral", color: "#6b7280" },
  { id: "blue", color: "#2563eb" },
  { id: "green", color: "#15803d" },
  { id: "violet", color: "#7c3aed" },
  { id: "rose", color: "#be123c" },
  { id: "amber", color: "#b45309" },
];

export const VAULT_KEYS = ["deepseek", "openrouter", "github", "slack", "proxy", "s3"] as const;
export type VaultKey = (typeof VAULT_KEYS)[number];

/** A secret's name and who may read it. Its kind and its date are words, so they are prose. */
export const VAULT_ROWS: Readonly<Record<VaultKey, { name: string; agents: readonly string[] }>> = {
  deepseek: { name: "DEEPSEEK_API_KEY", agents: [AGENT_ID, REVIEWER_AGENT_ID] },
  openrouter: { name: "OPENROUTER_API_KEY", agents: [AGENT_ID] },
  github: { name: "GITHUB_TOKEN", agents: [REVIEWER_AGENT_ID] },
  slack: { name: "SLACK_WEBHOOK_URL", agents: [] },
  proxy: { name: "PROXY_PASSWORD", agents: [] },
  s3: { name: "S3_UPLOAD_SECRET", agents: [AGENT_ID] },
};

export const PLUGIN_KEYS = ["sdk", "docsReview", "github", "slackNotify"] as const;
export type PluginKey = (typeof PLUGIN_KEYS)[number];

/** An installed plugin's identity and switch state; its one-line description is prose. */
export const PLUGIN_ROWS: Readonly<
  Record<PluginKey, { name: string; version: string; icon: GlyphName; enabled: boolean }>
> = {
  sdk: { name: "penguin-sdk", version: "0.2.13", icon: "book", enabled: true },
  docsReview: { name: "docs-review", version: "1.4.0", icon: "search", enabled: true },
  github: { name: "github", version: "2.1.3", icon: "fork", enabled: false },
  slackNotify: { name: "slack-notify", version: "0.9.1", icon: "message", enabled: true },
};

/**
 * The message menu without its words: four items, one shortcut on the first, one destructive item
 * last, and the two rules that group them.
 */
export const MESSAGE_MENU: readonly (
  | "separator"
  | {
      key: "copy" | "fork" | "export" | "delete";
      icon: GlyphName;
      shortcut?: readonly string[];
      danger?: boolean;
    }
)[] = [
  { key: "copy", icon: "copy", shortcut: ["⌘", "C"] },
  { key: "fork", icon: "fork" },
  "separator",
  { key: "export", icon: "download" },
  "separator",
  { key: "delete", icon: "cross", shortcut: ["⌫"], danger: true },
];

/** The palette's commands, minus their words: two groups, the second standing for Sessions. */
export const PALETTE_COMMANDS: readonly {
  key: "newChat" | "switchModel" | "settings" | "search";
  icon: GlyphName;
  keys?: readonly string[];
}[] = [
  { key: "newChat", icon: "newChat", keys: ["⌘", "N"] },
  { key: "switchModel", icon: "models" },
  { key: "settings", icon: "settings", keys: ["⌘", ","] },
  { key: "search", icon: "search", keys: ["⌘", "K"] },
];

/** A week of token usage in thousands, one series per bucket. Day names are prose. */
export const USAGE_SERIES: Readonly<Record<"cacheRead" | "cacheWrite" | "output", number[]>> = {
  cacheRead: [182, 240, 96, 310, 268, 40, 12],
  cacheWrite: [34, 52, 18, 61, 44, 9, 3],
  output: [21, 30, 11, 38, 33, 6, 2],
};

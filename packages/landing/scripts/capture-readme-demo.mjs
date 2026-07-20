/**
 * Capture the README "build an Agent app in one sentence" demo screenshot.
 *
 * Same pipeline as capture-shots.mjs (scripted mock LLM speaking Anthropic SSE +
 * OpenAI chunks -> real Web server on a temp data root -> the conversation's
 * commands really execute in the workspace), but a single English RAG-app
 * scenario, chat page only, light + dark, written to assets/readme/ at the repo
 * root as rag-demo-<theme>.webp.
 *
 * Prereqs: `pnpm --filter @prismshadow/penguin-{skills,core,server,web} build`
 * and Playwright's chromium. Run: `node scripts/capture-readme-demo.mjs`.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const OUT_DIR = path.resolve(ROOT, "assets/readme");
const MOCK_PORT = 8943;
const SRV_PORT = 8942;
const BASE = `http://127.0.0.1:${SRV_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;

// ---------------------------------------------------------------------------
// The scripted conversation: one sentence in, a working RAG app out.
// ---------------------------------------------------------------------------

const PROMPT =
  "Build a RAG app that answers questions over the Markdown files in docs/ with citations.";

const CMD_SCAFFOLD = `mkdir -p rag-app/src rag-app/docs && cat > rag-app/package.json <<'EOF'
{
  "name": "rag-app",
  "private": true,
  "type": "module",
  "scripts": { "start": "tsx src/rag.ts" },
  "dependencies": { "@prismshadow/penguin-core": "^0.1.0" }
}
EOF
cat > rag-app/docs/models.md <<'EOF'
# Adding a model
Add models on the Models page or with penguin config model add; a model is the
(provider, model_id) pair plus an API key.
EOF
cat > rag-app/docs/sessions.md <<'EOF'
# Sessions and Traces
Every Session appends to a Trace; any Session can be resumed from its Trace.
EOF
ls -R rag-app`;

const CMD_ENTRY = `cat > rag-app/src/rag.ts <<'EOF'
import { readFileSync, readdirSync } from "node:fs";
import { createAgent, isCompleteModelMessage, userText } from "@prismshadow/penguin-core";

const question = process.argv[2] ?? "How do I add a model?";
const chunks = readdirSync("docs").flatMap((f) =>
  readFileSync(\`docs/\${f}\`, "utf8")
    .split(/\\n(?=# )/)
    .map((text) => ({ file: \`docs/\${f}\`, text })),
);
const words = question.toLowerCase().match(/\\w+/g) ?? [];
const score = (t) => words.filter((w) => t.toLowerCase().includes(w)).length;
const sources = chunks.sort((a, b) => score(b.text) - score(a.text)).slice(0, 4);

const agent = await createAgent({ agentId: "rag_answerer" });
const session = await agent.createSession({ workspaceDir: process.cwd() });
const prompt = \`Answer using only these sources and cite their file paths.

\${sources.map((c) => \`[\${c.file}]\\n\${c.text}\`).join("\\n\\n")}

Question: \${question}\`;

for await (const out of session.run([userText(prompt)])) {
  if (isCompleteModelMessage(out) && out.payload.type === "text") console.log(out.payload.text);
}
EOF
wc -l rag-app/src/rag.ts`;

const TREE = `\`\`\`text
rag-app/
├── package.json
├── docs/
│   ├── models.md
│   └── sessions.md
└── src/
    └── rag.ts
\`\`\``;

const SCRIPT = {
  title: "Build a RAG application",
  turns: [
    {
      thinking:
        "One sentence is enough context: scaffold a project with a docs/ corpus, then add chunking, retrieval, and cited answers.",
      text: "I'll scaffold the RAG app with a sample docs/ corpus:",
      cmd: CMD_SCAFFOLD,
    },
    {
      thinking:
        "Corpus in place. The entry chunks the Markdown by heading, ranks chunks against the question, and answers through a Session that cites file paths.",
      text: "Now the retrieval and cited-answer entry:",
      cmd: CMD_ENTRY,
    },
    {
      text: `The RAG app is ready:

${TREE}

- Retrieval: \`src/rag.ts\` splits \`docs/\` by heading, ranks chunks against the question, and keeps the top 4 as sources;
- Answering: a PenguinHarness Session answers from those sources only, citing file paths like \`docs/models.md\`;
- Run it: \`cd rag-app && npm install && npm start -- "How do I add a model?"\`.`,
    },
  ],
};

// ---------------------------------------------------------------------------
// Mock LLM: Anthropic SSE on */messages, OpenAI chunks on */chat/completions.
// ---------------------------------------------------------------------------

function sse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function anthropicReply(res, body) {
  const flat = JSON.stringify(body.messages ?? []);
  const isTitle = flat.includes("concise title");
  const toolResults = flat.split('"tool_result"').length - 1;
  const turn = SCRIPT.turns[Math.min(toolResults, SCRIPT.turns.length - 1)];
  const msgCount = (body.messages ?? []).length;

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  sse(res, "message_start", {
    type: "message_start",
    message: {
      id: `msg_demo_${Date.now()}`,
      type: "message",
      role: "assistant",
      model: "deepseek-v4-pro",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 380,
        output_tokens: 0,
        cache_read_input_tokens: 2400 * msgCount,
        cache_creation_input_tokens: 620,
      },
    },
  });

  const block = (index, start, deltas, extra) => {
    sse(res, "content_block_start", { type: "content_block_start", index, content_block: start });
    for (const d of deltas)
      sse(res, "content_block_delta", { type: "content_block_delta", index, delta: d });
    if (extra)
      sse(res, "content_block_delta", { type: "content_block_delta", index, delta: extra });
    sse(res, "content_block_stop", { type: "content_block_stop", index });
  };
  const finish = (stopReason, outputTokens) => {
    sse(res, "message_delta", {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: outputTokens },
    });
    sse(res, "message_stop", { type: "message_stop" });
    res.end();
  };
  const textDeltas = (text) =>
    (text.match(/[\s\S]{1,24}/g) ?? []).map((t) => ({ type: "text_delta", text: t }));

  if (isTitle) {
    block(0, { type: "text", text: "" }, [{ type: "text_delta", text: SCRIPT.title }]);
    finish("end_turn", 8);
    return;
  }

  let index = 0;
  if (turn.thinking) {
    block(
      index++,
      { type: "thinking", thinking: "" },
      turn.thinking.match(/[\s\S]{1,18}/g).map((t) => ({ type: "thinking_delta", thinking: t })),
      { type: "signature_delta", signature: "sig_demo" },
    );
  }
  if (turn.text) block(index++, { type: "text", text: "" }, textDeltas(turn.text));
  if (turn.cmd) {
    const json = JSON.stringify({ cmd: turn.cmd });
    block(
      index++,
      { type: "tool_use", id: `toolu_demo_${toolResults + 1}`, name: "exec_command", input: {} },
      (json.match(/[\s\S]{1,32}/g) ?? []).map((partial_json) => ({
        type: "input_json_delta",
        partial_json,
      })),
    );
    finish("tool_use", 160);
  } else {
    finish("end_turn", 420);
  }
}

function openaiReply(res, body) {
  const flat = JSON.stringify(body.messages ?? []);
  const isTitle = flat.includes("concise title");
  const toolResults = flat.split('"role":"tool"').length - 1;
  const turn = SCRIPT.turns[Math.min(toolResults, SCRIPT.turns.length - 1)];

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const chunk = (delta, finishReason = null, usage) => {
    const payload = {
      id: "chatcmpl-demo",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "deepseek-v4-pro",
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    };
    if (usage) payload.usage = usage;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const usage = {
    prompt_tokens: 5200,
    completion_tokens: turn.cmd ? 180 : 420,
    total_tokens: 5620,
    prompt_cache_hit_tokens: 4300,
    prompt_cache_miss_tokens: 900,
  };

  chunk({ role: "assistant" });
  if (isTitle) {
    chunk({ content: SCRIPT.title });
    chunk({}, "stop", usage);
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }
  if (turn.thinking) {
    for (const t of turn.thinking.match(/[\s\S]{1,18}/g)) chunk({ reasoning_content: t });
  }
  if (turn.text) {
    for (const t of turn.text.match(/[\s\S]{1,24}/g)) chunk({ content: t });
  }
  if (turn.cmd) {
    chunk({
      tool_calls: [
        {
          index: 0,
          id: `call_demo_${toolResults + 1}`,
          type: "function",
          function: { name: "exec_command", arguments: "" },
        },
      ],
    });
    const json = JSON.stringify({ cmd: turn.cmd });
    for (const part of json.match(/[\s\S]{1,32}/g)) {
      chunk({ tool_calls: [{ index: 0, function: { arguments: part } }] });
    }
    chunk({}, "tool_calls", usage);
  } else {
    chunk({}, "stop", usage);
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

function startMock() {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let json = {};
      try {
        json = JSON.parse(body);
      } catch {}
      if (req.url?.includes("chat/completions")) return openaiReply(res, json);
      if (req.url?.includes("messages")) return anthropicReply(res, json);
      console.log(`[demo] unexpected path ${req.url}`);
      res.writeHead(404).end();
    });
  });
  return new Promise((resolve) => server.listen(MOCK_PORT, "127.0.0.1", () => resolve(server)));
}

// ---------------------------------------------------------------------------
// Server + API helpers.
// ---------------------------------------------------------------------------

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server not ready: ${url}`);
}

async function api(cookie, method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${await res.text()}`);
  return { json: await res.json().catch(() => ({})), setCookie: res.headers.get("set-cookie") };
}

async function login(userId, password) {
  const { json, setCookie } = await api(null, "POST", "/api/auth/login", { userId, password });
  if (!setCookie) throw new Error("no session cookie from login");
  return { cookie: setCookie.split(";")[0], user: json.user };
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

const dataRoot = mkdtempSync(path.join(os.tmpdir(), "penguin-readme-demo-"));
const ws = path.join(dataRoot, "workspace");
mkdirSync(ws, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const mock = await startMock();
console.log(`[demo] mock LLM on ${MOCK}`);

const srv = spawn("node", [path.join(ROOT, "packages/server/dist/index.js")], {
  env: {
    ...process.env,
    PENGUIN_HOME: path.join(dataRoot, "home"),
    PENGUIN_WEB_DB: path.join(dataRoot, "web.db"),
    PENGUIN_WEB_DIST: path.join(ROOT, "packages/web/dist"),
    PORT: String(SRV_PORT),
    HOST: "127.0.0.1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
srv.stderr.on("data", (d) => process.stderr.write(`[srv!] ${d}`));

const cleanup = () => {
  try {
    srv.kill();
  } catch {}
  try {
    mock.close();
  } catch {}
};
process.on("exit", cleanup);

try {
  await waitFor(`${BASE}/`);
  console.log(`[demo] server ready on ${BASE}`);

  const admin = await login("admin", "admin123");
  const userId = "penguin";
  const initial = `${userId}12345`;
  await api(admin.cookie, "POST", "/api/admin/users", { userId, password: initial }).catch((e) => {
    if (!String(e).includes("409")) throw e;
  });
  let session = await login(userId, initial);
  let password = initial;
  try {
    await api(session.cookie, "PUT", "/api/me/password", {
      oldPassword: initial,
      newPassword: `penguin-${userId}-2026`,
    });
    password = `penguin-${userId}-2026`;
  } catch {}
  session = await login(userId, password);

  const projects = (await api(session.cookie, "GET", "/api/projects")).json;
  const projectId = projects.projects[0].projectId;
  await api(session.cookie, "PUT", `/api/projects/${projectId}/models`, {
    defaultModel: { provider: "deepseek", modelId: "deepseek-v4-pro" },
    models: [
      {
        provider: "deepseek",
        modelId: "deepseek-v4-pro",
        apiKey: "sk-demo",
        baseUrl: MOCK,
        contextWindow: 1000000,
        pricing: { cacheRead: 0.003571, cacheWrite: 0.428571, output: 0.857143 },
      },
    ],
  });

  const sess = (
    await api(session.cookie, "POST", `/api/projects/${projectId}/agents/default_agent/sessions`, {
      provider: "deepseek",
      modelId: "deepseek-v4-pro",
      approvalMode: "allow-all",
      workspace: ws,
    })
  ).json;
  const sessionId = sess.session.sessionId;

  const browser = await chromium.launch();
  const encoderPage = await browser.newPage();
  async function saveWebp(pngBuffer, fileName) {
    const dataUrl = await encoderPage.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext("2d").drawImage(img, 0, 0);
      return canvas.toDataURL("image/webp", 0.82);
    }, pngBuffer.toString("base64"));
    writeFileSync(path.join(OUT_DIR, fileName), Buffer.from(dataUrl.split(",")[1], "base64"));
    console.log(`[demo] ${fileName}`);
  }

  /** Only the final answer mentions the npm run command. */
  const DONE_MARKER = "npm install && npm start";

  let firstTheme = true;
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1.5,
      locale: "en-US",
    });
    await context.addInitScript((t) => {
      localStorage.setItem("penguin.theme", t);
      localStorage.setItem("penguin.lang", "en");
    }, theme);
    const page = await context.newPage();
    await page.goto(`${BASE}/login`);
    const loginRes = await page.request.post(`${BASE}/api/auth/login`, {
      data: { userId, password },
    });
    if (!loginRes.ok()) throw new Error(`browser login failed: ${loginRes.status()}`);

    await page.goto(`${BASE}/chat/${sessionId}`);
    if (firstTheme) {
      const input = page.getByPlaceholder(/Type a message/);
      await input.waitFor({ timeout: 20000 });
      await input.fill(PROMPT);
      await page.getByRole("button", { name: /Send/ }).click();
      firstTheme = false;
    }
    await page.getByText(DONE_MARKER).first().waitFor({ timeout: 90000 });
    await page.waitForTimeout(2000);
    await saveWebp(await page.screenshot(), `rag-demo-${theme}.webp`);
    await context.close();
  }

  await browser.close();
  console.log("[demo] done");
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(1);
}

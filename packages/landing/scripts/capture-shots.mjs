/**
 * Capture real product screenshots for the landing page.
 *
 * Flow: host a scripted mock LLM (speaks BOTH Anthropic SSE and OpenAI chat-completions
 * SSE, so whichever client AgentHub routes to gets a valid stream) -> start the Web
 * server against a temp data root serving the built web dist -> drive a genuine
 * "build an Agent app" conversation (tools actually execute in the workspace) ->
 * screenshot chat / trace view / evaluation center, per UI language (zh / en, each
 * with its own user so sidebars stay monolingual) and per theme (light / dark), into
 * src/assets/shots/ as <page>-<lang>-<theme>.webp (12 files, re-encoded to WebP
 * inside Chromium to keep the repo small).
 *
 * Prereqs: `pnpm --filter @prismshadow/penguin-{skills,core,server,web} build` and
 * Playwright's chromium. Run: `node scripts/capture-shots.mjs`.
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
const OUT_DIR = path.resolve(HERE, "../src/assets/shots");
const MOCK_PORT = 8941;
const SRV_PORT = 8940;
const BASE = `http://127.0.0.1:${SRV_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;

// ---------------------------------------------------------------------------
// Scripted conversation: the Agent builds an Agent application from scratch.
// Commands are shared across languages (code is code) and really execute.
// ---------------------------------------------------------------------------

const CMD_COLLECT = `git clone --depth 1 https://github.com/ericbuess/claude-code-docs \\
  claude-code-expert/corpus/claude-code-docs
find claude-code-expert/corpus -type f ! -name '*.md' -delete
rm -rf claude-code-expert/corpus/claude-code-docs/.git
ls claude-code-expert/corpus/claude-code-docs | head -6`;

const CMD_APP = `mkdir -p claude-code-expert/src claude-code-expert/public
cat > claude-code-expert/package.json <<'EOF'
{
  "name": "claude-code-expert",
  "private": true,
  "type": "module",
  "scripts": { "start": "tsx src/rag.ts" },
  "dependencies": { "@prismshadow/penguin-core": "^0.1.0" }
}
EOF
cat > claude-code-expert/src/rag.ts <<'EOF'
// BM25 retrieval over corpus/ + a Session that answers with clickable [n] citations.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createAgent, isModelMessage, userText } from "@prismshadow/penguin-core";

const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const chunks = walk("corpus").flatMap((f) =>
  fs.readFileSync(f, "utf8").split(/\\n(?=#{1,3} )/).map((text) => ({ source: f, text })));

const tok = (s) => s.toLowerCase().match(/[a-z0-9]+|[一-鿿]/g) ?? [];
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
EOF
wc -l claude-code-expert/src/rag.ts`;

const TREE = `\`\`\`text
claude-code-expert/
├── package.json
├── corpus/claude-code-docs/   # the collected docs
├── src/rag.ts
└── public/index.html
\`\`\``;

/** Per-language script: user prompt marker -> turns + session title. */
const SCRIPTS = {
  zh: {
    marker: "配置专家",
    prompt:
      "收集 https://github.com/ericbuess/claude-code-docs 的文档，做一个化身 Claude Code 配置专家、回答带来源引用的 RAG 问答应用。",
    title: "构建 Claude Code 文档专家",
    turns: [
      {
        thinking:
          "一句话需求，penguin-sdk 技能给出了完整配方：先采集语料，再建 BM25 索引，回答经 Session 流式生成并带 [n] 引用直达原文。",
        text: "先把文档采集进语料库：",
        cmd: CMD_COLLECT,
      },
      {
        thinking:
          "语料就绪。写应用：本地 BM25 检索（零 embedding 依赖）+ 引用回答 + Penguin 风格聊天界面，引用链接到 /corpus 原文。",
        text: "语料就绪，写检索与引用回答的应用入口：",
        cmd: CMD_APP,
      },
      {
        text: `Claude Code 文档专家已就绪：

${TREE}

- 检索：本地 BM25 索引全部文档片段，中文提问同样支持；
- 回答：每次提问经 Session 流式生成，引用 [1][2] 可点击直达 \`corpus/\` 原文；
- 界面：Penguin 风格聊天页，空态内置示例问题；
- 运行：\`cd claude-code-expert && npm install && npm start\`，浏览器打开 http://localhost:4630。`,
      },
    ],
  },
  en: {
    marker: "configuration expert",
    prompt:
      "Collect the docs from https://github.com/ericbuess/claude-code-docs and build a RAG app that answers Claude Code questions as a configuration expert, citing its sources.",
    // Stay under core's TITLE_MAX_CHARS (30): a longer title gets hard-clipped
    // mid-word in the shots (e.g. "…docs exper").
    title: "Build Claude Code docs expert",
    turns: [
      {
        thinking:
          "One sentence is enough — the penguin-sdk skill has the full recipe: collect the corpus, build a BM25 index, answer through a Session with [n] citations linking to the originals.",
        text: "Collecting the docs into the corpus first:",
        cmd: CMD_COLLECT,
      },
      {
        thinking:
          "Corpus in place. Now the app: local BM25 retrieval (no embedding credential), cited answers, and a Penguin-style chat UI with citations linking to /corpus originals.",
        text: "Corpus ready — now the retrieval and cited-answer entry:",
        cmd: CMD_APP,
      },
      {
        text: `The Claude Code docs expert is ready:

${TREE}

- Retrieval: a local BM25 index over every doc chunk, Chinese questions included;
- Answers: each question streams through a Session, with [1][2] citations that link straight to the \`corpus/\` originals;
- UI: a Penguin-style chat page with example questions in the empty state;
- Run: \`cd claude-code-expert && npm install && npm start\`, then open http://localhost:4630.`,
      },
    ],
  },
};

function scriptFor(flat) {
  return flat.includes(SCRIPTS.en.marker) ? SCRIPTS.en : SCRIPTS.zh;
}

// ---------------------------------------------------------------------------
// Mock LLM: Anthropic SSE on */messages, OpenAI chunks on */chat/completions.
// ---------------------------------------------------------------------------

function sse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function anthropicReply(res, body) {
  const flat = JSON.stringify(body.messages ?? []);
  const script = scriptFor(flat);
  const isTitle = flat.includes("concise title");
  const toolResults = flat.split('"tool_result"').length - 1;
  const turn = script.turns[Math.min(toolResults, script.turns.length - 1)];
  const msgCount = (body.messages ?? []).length;

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  sse(res, "message_start", {
    type: "message_start",
    message: {
      id: `msg_shot_${Date.now()}`,
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
    block(0, { type: "text", text: "" }, [{ type: "text_delta", text: script.title }]);
    finish("end_turn", 8);
    return;
  }

  let index = 0;
  if (turn.thinking) {
    block(
      index++,
      { type: "thinking", thinking: "" },
      turn.thinking.match(/[\s\S]{1,18}/g).map((t) => ({ type: "thinking_delta", thinking: t })),
      { type: "signature_delta", signature: "sig_shot" },
    );
  }
  if (turn.text) block(index++, { type: "text", text: "" }, textDeltas(turn.text));
  if (turn.cmd) {
    const json = JSON.stringify({ cmd: turn.cmd });
    block(
      index++,
      { type: "tool_use", id: `toolu_shot_${toolResults + 1}`, name: "exec_command", input: {} },
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
  const script = scriptFor(flat);
  const isTitle = flat.includes("concise title");
  const toolResults = flat.split('"role":"tool"').length - 1;
  const turn = script.turns[Math.min(toolResults, script.turns.length - 1)];

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const chunk = (delta, finishReason = null, usage) => {
    const payload = {
      id: "chatcmpl-shot",
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
    chunk({ content: script.title });
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
          id: `call_shot_${toolResults + 1}`,
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
      console.log(`[mock] unexpected path ${req.url}`);
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

/** Per-language demo users so sidebars stay monolingual in the shots. */
const USERS = {
  zh: {
    userId: "demo",
    agents: [
      {
        agentId: "data_analyst",
        name: "数据分析师",
        description: "面向 CSV / Excel 的数据分析、图表与报表生成",
      },
      { agentId: "web_scout", name: "网页调研员", description: "网页检索、信息核对与调研纪要整理" },
      {
        agentId: "agent_optimizer",
        name: "Agent 优化师",
        description: "评估其他 Agent 的表现并迭代其提示词与技能",
      },
    ],
  },
  en: {
    userId: "alex",
    agents: [
      {
        agentId: "data_analyst",
        name: "Data Analyst",
        description: "CSV / Excel analysis, charts and report generation",
      },
      {
        agentId: "web_scout",
        name: "Web Scout",
        description: "Web research, fact checking and note-taking",
      },
      {
        agentId: "agent_optimizer",
        name: "Agent Optimizer",
        description: "Evaluates other Agents and iterates their prompts and Skills",
      },
    ],
  },
};

/** Provision a user with models + a few Agents; returns { cookie, password, projectId }. */
async function provisionUser(adminCookie, lang) {
  const { userId, agents } = USERS[lang];
  const initial = `${userId}12345`;
  await api(adminCookie, "POST", "/api/admin/users", { userId, password: initial }).catch((e) => {
    if (!String(e).includes("409")) throw e;
  });
  let session = await login(userId, initial);
  // Rotate once so the initial-password banner disappears from the shots.
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

  for (const agent of agents) {
    await api(session.cookie, "POST", `/api/projects/${projectId}/agents`, agent).catch((e) => {
      if (!String(e).includes("409")) throw e;
    });
  }

  return { cookie: session.cookie, password, projectId, userId };
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

const dataRoot = mkdtempSync(path.join(os.tmpdir(), "penguin-shots-"));
const wsDir = path.join(dataRoot, "workspace-apps");
mkdirSync(wsDir, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const mock = await startMock();
console.log(`[shots] mock LLM on ${MOCK}`);

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
  console.log(`[shots] server ready on ${BASE}`);

  const admin = await login("admin", "admin123");
  const browser = await chromium.launch();

  // WebP encoder: Chromium re-encodes the PNG screenshot buffer via canvas, which
  // keeps repo assets small (~5x lighter than PNG) with no native image deps.
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
    console.log(`[shots] ${fileName}`);
  }

  /** The final answer is the only turn mentioning the npm run command. */
  const DONE_MARKER = "npm install && npm start";

  for (const lang of ["zh", "en"]) {
    const user = await provisionUser(admin.cookie, lang);
    const script = SCRIPTS[lang];

    // Language-specific workspace subdir so zh/en runs don't collide on files.
    const ws = path.join(wsDir, lang);
    mkdirSync(ws, { recursive: true });

    const sess = (
      await api(
        user.cookie,
        "POST",
        `/api/projects/${user.projectId}/agents/default_agent/sessions`,
        {
          provider: "deepseek",
          modelId: "deepseek-v4-pro",
          approvalMode: "allow-all",
          workspace: ws,
        },
      )
    ).json;
    const sessionId = sess.session.sessionId;

    let firstTheme = true;
    for (const theme of ["light", "dark"]) {
      // 1280x800 @1.5x -> 1920x1200: sharp enough for the landing's ~1024px-wide
      // frames on retina, while keeping the WebP assets small.
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1.5,
        locale: lang === "zh" ? "zh-CN" : "en-US",
      });
      await context.addInitScript(
        ([t, l]) => {
          localStorage.setItem("penguin.theme", t);
          localStorage.setItem("penguin.lang", l);
        },
        [theme, lang],
      );
      const page = await context.newPage();
      await page.goto(`${BASE}/login`);
      const loginRes = await page.request.post(`${BASE}/api/auth/login`, {
        data: { userId: user.userId, password: user.password },
      });
      if (!loginRes.ok()) throw new Error(`browser login failed: ${loginRes.status()}`);

      await page.goto(`${BASE}/chat/${sessionId}`);
      if (firstTheme) {
        // Drive the conversation once per language; the other theme restores it.
        const input = page.getByPlaceholder(/输入消息|Type a message/);
        await input.waitFor({ timeout: 20000 });
        await input.fill(script.prompt);
        await page.getByRole("button", { name: /发送|Send/ }).click();
        firstTheme = false;
      }
      await page.getByText(DONE_MARKER).first().waitFor({ timeout: 90000 });
      await page.waitForTimeout(2000);
      await saveWebp(await page.screenshot(), `chat-${lang}-${theme}.webp`);

      // Trace view: the product's canonical deep link carries BOTH agentId and
      // sessionId (?sessionId= alone is ignored by TracesPage's focus wiring), and
      // auto-selects the Session once its trace list loads. Waiting for the
      // execution timeline's exec_command lanes guarantees every language captures
      // the same opened trace — stats + a timeline with tool calls — never the
      // empty "select a Session" state.
      await page.goto(`${BASE}/traces?agentId=default_agent&sessionId=${sessionId}`);
      await page.getByText("exec_command").first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(2000);
      await saveWebp(await page.screenshot(), `traces-${lang}-${theme}.webp`);

      // Evaluation center: open the pre-provisioned example Benchmark scoreboard.
      await page.goto(`${BASE}/benchmark`);
      await page.waitForTimeout(1500);
      await page
        .getByText("Example Benchmark")
        .first()
        .click()
        .catch(() => {});
      await page.waitForTimeout(2500);
      await saveWebp(await page.screenshot(), `benchmark-${lang}-${theme}.webp`);

      await context.close();
    }
  }

  await browser.close();
  console.log(`[shots] done -> ${OUT_DIR}`);
  process.exit(0);
} catch (err) {
  console.error("[shots] FAILED:", err);
  process.exit(1);
}

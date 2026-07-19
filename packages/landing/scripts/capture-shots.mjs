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

const CMD_SCAFFOLD = `mkdir -p csv-analyst/src && cat > csv-analyst/package.json <<'EOF'
{
  "name": "csv-analyst",
  "private": true,
  "type": "module",
  "scripts": { "start": "tsx src/agent.ts" },
  "dependencies": { "@prismshadow/penguin-core": "^0.1.0" }
}
EOF
ls -R csv-analyst`;

const CMD_ENTRY = `cat > csv-analyst/src/agent.ts <<'EOF'
import { createAgent, isCompleteModelMessage, userText } from "@prismshadow/penguin-core";

const agent = await createAgent({ agentId: "csv_analyst" });
const session = await agent.createSession({ workspaceDir: process.cwd() });

for await (const out of session.run([userText("Analyze data.csv and write summary.md")], {
  approve: async () => "allow",
})) {
  if (isCompleteModelMessage(out) && out.payload.type === "text") {
    console.log(out.payload.text);
  }
}
EOF
wc -l csv-analyst/src/agent.ts`;

const TREE = `\`\`\`text
csv-analyst/
├── package.json
└── src/
    └── agent.ts
\`\`\``;

/** Per-language script: user prompt marker -> turns + session title. */
const SCRIPTS = {
  zh: {
    marker: "数据分析 Agent 应用",
    prompt: "用 PenguinHarness SDK 创建一个数据分析 Agent 应用：读取 CSV 并输出汇总报告",
    title: "构建数据分析 Agent 应用",
    turns: [
      {
        thinking:
          "需求是基于 penguin-core 的数据分析 Agent 应用。先创建项目骨架：package.json 与源码目录。",
        text: "我来创建应用骨架：",
        cmd: CMD_SCAFFOLD,
      },
      {
        thinking:
          "骨架已建好。入口代码用 createAgent + createSession，把 CSV 分析任务交给 session.run。",
        text: "骨架就绪，写入 Agent 入口代码：创建 Session，把 CSV 分析任务交给 session.run 并流式输出。",
        cmd: CMD_ENTRY,
      },
      {
        text: `数据分析 Agent 应用已创建完成：

${TREE}

- 入口 \`csv-analyst/src/agent.ts\`：创建 Agent 与 Session，任务经 \`session.run\` 流式执行，工具调用逐个审批；
- 运行方式：\`cd csv-analyst && npm install && npm start\`；
- 建议下一步：在评估中心为它配一组 CSV 任务 Benchmark，交给 Optimizer 持续优化。`,
      },
    ],
  },
  en: {
    marker: "data-analysis Agent app",
    prompt:
      "Use the PenguinHarness SDK to create a data-analysis Agent app that reads CSV files and writes a summary report",
    title: "Build a data-analysis Agent app",
    turns: [
      {
        thinking:
          "They want a data-analysis Agent app on penguin-core. Start with the project skeleton: package.json plus the source directory.",
        text: "Let me scaffold the app first:",
        cmd: CMD_SCAFFOLD,
      },
      {
        thinking:
          "Skeleton is in place. The entry uses createAgent + createSession and hands the CSV task to session.run.",
        text: "Skeleton ready — now the Agent entry point: create a Session and hand the CSV analysis task to session.run, streaming the output.",
        cmd: CMD_ENTRY,
      },
      {
        text: `The data-analysis Agent app is ready:

${TREE}

- Entry \`csv-analyst/src/agent.ts\`: creates the Agent and a Session; the task runs through \`session.run\` with per-tool approval;
- Run it with \`cd csv-analyst && npm install && npm start\`;
- Suggested next step: give it a CSV Benchmark suite in the evaluation center and let an Optimizer keep improving it.`,
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

      // Trace view: select the session in the list (deep-link selection is unreliable
      // right after a fresh navigation, so click explicitly — sidebar shows the same
      // title first in DOM order, hence .last()).
      await page.goto(`${BASE}/traces?sessionId=${sessionId}`);
      await page.waitForTimeout(1500);
      await page
        .getByText(script.title)
        .last()
        .click()
        .catch(() => {});
      await page.waitForTimeout(2500);
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

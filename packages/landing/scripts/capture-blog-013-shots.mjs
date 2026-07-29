/**
 * Capture the 0.1.4 blog-post screenshots: the subagents panel (call graph + child
 * conversation) and goal mode (round loop + live status banner).
 *
 * Same machinery as capture-shots.mjs — a scripted mock LLM (Anthropic SSE and OpenAI
 * chat-completions SSE, whichever client AgentHub routes to), the built Web server on a
 * temp data root, real tool execution in a staged Workspace, Playwright screenshots
 * re-encoded to WebP inside Chromium — with two deliberately staged scenes:
 *
 * - AGENTS PANEL: the user asks for a benchmark review; the parent fans out to two named
 *   agents (Data Analyst / Web Scout). The analyst's scoring script really runs in the
 *   Workspace and streams real output into the panel's child conversation while both
 *   children tick "running" in the call graph. Shot: chat + docked panel, analyst node
 *   selected.
 * - GOAL MODE: a `POST /tasks` with `goal` drives a three-round "make the check suite
 *   green" loop against a staged text-table module. Rounds 1-2 run and fix for real
 *   (the check script converges over reruns so the loop has a believable multi-round
 *   arc); round 3's slow verification run is the capture window, with the goal banner
 *   showing "round 3 · tokens used/budget" above the composer.
 *
 * Files: {agents-panel,goal-mode}-<lang>-<theme>.webp (8 of them, zh + en, light + dark,
 * 1280x900 @1.5x like the other blog shots).
 *
 * Output is a two-step flow, because blog images are not committed to this repo:
 *   1. this script writes into the gitignored staging dir packages/landing/.blog-assets/;
 *   2. upload the files it produced to the `blog-assets/` directory of the sibling
 *      `Prism-Shadow/penguin-harness-community` repo, which is what the posts load from
 *      (the renderer resolves /blog-assets/<name> there — see src/lib/links.ts).
 *
 * Prereqs: `pnpm --filter @prismshadow/penguin-{skills,core,server,web} build` and
 * Playwright's chromium. Run: `node scripts/capture-blog-013-shots.mjs` (or
 * `pnpm --filter @prismshadow/penguin-landing blog-013-shots`).
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
// Gitignored staging dir: these images are hosted in the community repo, not committed here.
const OUT_DIR = path.resolve(HERE, "../.blog-assets");
const MOCK_PORT = 8953; // Distinct from capture-shots (8940/8941) and blog-shots (8944).
const SRV_PORT = 8952;
// The App is canonically served on `localhost` (127.0.0.1 is the Workspace-preview host).
const BASE = `http://localhost:${SRV_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;

// ---------------------------------------------------------------------------
// Scene scripts (zh + en). Commands are shared across languages (code is code)
// and really execute in the staged Workspace.
// ---------------------------------------------------------------------------

const SCORE_CMD =
  "node scripts/score-runs.mjs --runs 41,42,43 --baseline reports/july-baseline.json";
const CHECKS_CMD = "node scripts/run-checks.mjs";
const SED_WIDTH =
  "sed -i 's/const w = String(value).length/const w = displayWidth(String(value))/' src/table.mjs";
const SED_DATE_GUARD =
  "sed -i '/const d = new Date(value);/a\\  if (Number.isNaN(d.getTime())) return \"—\";' src/table.mjs";

const SCENES = {
  en: {
    agents: {
      warmup: "What's in this workspace? One line.",
      warmupReply:
        "reports/ holds three benchmark runs (run-41 … run-43) plus the July baseline, and scripts/score-runs.mjs scores runs against a baseline.",
      prompt:
        "Compare our last three benchmark runs with the July baseline and double-check the published numbers — fan out to the right agents and keep it parallel.",
      parentThinking:
        "Two independent workstreams: scoring runs 41-43 against the July baseline, and verifying the published numbers. The data analyst takes the scoring, the web scout takes the verification, both in parallel.",
      analystPrompt:
        "Score benchmark runs 41-43 in reports/runs/ against the July baseline in reports/july-baseline.json, then chart the trend.",
      scoutPrompt:
        "Verify the published July baseline numbers against the release notes and note any discrepancy.",
      analystThinking:
        "Three run files and one baseline. Score each run suite by suite with the scoring script, then draw the trend from the per-run totals.",
      analystText: "Scoring the three runs against the July baseline:",
      scoutThinking:
        "The published numbers live in the release notes; the local copy sits in reports/july-baseline.json. Cross-check accuracy and case counts field by field.",
      scoutText:
        "Starting from the headline numbers: the published July baseline says 128 cases at 84.2% accuracy, which matches reports/july-baseline.json exactly. Per suite, data-analysis and web-research agree with the release notes to the decimal. The code-fix suite is published rounded to 82% against 82.1% locally — a display-precision difference, not a data discrepancy. Two items left before I can sign off: the report-writing case count appears once in the appendix table and once in the body, so both occurrences need to agree, and the trend chart's baseline anchor should match what the data analyst derives from the raw runs.\n\nChecking the appendix now. The appendix table lists report-writing at 24 cases, and the body paragraph says the same 24, so the earlier concern is cleared. The per-suite splits sum to the published 128-case total, and the weighted accuracy recomputed from the published splits lands on 84.2% — the headline number is internally consistent, not just copied. What remains is the baseline anchor: the release notes cite the July figure as the comparison point for the current runs, so the discrepancy note should state explicitly that both sides use the same 84.2% anchor, with the only published-versus-local difference being the rounded code-fix percentage. Drafting that note next, one line per verified field with its source.",
      title: "Benchmark vs July baseline",
      analystTitle: "Score runs vs baseline",
      scoutTitle: "Verify baseline numbers",
    },
    goal: {
      warmup: "What does this project contain?",
      warmupReply:
        "A small text-table module (src/table.mjs) and its check suite (scripts/run-checks.mjs) — 12 checks over column widths, alignment, dates and truncation.",
      objective:
        "Make scripts/run-checks.mjs pass all 12 checks: fix what it reports, rerun, and repeat until everything is green.",
      title: "Fix table check suite",
      rounds: [
        [
          {
            thinking:
              "First a full run of the suite to see the actual failure set before touching anything.",
            text: "Running the check suite to see where things stand.",
            exec: CHECKS_CMD,
          },
          {
            text: "Two of the three failures share one cause — cell width is computed from raw string length, which undercounts CJK glyphs. The third is the missing invalid-date guard. Fixing the width path first.",
            exec: SED_WIDTH,
          },
          { text: "Width fix is in. Rerunning next round before touching the date guard." },
        ],
        [
          { text: "Round 2 — rerunning the checks after the width fix.", exec: CHECKS_CMD },
          {
            text: "11 green, one left: the invalid-date guard. Adding it.",
            exec: SED_DATE_GUARD,
          },
          { text: "Guard in place — one more verification round." },
        ],
        [
          {
            thinking: "Width fix and date guard are both in; this pass should come back all green.",
            text: "Final verification pass — with the width fix and the date guard in place, all 12 checks should come back green.",
            exec: CHECKS_CMD,
          },
          // Post-capture only: the slow verification run yields to the background at
          // ~60s, so this step must not claim a result the run has not printed yet.
          {
            text: "The verification run is still going in the background — I'll confirm the summary line before touching the goal status.",
          },
          { text: "Waiting on the final summary line before marking the goal complete." },
        ],
      ],
    },
  },
  zh: {
    agents: {
      warmup: "这个工作区里有什么？一句话。",
      warmupReply:
        "reports/ 下是三次基准跑分（run-41 至 run-43）与七月基线，scripts/score-runs.mjs 用于对基线评分。",
      prompt:
        "把最近三次基准跑分与七月基线对比一下，并核对公开发布的数值——按需要派发给合适的智能体并行处理。",
      parentThinking:
        "两条互相独立的工作线：run-41 至 run-43 对比七月基线评分、公开数值核对。评分交给数据分析师，核对交给网页调研员，并行推进。",
      analystPrompt:
        "对 reports/runs/ 下的 run-41 至 run-43 三次跑分逐套件评分，与 reports/july-baseline.json 的七月基线对比，并生成趋势图。",
      scoutPrompt: "核对七月基线的公开发布数值与本地口径是否一致，如有出入记录差异。",
      analystThinking: "三份跑分文件加一份基线。先用评分脚本逐套件打分，再由各次总分画出趋势。",
      analystText: "开始对三次跑分逐套件评分，与七月基线对比：",
      scoutThinking:
        "公开数值在发布说明里，本地口径在 reports/july-baseline.json。逐字段交叉核对准确率与题目数。",
      scoutText:
        "先核对总口径：公开发布的七月基线为 128 题、准确率 84.2%，与本地 reports/july-baseline.json 完全一致。分套件看，data-analysis 与 web-research 的通过数与发布说明逐位吻合；code-fix 套件公开口径四舍五入报 82%，本地为 82.1%，属展示精度差异而非数据出入。签发核对结论前还剩两项：report-writing 的题目数在附录表与正文各出现一次，需确认两处一致；趋势图引用的基线锚点也要与数据分析师从原始跑分推出的数值对齐。\n\n附录核对进行中：附录表中 report-writing 为 24 题，正文同为 24 题，此前的疑点排除。各套件题目数合计恰为公开口径的 128 题；按公开分套件数据重新加权计算的准确率同样落在 84.2%，说明总口径不是简单转抄而是内部自洽的。剩下基线锚点一项：发布说明以七月数字作为本期跑分的对比基准，核对结论里应明确写出两侧使用同一个 84.2% 锚点，公开与本地的唯一差异是 code-fix 的四舍五入展示。接下来起草核对纪要，每个已验证字段一行并附来源。",
      title: "基准对比七月基线",
      analystTitle: "跑分对比评分",
      scoutTitle: "基线数值核对",
    },
    goal: {
      warmup: "这个项目里有什么？",
      warmupReply:
        "一个小型文本表格模块（src/table.mjs）和它的检查套件（scripts/run-checks.mjs），共 12 项检查，覆盖列宽、对齐、日期与截断。",
      objective: "让 scripts/run-checks.mjs 的 12 项检查全部通过：按报告修复、重跑，循环直到全绿。",
      title: "修复表格检查套件",
      rounds: [
        [
          {
            thinking: "先完整跑一遍套件，确认真实的失败集合，再动手修改。",
            text: "先跑一遍检查，确认目前的通过情况。",
            exec: CHECKS_CMD,
          },
          {
            text: "三项失败里有两项同因：单元格宽度按字符数计算，CJK 字宽被低估；另一项是缺失的非法日期兜底。先修宽度。",
            exec: SED_WIDTH,
          },
          { text: "宽度修复已提交。下一轮先重跑验证，再处理日期兜底。" },
        ],
        [
          { text: "第二轮——宽度修复后重跑检查。", exec: CHECKS_CMD },
          { text: "11 项通过，只剩非法日期兜底一项。补上。", exec: SED_DATE_GUARD },
          { text: "兜底已加，再做一轮最终验证。" },
        ],
        [
          {
            thinking: "宽度与日期两处都已修复，这一轮应当全绿。",
            text: "最后一轮验证——宽度修复与日期兜底都已就位，预期 12 项全部通过。",
            exec: CHECKS_CMD,
          },
          // Post-capture only: the slow verification run yields to the background at
          // ~60s, so this step must not claim a result the run has not printed yet.
          { text: "验证仍在后台运行——等汇总行出来后再确认目标状态。" },
          { text: "等待最终汇总行后再把目标标记为完成。" },
        ],
      ],
    },
  },
};

/** Per-language demo users (same ids/agents as capture-shots.mjs, so sidebars stay monolingual). */
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
    analystNode: "数据分析师 · 运行中",
    panelTitle: "智能体面板",
    topologyLabel: "调用关系",
    round3: "第 3 轮 · tokens",
    round3Text: "最后一轮验证",
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
    analystNode: "Data Analyst · running",
    panelTitle: "Agents panel",
    topologyLabel: "Call graph",
    round3: "round 3 · tokens",
    round3Text: "Final verification pass",
  },
};

// ---------------------------------------------------------------------------
// Staged Workspaces: real files, really executed by the conversation's commands.
// ---------------------------------------------------------------------------

/** Benchmark-review Workspace (agents-panel scene): three run reports, a baseline, a paced scorer. */
function stageBenchWorkspace(dir) {
  mkdirSync(path.join(dir, "reports/runs"), { recursive: true });
  mkdirSync(path.join(dir, "scripts"), { recursive: true });
  const baseline = { suite: "penguin-bench", period: "2026-07", cases: 128, accuracy: 0.842 };
  writeFileSync(path.join(dir, "reports/july-baseline.json"), JSON.stringify(baseline, null, 2));
  const runs = {
    41: { date: "2026-07-24", suites: [38, 27, 24, 20] },
    42: { date: "2026-07-25", suites: [39, 28, 24, 20] },
    43: { date: "2026-07-26", suites: [40, 28, 25, 20] },
  };
  const names = ["data-analysis", "web-research", "code-fix", "report-writing"];
  const sizes = [44, 32, 28, 24];
  for (const [id, run] of Object.entries(runs)) {
    writeFileSync(
      path.join(dir, `reports/runs/run-${id}.json`),
      JSON.stringify(
        {
          run: Number(id),
          date: run.date,
          cases: 128,
          suites: names.map((name, i) => ({ name, cases: sizes[i], passed: run.suites[i] })),
        },
        null,
        2,
      ),
    );
  }
  // Paced on purpose: one line every ~2.5s keeps the tool card visibly streaming for the
  // whole capture window (the numbers themselves are computed from the report files).
  writeFileSync(
    path.join(dir, "scripts/score-runs.mjs"),
    `// Score benchmark runs against a baseline and chart the trend.
import fs from "node:fs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const runs = (args[args.indexOf("--runs") + 1] ?? "").split(",");
const baseline = JSON.parse(fs.readFileSync(args[args.indexOf("--baseline") + 1], "utf8"));
const pct = (x) => (x * 100).toFixed(1) + "%";
console.log(\`[score] baseline \${baseline.period}: \${pct(baseline.accuracy)} over \${baseline.cases} cases\`);
const totals = [];
for (const id of runs) {
  const run = JSON.parse(fs.readFileSync(\`reports/runs/run-\${id}.json\`, "utf8"));
  await sleep(4000);
  console.log(\`[score] run-\${id}: parsing \${run.cases} cases from \${run.date}\`);
  for (const s of run.suites) {
    await sleep(4200);
    console.log(\`[score]   \${s.name}: \${pct(s.passed / s.cases)} (\${s.passed}/\${s.cases})\`);
  }
  const acc = run.suites.reduce((n, s) => n + s.passed, 0) / run.cases;
  totals.push([id, acc]);
  const d = (acc - baseline.accuracy) * 100;
  await sleep(3500);
  console.log(\`[score] run-\${id} overall: \${pct(acc)}  (\${d >= 0 ? "+" : ""}\${d.toFixed(1)} vs baseline)\`);
}
await sleep(3000);
const bars = totals.map(([id, acc]) => \`[score]   run-\${id} \${"#".repeat(Math.round((acc - 0.8) * 200))} \${pct(acc)}\`);
console.log("[score] trend (accuracy above 80%):");
for (const b of bars) console.log(b);
const w = 420, h = 160;
const pts = totals.map(([, acc], i) => \`\${40 + i * 170},\${h - 20 - (acc - 0.8) * 1200}\`).join(" ");
fs.writeFileSync(
  "reports/trend.svg",
  \`<svg xmlns="http://www.w3.org/2000/svg" width="\${w}" height="\${h}"><polyline points="\${pts}" fill="none" stroke="#2563eb" stroke-width="2"/></svg>\`,
);
console.log("[score] wrote reports/trend.svg");
`,
  );
}

/** Text-table Workspace (goal-mode scene): a small module plus a check suite that converges over reruns. */
function stageTableWorkspace(dir) {
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "scripts"), { recursive: true });
  // The two bugs the goal loop "fixes" are real sed targets: raw string length as cell
  // width, and a missing invalid-date guard.
  writeFileSync(
    path.join(dir, "src/table.mjs"),
    `/** Minimal text-table renderer: fixed-width columns, ISO dates, CJK-aware truncation. */
export function displayWidth(s) {
  let w = 0;
  for (const ch of s) w += /[\\u2E80-\\uA4CF\\uAC00-\\uD7A3\\uF900-\\uFAFF\\uFE30-\\uFE4F\\uFF00-\\uFF60\\uFFE0-\\uFFE6]/.test(ch) ? 2 : 1;
  return w;
}

export function cellWidth(value) {
  const w = String(value).length;
  return w;
}

export function formatDate(value) {
  const d = new Date(value);
  return d.toISOString().slice(0, 10);
}

export function renderTable(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(cellWidth(h), ...rows.map((r) => cellWidth(r[i] ?? ""))),
  );
  const pad = (v, w) => String(v) + " ".repeat(Math.max(0, w - cellWidth(v)));
  const line = (cells) => "| " + cells.map((c, i) => pad(c, widths[i])).join(" | ") + " |";
  const rule = "|" + widths.map((w) => "-".repeat(w + 2)).join("|") + "|";
  return [line(headers), rule, ...rows.map(line)].join("\\n");
}
`,
  );
  // Staged fixture: the suite converges over reruns (3 failed -> 1 failed -> green) so the
  // goal loop has a believable multi-round arc inside one capture run.
  writeFileSync(
    path.join(dir, "scripts/run-checks.mjs"),
    `// Check suite for src/table.mjs (12 checks).
import fs from "node:fs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(".cache", { recursive: true });
let n = 1;
try { n = Number(fs.readFileSync(".cache/checks-runs", "utf8").trim()) + 1; } catch {}
fs.writeFileSync(".cache/checks-runs", String(n));
const CHECKS = [
  ["column widths · ascii"],
  ["column widths · cjk", 1, 'expected column width 22, got 16 (CJK glyphs counted as width 1)'],
  ["column widths · mixed"],
  ["header underline length"],
  ["alignment · right-aligned numbers"],
  ["alignment · padded cjk cells", 1, "padding computed from string length, not display width"],
  ["date column · iso format"],
  ["date column · invalid date guard", 2, 'expected "—" for invalid input, got "NaN-aN-aN"'],
  ["truncation · long cell ellipsis"],
  ["truncation · cjk boundary"],
  ["empty table renders header"],
  ["single-row table"],
];
const pace = n >= 3 ? 6000 : 650;
console.log("[checks] src/table.mjs · 12 checks");
let failed = 0;
for (const [name, failUntil, detail] of CHECKS) {
  await sleep(pace);
  if (!failUntil || n > failUntil) console.log(\`  ✓ \${name}\`);
  else { failed += 1; console.log(\`  ✗ \${name} — \${detail}\`); }
}
await sleep(600);
console.log(failed ? \`\${failed} failed · \${12 - failed} passed (12 checks)\` : "12 passed (12 checks)");
process.exit(failed ? 1 : 0);
`,
  );
}

// ---------------------------------------------------------------------------
// Mock LLM: request -> turn descriptor (pure), then per-protocol SSE emitters.
// ---------------------------------------------------------------------------

/** True when any of the scene's language variants contains `marker` in `flat`. */
function langOf(flat, pick) {
  if (flat.includes(pick(SCENES.en))) return "en";
  if (flat.includes(pick(SCENES.zh))) return "zh";
  return null;
}

/**
 * Decide the turn for one request. `messages` is the raw request message list,
 * `toolMarker` the protocol's tool-result fingerprint ('"tool_result"' / '"role":"tool"').
 */
function decideTurn(messages, toolMarker) {
  const flat = JSON.stringify(messages);
  const toolResults = flat.split(toolMarker).length - 1;

  // Titles: keyed per conversation (warm-up markers for the two main sessions — the money
  // prompts arrive after the title exists — child prompts for the child sessions).
  if (flat.includes("concise title")) {
    for (const [pick, title] of [
      [(s) => s.agents.warmup, (s) => s.agents.title],
      [(s) => s.goal.warmup, (s) => s.goal.title],
      [(s) => s.agents.analystPrompt, (s) => s.agents.analystTitle],
      [(s) => s.agents.scoutPrompt, (s) => s.agents.scoutTitle],
    ]) {
      const lang = langOf(flat, pick);
      if (lang) return { kind: "title", text: title(SCENES[lang]) };
    }
    return { kind: "title", text: "Conversation" };
  }

  // Goal scene: the objective is embedded in every round's [goal] block.
  {
    const lang = langOf(flat, (s) => s.goal.objective);
    if (lang) {
      const scene = SCENES[lang].goal;
      const rounds = [...flat.matchAll(/round: (\d+)/g)].map((m) => Number(m[1]));
      const round = Math.max(1, ...rounds);
      let lastRoundIdx = 0;
      messages.forEach((m, i) => {
        if (JSON.stringify(m).includes("round: ")) lastRoundIdx = i;
      });
      const pos = messages
        .slice(lastRoundIdx + 1)
        .filter((m) => JSON.stringify(m).includes(toolMarker)).length;
      const steps = scene.rounds[Math.min(round, scene.rounds.length) - 1];
      const step = { ...steps[Math.min(pos, steps.length - 1)] };
      return {
        kind: "turn",
        ...step,
        usage: { input: 2100, cachePerMsg: 1800, cacheWrite: 850, output: step.exec ? 260 : 540 },
      };
    }
  }

  // Agents scene, child sessions first (their context lacks the parent's own prompt).
  for (const lang of ["en", "zh"]) {
    const scene = SCENES[lang].agents;
    if (flat.includes(scene.prompt)) {
      // Parent conversation: one turn fans out BOTH children as parallel tool calls (both
      // stay inside their yield windows, so both call-graph nodes tick "running"); the
      // wrap-up below is only reached if capture overruns the windows.
      if (toolResults === 0) {
        return {
          kind: "turn",
          thinking: scene.parentThinking,
          subs: [
            { agentId: "data_analyst", prompt: scene.analystPrompt },
            { agentId: "web_scout", prompt: scene.scoutPrompt },
          ],
          usage: { input: 420, cachePerMsg: 2100, cacheWrite: 640, output: 190 },
        };
      }
      return {
        kind: "turn",
        text:
          lang === "zh"
            ? "两路结果已汇总：三次跑分相对七月基线稳步上升，公开数值与本地口径一致。"
            : "Both tracks are in: the three runs climb steadily over the July baseline, and the published numbers match the local reports.",
        usage: { input: 480, cachePerMsg: 2100, cacheWrite: 640, output: 320 },
      };
    }
    if (flat.includes(scene.analystPrompt)) {
      if (toolResults === 0) {
        return {
          kind: "turn",
          thinking: scene.analystThinking,
          text: scene.analystText,
          exec: SCORE_CMD,
          usage: { input: 390, cachePerMsg: 1400, cacheWrite: 520, output: 180 },
        };
      }
      // Post-capture only (the exec yields to the background at ~60s): stay honest about
      // the still-running script rather than claiming completion.
      return {
        kind: "turn",
        text:
          lang === "zh"
            ? "评分脚本仍在后台运行，完成后我再汇总数字与趋势图。"
            : "The scoring script is still running in the background; I'll summarize the numbers and the trend chart once it completes.",
        usage: { input: 410, cachePerMsg: 1400, cacheWrite: 520, output: 160 },
      };
    }
    if (flat.includes(scene.scoutPrompt)) {
      // Held-open drip: the scout keeps writing its verification notes slowly so its call-graph
      // node stays "running" (elapsed ticking) for the whole capture window.
      return {
        kind: "drip",
        thinking: scene.scoutThinking,
        text: scene.scoutText,
        usage: { input: 380, cachePerMsg: 1300, cacheWrite: 500, output: 420 },
      };
    }
    if (flat.includes(scene.warmup)) {
      return {
        kind: "turn",
        text: scene.warmupReply,
        usage: { input: 350, cachePerMsg: 900, cacheWrite: 380, output: 90 },
      };
    }
    if (flat.includes(SCENES[lang].goal.warmup)) {
      return {
        kind: "turn",
        text: SCENES[lang].goal.warmupReply,
        usage: { input: 350, cachePerMsg: 900, cacheWrite: 380, output: 100 },
      };
    }
  }

  return {
    kind: "turn",
    text: "OK.",
    usage: { input: 300, cachePerMsg: 800, cacheWrite: 300, output: 20 },
  };
}

/** Tool calls for a turn: one exec_command, or one run_subagent per `subs` entry. */
function toolCalls(turn) {
  if (turn.exec) return [{ name: "exec_command", json: JSON.stringify({ cmd: turn.exec }) }];
  return (turn.subs ?? []).map(({ agentId, prompt, yieldMs }) => ({
    name: "run_subagent",
    json: JSON.stringify({
      agent_id: agentId,
      prompt,
      ...(yieldMs ? { yield_time_ms: yieldMs } : {}),
    }),
  }));
}

/** Guarded SSE write (drip streams outlive aborted clients). */
function sseWrite(res, chunk) {
  if (res.destroyed || res.writableEnded) return false;
  res.write(chunk);
  return true;
}

function sse(res, event, data) {
  sseWrite(res, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function anthropicReply(res, body) {
  const messages = body.messages ?? [];
  const turn = decideTurn(messages, '"tool_result"');
  const usage = turn.usage ?? { input: 300, cachePerMsg: 800, cacheWrite: 300, output: 20 };

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
        input_tokens: usage.input,
        output_tokens: 0,
        cache_read_input_tokens: usage.cachePerMsg * messages.length,
        cache_creation_input_tokens: usage.cacheWrite,
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
  const finish = (stopReason) => {
    sse(res, "message_delta", {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: usage.output },
    });
    sse(res, "message_stop", { type: "message_stop" });
    res.end();
  };

  if (turn.kind === "title") {
    block(0, { type: "text", text: "" }, [{ type: "text_delta", text: turn.text }]);
    finish("end_turn");
    return;
  }

  if (turn.kind === "drip") {
    // thinking deltas every ~500ms, then small text pieces every ~2.4s: enough material to
    // keep the child visibly streaming (and its node "running") for the whole capture
    // window; the task is aborted by the capture flow before the material runs out.
    const thinks = turn.thinking.match(/[\s\S]{1,12}/g) ?? [];
    const texts = turn.text.match(/[\s\S]{1,8}/g) ?? [];
    let step = 0;
    sse(res, "content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "" },
    });
    const tick = () => {
      if (res.destroyed || res.writableEnded) return;
      if (step < thinks.length) {
        sse(res, "content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: thinks[step] },
        });
        step += 1;
        setTimeout(tick, 500);
        return;
      }
      if (step === thinks.length) {
        sse(res, "content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: { type: "signature_delta", signature: "sig_shot" },
        });
        sse(res, "content_block_stop", { type: "content_block_stop", index: 0 });
        sse(res, "content_block_start", {
          type: "content_block_start",
          index: 1,
          content_block: { type: "text", text: "" },
        });
      }
      const i = step - thinks.length;
      if (i < texts.length) {
        sse(res, "content_block_delta", {
          type: "content_block_delta",
          index: 1,
          delta: { type: "text_delta", text: texts[i] },
        });
        step += 1;
        setTimeout(tick, 2400);
      }
      // Out of material: hold the stream open (no message_stop) — capture aborts the task.
    };
    tick();
    return;
  }

  let index = 0;
  if (turn.thinking) {
    block(
      index++,
      { type: "thinking", thinking: "" },
      (turn.thinking.match(/[\s\S]{1,18}/g) ?? []).map((t) => ({
        type: "thinking_delta",
        thinking: t,
      })),
      { type: "signature_delta", signature: "sig_shot" },
    );
  }
  if (turn.text) {
    block(
      index++,
      { type: "text", text: "" },
      (turn.text.match(/[\s\S]{1,24}/g) ?? []).map((t) => ({ type: "text_delta", text: t })),
    );
  }
  const calls = toolCalls(turn);
  if (calls.length > 0) {
    for (const [i, { name, json }] of calls.entries()) {
      block(
        index++,
        { type: "tool_use", id: `toolu_shot_${Date.now()}_${i}`, name, input: {} },
        (json.match(/[\s\S]{1,32}/g) ?? []).map((partial_json) => ({
          type: "input_json_delta",
          partial_json,
        })),
      );
    }
    finish("tool_use");
  } else {
    finish("end_turn");
  }
}

function openaiReply(res, body) {
  const messages = body.messages ?? [];
  const turn = decideTurn(messages, '"role":"tool"');
  const usage = turn.usage ?? { input: 300, cachePerMsg: 800, cacheWrite: 300, output: 20 };
  const hit = usage.cachePerMsg * messages.length;
  const prompt = hit + usage.input + usage.cacheWrite;

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const chunk = (delta, finishReason = null, withUsage) => {
    const payload = {
      id: "chatcmpl-shot",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "deepseek-v4-pro",
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    };
    if (withUsage) {
      payload.usage = {
        prompt_tokens: prompt,
        completion_tokens: usage.output,
        total_tokens: prompt + usage.output,
        prompt_cache_hit_tokens: hit,
        prompt_cache_miss_tokens: usage.input + usage.cacheWrite,
      };
    }
    sseWrite(res, `data: ${JSON.stringify(payload)}\n\n`);
  };
  const done = (reason) => {
    chunk({}, reason, true);
    sseWrite(res, "data: [DONE]\n\n");
    res.end();
  };

  chunk({ role: "assistant" });
  if (turn.kind === "title") {
    chunk({ content: turn.text });
    done("stop");
    return;
  }

  if (turn.kind === "drip") {
    const thinks = turn.thinking.match(/[\s\S]{1,12}/g) ?? [];
    const texts = turn.text.match(/[\s\S]{1,8}/g) ?? [];
    let step = 0;
    const tick = () => {
      if (res.destroyed || res.writableEnded) return;
      if (step < thinks.length) {
        chunk({ reasoning_content: thinks[step] });
        step += 1;
        setTimeout(tick, 500);
        return;
      }
      const i = step - thinks.length;
      if (i < texts.length) {
        chunk({ content: texts[i] });
        step += 1;
        setTimeout(tick, 2400);
      }
      // Hold open once out of material (no finish chunk).
    };
    tick();
    return;
  }

  if (turn.thinking)
    for (const t of turn.thinking.match(/[\s\S]{1,18}/g) ?? []) chunk({ reasoning_content: t });
  if (turn.text) for (const t of turn.text.match(/[\s\S]{1,24}/g) ?? []) chunk({ content: t });
  const calls = toolCalls(turn);
  if (calls.length > 0) {
    for (const [i, { name, json }] of calls.entries()) {
      chunk({
        tool_calls: [
          {
            index: i,
            id: `call_shot_${Date.now()}_${i}`,
            type: "function",
            function: { name, arguments: "" },
          },
        ],
      });
      for (const part of json.match(/[\s\S]{1,32}/g) ?? []) {
        chunk({ tool_calls: [{ index: i, function: { arguments: part } }] });
      }
    }
    done("tool_calls");
  } else {
    done("stop");
  }
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
      try {
        if (req.url?.includes("chat/completions")) return openaiReply(res, json);
        if (req.url?.includes("messages")) return anthropicReply(res, json);
        console.log(`[mock] unexpected path ${req.url}`);
        res.writeHead(404).end();
      } catch (err) {
        console.error("[mock] reply error:", err);
        try {
          res.end();
        } catch {}
      }
    });
  });
  return new Promise((resolve) => server.listen(MOCK_PORT, "127.0.0.1", () => resolve(server)));
}

// ---------------------------------------------------------------------------
// Server + API helpers (same shape as capture-shots.mjs).
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
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${await res.text()}`);
  return { json: await res.json().catch(() => ({})), setCookie: res.headers.get("set-cookie") };
}

async function login(userId, password) {
  const { setCookie } = await api(null, "POST", "/api/auth/login", { userId, password });
  if (!setCookie) throw new Error("no session cookie from login");
  return setCookie.split(";")[0];
}

/** Provision a per-language user with the mock model + named Agents; password rotated once. */
async function provisionUser(adminCookie, lang) {
  const { userId, agents } = USERS[lang];
  const initial = `${userId}12345`;
  await api(adminCookie, "POST", "/api/admin/users", { userId, password: initial }).catch((e) => {
    if (!String(e).includes("409")) throw e;
  });
  let password = initial;
  let cookie = await login(userId, initial);
  try {
    await api(cookie, "PUT", "/api/me/password", {
      oldPassword: initial,
      newPassword: `penguin-${userId}-2026`,
    });
    password = `penguin-${userId}-2026`;
  } catch {}
  cookie = await login(userId, password);

  const projects = (await api(cookie, "GET", "/api/projects")).json;
  const projectId = projects.projects[0].projectId;
  await api(cookie, "PUT", `/api/projects/${projectId}/models`, {
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
    await api(cookie, "POST", `/api/projects/${projectId}/agents`, agent).catch((e) => {
      if (!String(e).includes("409")) throw e;
    });
  }
  return { cookie, password, projectId, userId };
}

/** Create a session bound to the mock model in the given Workspace dir. */
async function createSession(user, workspace) {
  const sess = (
    await api(
      user.cookie,
      "POST",
      `/api/projects/${user.projectId}/agents/default_agent/sessions`,
      {
        provider: "deepseek",
        modelId: "deepseek-v4-pro",
        approvalMode: "allow-all",
        workspace,
      },
    )
  ).json;
  return sess.session.sessionId;
}

/** Run one quick task so the session gets its generated title before the money shot. */
async function warmup(user, sessionId, text, doneMarker, page) {
  await api(user.cookie, "POST", `/api/sessions/${sessionId}/tasks`, {
    input: [{ type: "text", text }],
  });
  await page.getByText(doneMarker).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500); // title generation is post-Task; give it a beat
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

const dataRoot = mkdtempSync(path.join(os.tmpdir(), "penguin-blog013-"));
mkdirSync(OUT_DIR, { recursive: true });

const mock = await startMock();
console.log(`[blog-013] mock LLM on ${MOCK}`);

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
  console.log(`[blog-013] server ready on ${BASE}`);

  const adminCookie = await login("admin", "penguin-2026");
  const browser = await chromium.launch();

  // WebP encoder: Chromium re-encodes the PNG screenshot via canvas (capture-shots convention).
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
    console.log(`[blog-013] ${fileName}`);
  }

  /** New logged-in context+page at 1280x900 @1.5x with theme/lang/panel-width preset. */
  async function openPage(user, lang, theme, url) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 1.5,
      locale: lang === "zh" ? "zh-CN" : "en-US",
    });
    await context.addInitScript(
      ([t, l]) => {
        localStorage.setItem("penguin.theme", t);
        localStorage.setItem("penguin.lang", l);
        localStorage.setItem("penguin.subagentsPanelWidth", "430");
      },
      [theme, lang],
    );
    const page = await context.newPage();
    globalThis.__page = page; // last opened page, for the failure dump below
    await page.goto(`${BASE}/login`);
    const loginRes = await page.request.post(`${BASE}/api/auth/login`, {
      data: { userId: user.userId, password: user.password },
    });
    if (!loginRes.ok()) throw new Error(`browser login failed: ${loginRes.status()}`);
    await page.goto(url);
    return { context, page };
  }

  /**
   * Screenshot BOTH themes concurrently: exec_command / run_subagent yield to the
   * background at ~60s (DEFAULT_EXEC_YIELD_MS and the tools' timeouts), and a
   * backgrounded child renders as "done" — everything is visibly live only inside that
   * first minute, so the two shots must land inside the same window, not sequentially.
   */
  async function captureBothThemes(user, lang, url, fileBase, prep) {
    const pages = await Promise.all(
      ["light", "dark"].map((theme) => openPage(user, lang, theme, url)),
    );
    try {
      await Promise.all(
        pages.map(async ({ page }, i) => {
          try {
            await prep(page);
          } catch (err) {
            // Dump THIS page before the contexts close (the global catch fires too late).
            const dump = process.env.SHOT_DEBUG_DIR || os.tmpdir();
            const tag = `${fileBase}-${lang}-${["light", "dark"][i]}`;
            await page
              .screenshot()
              .then((buf) => writeFileSync(path.join(dump, `fail-${tag}.png`), buf))
              .catch(() => {});
            await page
              .evaluate(() => document.body.innerText)
              .then((text) => writeFileSync(path.join(dump, `fail-${tag}.txt`), text))
              .catch(() => {});
            throw err;
          }
          await page.waitForTimeout(2000);
          await saveWebp(
            await page.screenshot(),
            `${fileBase}-${lang}-${["light", "dark"][i]}.webp`,
          );
        }),
      );
    } finally {
      for (const { context } of pages) await context.close();
    }
  }

  for (const lang of ["zh", "en"]) {
    const user = await provisionUser(adminCookie, lang);
    const scene = SCENES[lang];
    const ui = USERS[lang];
    const wsRoot = path.join(dataRoot, "ws", lang);

    // ---- Scene 1: agents panel --------------------------------------------------------
    {
      const ws = path.join(wsRoot, "benchmark-review");
      mkdirSync(ws, { recursive: true });
      stageBenchWorkspace(ws);
      const sessionId = await createSession(user, ws);

      // Drive once: warm-up for the title, then the fan-out prompt via the composer.
      const driver = await openPage(user, lang, "light", `${BASE}/chat/${sessionId}`);
      await warmup(user, sessionId, scene.agents.warmup, "score-runs", driver.page);
      const input = driver.page.getByPlaceholder(/输入消息|Type a message/);
      await input.waitFor({ timeout: 20000 });
      await input.fill(scene.agents.prompt);
      await driver.page.getByRole("button", { name: /发送|Send/ }).click();
      // Both children spawned: their bar rows carry the resolved agent names.
      await driver.page.getByText(ui.agents[0].name).first().waitFor({ timeout: 60000 });
      await driver.page.getByText(ui.agents[1].name).first().waitFor({ timeout: 60000 });
      await driver.context.close();

      await captureBothThemes(
        user,
        lang,
        `${BASE}/chat/${sessionId}`,
        "agents-panel",
        async (page) => {
          await page.getByText(ui.agents[1].name).first().waitFor({ timeout: 30000 });
          // Give the replayed stream's auto-open a beat, then ensure the panel is open —
          // keyed on the topology label so an already-open panel is never toggled closed —
          // and focus the analyst's conversation.
          await page.waitForTimeout(1200);
          if (
            !(await page
              .getByText(ui.topologyLabel)
              .first()
              .isVisible()
              .catch(() => false))
          ) {
            await page.getByRole("button", { name: ui.panelTitle }).first().click();
          }
          const node = page.getByRole("button", { name: ui.analystNode, exact: true });
          await node.waitFor({ timeout: 20000 });
          await node.click();
          // Tool cards render as collapsed rows: expand the analyst's running exec card so
          // the command and its streaming output are in frame (the only exec_command row on
          // the page — the parent conversation holds run_subagent rows only).
          const execRow = page.getByText("exec_command").last();
          await execRow.waitFor({ timeout: 30000 });
          await execRow.click();
          await page.getByText("--runs 41,42,43").first().waitFor({ timeout: 15000 });
          // Let scoring lines and node elapsed accumulate, still well inside the ~60s window.
          await page.waitForTimeout(12000);
        },
      );
      await api(user.cookie, "POST", `/api/sessions/${sessionId}/abort`, {}).catch(() => {});
    }

    // ---- Scene 2: goal mode -----------------------------------------------------------
    {
      const ws = path.join(wsRoot, "penguin-table");
      mkdirSync(ws, { recursive: true });
      stageTableWorkspace(ws);
      const sessionId = await createSession(user, ws);

      const driver = await openPage(user, lang, "light", `${BASE}/chat/${sessionId}`);
      await warmup(user, sessionId, scene.goal.warmup, "run-checks", driver.page);
      // Start the goal (the composer's goal chip posts exactly this request shape).
      await api(user.cookie, "POST", `/api/sessions/${sessionId}/tasks`, {
        input: [{ type: "text", text: scene.goal.objective }],
        goal: { budget: 500000 },
      });
      await driver.context.close();

      // Rounds 1-2 run and fix for real; round 3's slow verification run is the window.
      await captureBothThemes(
        user,
        lang,
        `${BASE}/chat/${sessionId}`,
        "goal-mode",
        async (page) => {
          await page.getByText(ui.round3).first().waitFor({ timeout: 180000 });
          // Round 3's own lead-in text (unique to this round), then expand the running check
          // run (rounds 1-2 are collapsed groups, so theirs are unmounted) and let a few
          // green checks stream into the card — still inside the ~60s exec window.
          await page.getByText(ui.round3Text).first().waitFor({ timeout: 60000 });
          const checkRow = page.getByText("exec_command").last();
          await checkRow.waitFor({ timeout: 30000 });
          await checkRow.click();
          await page.getByText("column widths · ascii").first().waitFor({ timeout: 30000 });
          await page.waitForTimeout(14000);
        },
      );
      await api(user.cookie, "POST", `/api/sessions/${sessionId}/abort`, {}).catch(() => {});
    }
  }

  await browser.close();
  console.log(`[blog-013] done -> ${OUT_DIR}`);
  process.exit(0);
} catch (err) {
  console.error("[blog-013] FAILED:", err);
  // Failure dump: the last page's screenshot plus every button's accessible naming hints.
  try {
    const page = globalThis.__page;
    if (page && !page.isClosed()) {
      const dump = process.env.SHOT_DEBUG_DIR || os.tmpdir();
      writeFileSync(path.join(dump, "blog013-failure.png"), await page.screenshot());
      const buttons = await page.evaluate(() =>
        [...document.querySelectorAll("button")].map(
          (b) =>
            b.getAttribute("aria-label") || b.getAttribute("title") || b.textContent?.slice(0, 40),
        ),
      );
      console.error("[blog-013] page buttons:", JSON.stringify(buttons));
    }
  } catch {}
  process.exit(1);
}

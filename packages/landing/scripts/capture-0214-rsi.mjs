/**
 * Capture the 0.2.14 release screenshots for the RSI toolkits and the built-in Benchmarks, and
 * the tutorial shots of "Self-evolve your agents with the RSI toolkits".
 *
 * Same machinery as capture-blog-013-shots.mjs: a scripted mock LLM speaking OpenAI
 * chat-completions SSE, the built server on a scratch data root, Playwright against the built
 * Web App. One Project per UI language (`rsi_en`, `rsi_zh`), so every sidebar, agent name and
 * conversation is in one language.
 *
 * What is real and what is seeded:
 * - Real: the start page, the plugin library and its RSI category, the seven built-in
 *   Benchmarks a new Project is given, the Use dialog and its Method select (read from the
 *   library), the optimization conversation's prompt (assembled by the Use dialog), and every
 *   tool call in that conversation — it reads the scoreboard and the statements, snapshots the
 *   agent, writes a Skill, edits AGENTS.md, bumps the version, runs 30 evaluation subagents
 *   through run_subagent and appends the accepted evaluation to scoreboard.yaml.
 * - Seeded: the scoreboards' earlier evaluations (written to disk before the shots), the tested
 *   agents' AGENTS.md and version, and every score: the mock LLM plays both the optimizer and
 *   the evaluator subagents, so no Harbor trial runs.
 * - Relabelled: the tree is main before the release bump, so /api/version and /api/plugins
 *   report 0.2.13; the browser rewrites that to SHOT_VERSION (default 0.2.14) so the start page
 *   and the plugin cards read as the release does. SHOT_VERSION="" shows the real value.
 *
 * Files (into $SHOT_OUT, default <data>/out; PNGs straight from Chromium, quantize afterwards):
 *   penguinharness-0-2-14-{start-page,rsi-plugins,benchmarks,benchmark-detail}-<lang>.png
 *   rsi-toolkits-{method,optimize-chat,optimize-cells,evaluation}-<lang>.png
 *
 * Prereqs: a built tree (`pnpm -r build`) and Playwright's chromium. Run from this tree:
 *   SHOT_DATA=<scratch dir> node packages/landing/scripts/capture-0214-rsi.mjs
 * SHOT_PORT (default 19100; the mock takes the next port), SHOT_LANGS and SHOT_ONLY narrow a run.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const DATA = path.resolve(process.env.SHOT_DATA ?? path.join(os.tmpdir(), "penguin-0214-rsi"));
const OUT_DIR = path.resolve(process.env.SHOT_OUT ?? path.join(DATA, "out"));
const HOME = path.join(DATA, "home");
const SRV_PORT = Number(process.env.SHOT_PORT ?? 19100);
const MOCK_PORT = SRV_PORT + 1;
const SEED_PASSWORD = "penguin-2026";
const ADMIN_PASSWORD = "penguin-rsi-0214";
const BASE = `http://localhost:${SRV_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const LANGS = (process.env.SHOT_LANGS ?? "en,zh").split(",");
// The start page prints the running version. This tree is main before the release bump, so the
// label is set to the version the shots ship with; SHOT_VERSION="" keeps the real one.
const SHOW_VERSION = process.env.SHOT_VERSION ?? "0.2.14";

const TRAIN = "penguinharness-benchmark-gdpevo-train";
const TEST = "penguinharness-benchmark-gdpevo-test";
const TESTED = "biz_analyst";
const MODEL = { provider: "deepseek", modelId: "deepseek-v4-pro" };

// ---------------------------------------------------------------------------
// Per-language content.
// ---------------------------------------------------------------------------

const ENVS = {
  en: [
    "Support Console",
    "ERP Finance API",
    "Asteria Investment Office",
    "Northstar Payer Operations",
    "Court Operations Portal",
    "Engineering Portfolio Analytics",
  ],
  zh: [
    "客服工单台",
    "ERP 财务接口",
    "Asteria 投资办公室",
    "Northstar 医保运营",
    "法院业务门户",
    "工程组合分析",
  ],
};

const AGENTS = {
  en: [
    {
      agentId: "biz_analyst",
      name: "Business Analyst",
      description: "Answers business questions against CRM, ERP, finance and portal APIs",
    },
    {
      agentId: "backoffice",
      name: "Back-Office Assistant",
      description: "Reconciles tickets, invoices and claims in the company systems",
    },
    {
      agentId: "claims_analyst",
      name: "Claims Analyst",
      description: "Reviews payer claims and prior authorizations",
    },
  ],
  zh: [
    {
      agentId: "biz_analyst",
      name: "业务分析师",
      description: "对接 CRM、ERP、财务与各业务门户接口，回答业务问题",
    },
    {
      agentId: "backoffice",
      name: "后台运营助理",
      description: "在公司系统里核对工单、发票与理赔",
    },
    { agentId: "claims_analyst", name: "理赔分析师", description: "审核医保理赔与事前授权" },
  ],
};

const PROJECT_NAME = { en: "Ops Lab", zh: "运营实验室" };

const AGENTS_MD = {
  en: `# Business Analyst

You answer business questions against the company systems a task names: CRM, ERP, finance, payer and court portals, analytics APIs.

- Read the whole instruction before the first query, and note every output field it asks for.
- Query the environment's API; never guess a value an endpoint can return.
- Write the final answer as one JSON object in answer.json, exactly as the instruction specifies.
- When two sources disagree, use the system of record the instruction names, and say which one you used.
`,
  zh: `# 业务分析师

你基于任务指定的公司系统回答业务问题：CRM、ERP、财务、医保与法院门户、分析类接口。

- 第一次查询前先读完整个指令，记下它要求的每一个输出字段。
- 查询环境提供的接口；接口能返回的值不要猜。
- 最终答案写成 answer.json 里的一个 JSON 对象，严格按指令的格式。
- 两个来源不一致时，以指令指定的权威系统为准，并说明用的是哪一个。
`,
};

const SKILL_MD = {
  en: `---
name: answer-check
description: Check answer.json against the instruction's field list before finishing a business task.
---

# Answer check

Before you finish a task that asks for answer.json:

1. List every field the instruction names, with its type and unit.
2. Compare answer.json with that list: no field missing, none renamed, no extra keys.
3. Amounts take the precision the instruction asks for, else 2 decimals; dates are ISO 8601.
4. When a value depends on a filter (a date range, a status, a region), run that query once more and confirm the count.
5. Fix what differs, then finish.
`,
  zh: `---
name: answer-check
description: 结束业务任务前，按指令的字段清单核对 answer.json。
---

# 答案核对

结束一个要求 answer.json 的任务之前：

1. 列出指令点名的每个字段，连同类型和单位。
2. 拿 answer.json 逐项对照：不缺字段、不改名、不多出键。
3. 金额按指令要求的精度，未说明时保留 2 位小数；日期用 ISO 8601。
4. 某个值依赖筛选条件（日期范围、状态、地区）时，把那次查询再跑一遍，确认条数。
5. 改正不一致之处，再结束。
`,
};

const AGENTS_MD_LINE = {
  en: "- Before finishing, run the `answer-check` Skill on answer.json.",
  zh: "- 结束前，用 `answer-check` 技能核对 answer.json。",
};

// Scoreboard history before the conversation (Asia/Shanghai = UTC+8 in the chart's labels).
// Series: biz_analyst · deepseek-v4-pro · high (Default RSI), backoffice · glm-5.3 · medium
// (ACE), claims_analyst · kimi-k3 · high (OPRO).
const HISTORY = [
  {
    key: "a1",
    time: "2026-10-09T06:20:00Z",
    agent: "biz_analyst",
    version: 1,
    provider: "deepseek",
    model: "deepseek-v4-pro",
    thinking: "high",
    target: 52.4,
    title: { en: "Formal baseline", zh: "正式基线" },
    summary: {
      en: "Baseline of biz_analyst v1 on all 30 train cases, one run each.",
      zh: "biz_analyst v1 在全部 30 道训练题上的基线，每题一次。",
    },
  },
  {
    key: "b1",
    time: "2026-10-09T08:40:00Z",
    agent: "backoffice",
    version: 1,
    provider: "tokendance",
    model: "glm-5.3",
    thinking: "medium",
    target: 44.2,
    title: { en: "ACE · baseline", zh: "ACE · 基线" },
    summary: {
      en: "ACE measured the empty playbook before its first epoch.",
      zh: "ACE 在第一个 epoch 之前测量空手册。",
    },
  },
  {
    key: "c1",
    time: "2026-10-10T02:15:00Z",
    agent: "claims_analyst",
    version: 1,
    provider: "tokendance",
    model: "kimi-k3",
    thinking: "high",
    target: 47.8,
    title: { en: "OPRO · seed instruction", zh: "OPRO · 种子指令" },
    summary: { en: "OPRO scored the seed instruction.", zh: "OPRO 给种子指令打分。" },
  },
  {
    key: "c2",
    time: "2026-10-10T05:30:00Z",
    agent: "claims_analyst",
    version: 2,
    provider: "tokendance",
    model: "kimi-k3",
    thinking: "high",
    target: 47.0,
    title: { en: "OPRO · step 1, candidate 1", zh: "OPRO · 第 1 步，候选 1" },
    summary: {
      en: "A shorter instruction that dropped the query plan; it scored lower.",
      zh: "更短的指令，去掉了查询计划；分数下降。",
    },
  },
  {
    key: "c3",
    time: "2026-10-11T00:50:00Z",
    agent: "claims_analyst",
    version: 3,
    provider: "tokendance",
    model: "kimi-k3",
    thinking: "high",
    target: 51.4,
    title: { en: "OPRO · step 1, candidate 2", zh: "OPRO · 第 1 步，候选 2" },
    summary: {
      en: "The instruction asks for the payer's policy table before any claim decision.",
      zh: "指令要求先查医保政策表，再做任何理赔判断。",
    },
  },
  {
    key: "b2",
    time: "2026-10-11T01:30:00Z",
    agent: "backoffice",
    version: 2,
    provider: "tokendance",
    model: "glm-5.3",
    thinking: "medium",
    target: 50.6,
    title: { en: "ACE · playbook after 1 epoch", zh: "ACE · 1 个 epoch 后的手册" },
    summary: {
      en: "The Curator folded 14 rules from the training Traces into the playbook.",
      zh: "Curator 从训练轨迹中归纳出 14 条规则并入手册。",
    },
  },
  {
    key: "c4",
    time: "2026-10-11T04:10:00Z",
    agent: "claims_analyst",
    version: 4,
    provider: "tokendance",
    model: "kimi-k3",
    thinking: "high",
    target: 54.6,
    title: { en: "OPRO · step 2, best candidate", zh: "OPRO · 第 2 步，最佳候选" },
    summary: {
      en: "Adds a check of the authorization window before approving a claim.",
      zh: "批准理赔前增加对授权有效期的核对。",
    },
  },
  {
    key: "a2",
    time: "2026-10-10T13:05:00Z",
    agent: "biz_analyst",
    version: 2,
    provider: "deepseek",
    model: "deepseek-v4-pro",
    thinking: "high",
    target: 61.4,
    title: {
      en: "Default RSI · cite the system of record",
      zh: "默认 RSI · 以权威系统为准",
    },
    summary: {
      en: "AGENTS.md now says which source wins when two systems disagree.",
      zh: "AGENTS.md 写明两个系统不一致时以哪个为准。",
    },
  },
];

const V3 = {
  key: "a3",
  time: "2026-10-12T09:12:00Z",
  agent: "biz_analyst",
  version: 3,
  provider: "deepseek",
  model: "deepseek-v4-pro",
  thinking: "high",
  target: 67.9,
  title: { en: "Default RSI · answer-check Skill", zh: "默认 RSI · answer-check 技能" },
  summary: {
    en: "A focused Skill checks answer.json against the instruction's field list before finishing.",
    zh: "新增一个专门的技能，结束前按指令的字段清单核对 answer.json。",
  },
};

const TEST_HISTORY = [
  {
    key: "t1",
    time: "2026-10-09T11:10:00Z",
    agent: "biz_analyst",
    version: 1,
    provider: "deepseek",
    model: "deepseek-v4-pro",
    thinking: "high",
    target: 49.1,
    title: { en: "Held-out baseline", zh: "测试集基线" },
    summary: { en: "v1 on the 30 held-out test cases.", zh: "v1 在 30 道测试题上的成绩。" },
  },
  {
    key: "t2",
    time: "2026-10-11T14:40:00Z",
    agent: "biz_analyst",
    version: 2,
    provider: "deepseek",
    model: "deepseek-v4-pro",
    thinking: "high",
    target: 55.8,
    title: { en: "Held-out check of v2", zh: "v2 测试集复核" },
    summary: {
      en: "v2 from the Default RSI round on GDPevo Train, scored on the test cases.",
      zh: "在 GDPevo Train 上经默认 RSI 得到的 v2，在测试题上的成绩。",
    },
  },
];

// ---------------------------------------------------------------------------
// Believable per-case scores: GDPevo's grader scores a fraction of 1, × 100.
// ---------------------------------------------------------------------------

const FRACTIONS = [0, 20, 25, 33.33, 40, 50, 60, 66.67, 75, 80, 100];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (x) => Math.round(x * 100) / 100;
const meanOf = (idx) => idx.reduce((n, i) => n + FRACTIONS[i], 0) / idx.length;

/** Index into FRACTIONS nearest to a score. */
function nearest(score) {
  let best = 0;
  for (let i = 1; i < FRACTIONS.length; i++)
    if (Math.abs(FRACTIONS[i] - score) < Math.abs(FRACTIONS[best] - score)) best = i;
  return best;
}

/**
 * Per-environment target means of every evaluation (Support Console, ERP Finance API, Asteria
 * Investment Office, Northstar Payer Operations, Court Operations Portal, Engineering Portfolio
 * Analytics), and the evaluation each later version starts from. A later version keeps its
 * parent's case scores and moves single cases a step at a time, so the same case reads alike
 * across versions.
 */
const ENV_TARGETS = {
  a1: [63, 58, 60, 44, 34, 55],
  a2: [68, 70, 69, 52, 41, 68],
  a3: [71, 72, 68, 67, 61, 69],
  b1: [52, 47, 45, 38, 32, 51],
  b2: [58, 53, 50, 45, 39, 59],
  c1: [50, 46, 48, 52, 38, 53],
  c2: [49, 45, 47, 52, 37, 52],
  c3: [51, 48, 50, 61, 40, 58],
  c4: [53, 50, 52, 68, 42, 62],
  t1: [60, 55, 57, 41, 30, 52],
  t2: [65, 60, 62, 48, 37, 61],
};
const PARENT = { a2: "a1", a3: "a2", b2: "b1", c2: "c1", c3: "c1", c4: "c3", t2: "t1" };

/** Moves one environment's five cases a step at a time until their mean is near the target. */
function nudgeEnv(v, e, target, rng) {
  const mean = () => meanOf(v.slice(e * 5, e * 5 + 5));
  for (let guard = 0; guard < 400 && Math.abs(mean() - target) > 1.4; guard++) {
    const i = e * 5 + Math.floor(rng() * 5);
    if (mean() < target && v[i] < FRACTIONS.length - 1) v[i] += 1;
    else if (mean() > target && v[i] > 0) v[i] -= 1;
  }
}

/** Every evaluation's case vector (indices into FRACTIONS), keyed by evaluation key. */
function buildVectors() {
  const rng = mulberry32(20261012);
  const v = {};
  for (const key of Object.keys(ENV_TARGETS)) {
    const targets = ENV_TARGETS[key];
    let vec;
    if (PARENT[key]) {
      vec = v[PARENT[key]].slice();
      // One case in a few environments slips: runs are noisy, versions are not monotone per case.
      for (let e = 0; e < 6; e++)
        if (rng() < 0.35) {
          const i = e * 5 + Math.floor(rng() * 5);
          if (vec[i] > 0) vec[i] -= 1;
        }
    } else {
      vec = [];
      for (let e = 0; e < 6; e++)
        for (let k = 0; k < 5; k++) vec.push(nearest(targets[e] + (rng() - 0.5) * 70));
    }
    for (let e = 0; e < 6; e++) nudgeEnv(vec, e, targets[e], rng);
    v[key] = vec;
  }
  return v;
}

const TRIAL_CHARS = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A full evaluation record (the scoreboard's field names) for one history entry. */
function evaluationRecord(entry, vector, caseIds, lang, seed) {
  const rng = mulberry32(seed);
  const cases = caseIds.map((caseId, i) => {
    const score = FRACTIONS[vector[i]];
    const cost = Number((0.018 + rng() * 0.07).toFixed(6));
    const duration = Math.round(170000 + rng() * 460000);
    const task = caseId.replace(/^CASE-\d+-/, "");
    let trial = "";
    for (let k = 0; k < 7; k++) trial += TRIAL_CHARS[Math.floor(rng() * TRIAL_CHARS.length)];
    return {
      case: caseId,
      score,
      cost,
      duration_ms: duration,
      runs: [{ score, cost, duration_ms: duration, session_id: `harbor:${task}__${trial}` }],
    };
  });
  const avg = (k) => cases.reduce((n, c) => n + c[k], 0) / cases.length;
  return {
    time: entry.time,
    agent_id: entry.agent,
    version: entry.version,
    provider: entry.provider,
    model_id: entry.model,
    thinking_level: entry.thinking,
    summary_title: entry.title[lang],
    summary: entry.summary[lang],
    score: round2(avg("score")),
    cost: Number(avg("cost").toFixed(6)),
    duration_ms: Math.round(avg("duration_ms")),
    cases,
  };
}

/** YAML for one evaluation as a list item under `evaluations:` (block style, two-space list). */
function evaluationYaml(e) {
  const q = (s) => JSON.stringify(s);
  const lines = [
    `  - time: ${q(e.time)}`,
    `    agent_id: ${e.agent_id}`,
    `    version: ${e.version}`,
    `    provider: ${e.provider}`,
    `    model_id: ${e.model_id}`,
    `    thinking_level: ${e.thinking_level}`,
    `    summary_title: ${q(e.summary_title)}`,
    `    summary: ${q(e.summary)}`,
    `    score: ${e.score}`,
    `    cost: ${e.cost}`,
    `    duration_ms: ${e.duration_ms}`,
    `    cases:`,
  ];
  for (const c of e.cases) {
    lines.push(
      `      - case: ${c.case}`,
      `        score: ${c.score}`,
      `        cost: ${c.cost}`,
      `        duration_ms: ${c.duration_ms}`,
      `        runs:`,
    );
    for (const r of c.runs)
      lines.push(
        `          - score: ${r.score}`,
        `            cost: ${r.cost}`,
        `            duration_ms: ${r.duration_ms}`,
        `            session_id: ${q(r.session_id)}`,
      );
  }
  return lines.join("\n") + "\n";
}

/** Per-environment means of one evaluation's cases (6 environments × 5 cases, in order). */
function envMeans(e) {
  const out = [];
  for (let g = 0; g < 6; g++) {
    const part = e.cases.slice(g * 5, g * 5 + 5);
    out.push(part.reduce((n, c) => n + c.score, 0) / part.length);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The optimization conversation (Default RSI Toolkit, one round, v2 → v3).
// ---------------------------------------------------------------------------

/** Filled in per language once the data root and the scores are known. */
const STATE = {};

function scene(lang) {
  const st = STATE[lang];
  const { app, ref, cand, base, caseIds } = st;
  const bench = `${app}/benchmarks/${TRAIN}`;
  const agent = `${app}/agents/${TESTED}`;
  const refEnv = envMeans(ref);
  const candEnv = envMeans(cand);
  const weakest = [4, 3]; // court, payer: the environments the hypothesis targets
  const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
  const env = ENVS[lang];
  const caseOf = (g, k) => caseIds[g * 5 + k];
  const lowCases = ref.cases.filter((c, i) => weakest.includes(Math.floor(i / 5)) && c.score < 50);
  const lowNames = lowCases.slice(0, 2).map((c) => c.case);
  const zh = lang === "zh";

  const readRef = {
    description: zh ? "读取 v2 参照评估的分数" : "Read the v2 Reference scores",
    cmd: `cd ${bench} && grep -nE '^    (agent_id|version|score):' scoreboard.yaml | tail -n 6`,
  };
  const readStatements = {
    description: zh
      ? "阅读两个最弱环境的题面"
      : "Read the statements of the two weakest environments",
    cmd: `cd ${bench} && head -n 8 ${lowNames.map((n) => `${n}/statement/README.md`).join(" ")}`,
  };
  const snapshot = {
    description: zh ? "改动前为 v2 做快照" : "Snapshot v2 before changing it",
    cmd: `cd ${agent} && mkdir -p snapshots && (test -e snapshots/v2.tar.gz || tar --exclude=.vault.toml -czf snapshots/v2.tar.gz agent_state) && tar -tzf snapshots/v2.tar.gz | head -n 4`,
  };
  const bump = {
    description: zh ? "候选版本号改为 3" : "Set the Candidate's version to 3",
    cmd: `cd ${agent} && sed -i 's/^version: 2$/version: 3/' agent_state/system_config.yaml && grep -n '^version:' agent_state/system_config.yaml`,
  };
  const append = {
    description: zh
      ? "把 v3 的评估追加到 scoreboard.yaml 并校验"
      : "Append the v3 evaluation to scoreboard.yaml and verify it",
    cmd: `cat v3-evaluation.yaml >> ${bench}/scoreboard.yaml && grep -c '^  - time:' ${bench}/scoreboard.yaml && tail -n 4 ${bench}/scoreboard.yaml`,
  };

  const cell = (i) => ({
    description: zh
      ? `评估单元 ${caseIds[i].slice(0, 8)} · 第 1 次`
      : `Evaluate cell ${caseIds[i].slice(0, 8)} · run 1`,
    prompt:
      "Use the `agent-evaluation` Skill. Run the specified Test Agent on the specified Case exactly once, then score that single execution.\n" +
      "protocol_version: 1\n" +
      `case_id: ${caseIds[i]}\n` +
      "run: 1\n" +
      "expected_version: 3\n" +
      `test_agent_id: ${TESTED}\n` +
      `benchmark_id: ${TRAIN}\n` +
      `provider: ${MODEL.provider}\n` +
      `model_id: ${MODEL.modelId}`,
  });

  const delta = (a, b) => {
    const d = b - a;
    if (Math.abs(d) < 0.05) return "0.0";
    return `${d >= 0 ? "+" : "−"}${f1(Math.abs(d))}`;
  };
  const target = Math.min(100, Math.ceil(ref.score) + 10);
  const others = [0, 1, 2, 5].map((g) => Math.abs(candEnv[g] - refEnv[g]));
  const othersMax = f1(Math.max(...others));
  const totalDelta = `${cand.score >= ref.score ? "+" : "−"}${Math.abs(cand.score - ref.score).toFixed(2)}`;
  const tableRows = env
    .map(
      (name, g) =>
        `| ${name} | ${f1(refEnv[g])} | ${f1(candEnv[g])} | ${delta(refEnv[g], candEnv[g])} |`,
    )
    .join("\n");

  if (zh) {
    return {
      thinking1: `参照版本是 biz_analyst v2，在 deepseek-v4-pro · high 上 ${ref.score} 分；本轮只允许 1 个候选，目标 ≥${target}。先看各环境的分数和最弱几题的题面。`,
      text2:
        `v2 的失分集中在${env[4]}（${f1(refEnv[4])}）和${env[3]}（${f1(refEnv[3])}）。这两组的低分题都要求在 answer.json 里交一组固定字段，而 v2 常漏字段或金额没按要求取整。\n\n` +
        "**假设**：结束前按指令的字段清单核对 answer.json，这两个环境的分数会上升，其余环境不受影响。候选 v3：新增一个专门的 `answer-check` 技能，并在 AGENTS.md 里加一行指向它。",
      text3: `候选 v3 已就位。现在在全部 30 题上评估它，每题 1 次，模型与思考等级沿用参照的 deepseek-v4-pro · high。`,
      thinking4: `30 个单元全部有效，均为 deepseek-v4-pro · high、版本 3。平均 ${cand.score} 分，严格高于参照的 ${ref.score}，接受 v3。`,
      text4: `30 个单元全部返回有效结果。v3 平均 **${cand.score}**，高于 v2 的 ${ref.score}，保留 v3，把这次评估写进记分板。`,
      final:
        `**保留 v3**。GDPevo Train 上从 ${ref.score}（v2）升到 **${cand.score}**（v3）；v1 基线为 ${base.score}。每题 1 次，deepseek-v4-pro · high。\n\n` +
        `| 环境 | v2 | v3 | 变化 |\n|---|---:|---:|---:|\n${tableRows}\n| **合计** | **${ref.score}** | **${cand.score}** | **${totalDelta}** |\n\n` +
        `假设成立：提升集中在${env[4]}和${env[3]}这两个最弱的环境，其余四个环境的变化都在 ${othersMax} 分以内。目标 ${target} 未达到，轮数上限（1）已用完。v2 的快照在 \`snapshots/v2.tar.gz\`，需要时可以回滚。`,
      readRef,
      readStatements,
      snapshot,
      bump,
      append,
      cell,
      agentsMd: `${agent}/agent_state/AGENTS.md`,
      skillPath: `${agent}/agent_state/skills/answer-check/SKILL.md`,
    };
  }
  return {
    thinking1: `The Reference is biz_analyst v2 at ${ref.score} on deepseek-v4-pro · high. One Candidate round is allowed and the target is >=${target}. Start with the per-environment scores and the statements of the weakest cases.`,
    text2:
      `v2 loses most of its points in ${env[4]} (${f1(refEnv[4])}) and ${env[3]} (${f1(refEnv[3])}). The low cases there all ask for a fixed set of fields in answer.json, and v2 tends to leave one out or skip the rounding the instruction asks for.\n\n` +
      "**Hypothesis:** checking answer.json against the instruction's field list before finishing raises those two environments and leaves the others where they are. Candidate v3: a focused `answer-check` Skill and one line in AGENTS.md that points to it.",
    text3: `Candidate v3 is in place. Evaluating it on all 30 cases, one run each, on the Reference runtime: deepseek-v4-pro · high.`,
    thinking4: `All 30 cells are valid, each on deepseek-v4-pro · high at version 3. Average ${cand.score}, strictly above the Reference's ${ref.score}: accept v3.`,
    text4: `All 30 cells returned valid results. v3 averages **${cand.score}** against v2's ${ref.score}, so v3 is kept and its evaluation goes into the scoreboard.`,
    final:
      `**Kept v3.** GDPevo Train went from ${ref.score} (v2) to **${cand.score}** (v3); the v1 baseline was ${base.score}. One run per case, deepseek-v4-pro · high.\n\n` +
      `| Environment | v2 | v3 | Change |\n|---|---:|---:|---:|\n${tableRows}\n| **Total** | **${ref.score}** | **${cand.score}** | **${totalDelta}** |\n\n` +
      `The hypothesis held: the gains are in ${env[4]} and ${env[3]}, the two weakest environments, and the other four moved by ${othersMax} points or less. The target of ${target} is not reached, and the round limit (1) is used up. The v2 snapshot is \`snapshots/v2.tar.gz\` if you want to roll back.`,
    readRef,
    readStatements,
    snapshot,
    bump,
    append,
    cell,
    agentsMd: `${agent}/agent_state/AGENTS.md`,
    skillPath: `${agent}/agent_state/skills/answer-check/SKILL.md`,
  };
}

/** The assistant's next turn in the optimization conversation, from how many tool results it holds. */
function optimizerTurn(lang, toolResults) {
  const s = scene(lang);
  const st = STATE[lang];
  const exec = (x) => ({ name: "exec_command", args: { description: x.description, cmd: x.cmd } });
  if (toolResults === 0)
    return { thinking: s.thinking1, calls: [exec(s.readRef), exec(s.readStatements)] };
  if (toolResults === 2) {
    const md = AGENTS_MD[lang].trimEnd().split("\n");
    const last = md[md.length - 1];
    return {
      text: s.text2,
      calls: [
        exec(s.snapshot),
        { name: "write_file", args: { file_path: s.skillPath, content: SKILL_MD[lang] } },
        {
          name: "edit_file",
          args: {
            file_path: s.agentsMd,
            old_string: last,
            new_string: `${last}\n${AGENTS_MD_LINE[lang]}`,
          },
        },
        exec(s.bump),
      ],
    };
  }
  const evalStart = 6;
  const cells = st.caseIds.length;
  if (toolResults >= evalStart && toolResults < evalStart + cells) {
    const done = toolResults - evalStart;
    const batch = [];
    for (let i = done; i < Math.min(done + 4, cells); i++) {
      const c = s.cell(i);
      batch.push({
        name: "run_subagent",
        args: { description: c.description, prompt: c.prompt },
      });
    }
    return { ...(done === 0 ? { text: s.text3 } : {}), calls: batch };
  }
  if (toolResults === evalStart + cells) {
    st.cand.time = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    return {
      thinking: s.thinking4,
      text: s.text4,
      calls: [
        {
          name: "write_file",
          args: { file_path: "v3-evaluation.yaml", content: evaluationYaml(st.cand) },
        },
        exec(s.append),
      ],
    };
  }
  return { text: s.final };
}

/** An evaluator subagent's protocol result for one cell of v3. */
function cellResult(lang, caseId) {
  const st = STATE[lang];
  const c = st.cand.cases.find((x) => x.case === caseId);
  if (!c) return "protocol_version: 1\nstatus: failed\nfailure_code: invalid_request";
  return [
    "protocol_version: 1",
    "status: ok",
    `case_id: ${caseId}`,
    "run: 1",
    `agent_id: ${TESTED}`,
    "expected_version: 3",
    `provider: ${MODEL.provider}`,
    `model_id: ${MODEL.modelId}`,
    "thinking_level: high",
    `score: ${c.score}`,
    `cost: ${c.cost}`,
    `duration_ms: ${c.duration_ms}`,
    `session_id: ${c.runs[0].session_id}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Mock LLM (OpenAI chat-completions SSE).
// ---------------------------------------------------------------------------

const TITLES = {
  en: "Optimize Business Analyst",
  zh: "优化业务分析师",
};

function langOfRequest(flat) {
  if (flat.includes("/rsi_zh")) return "zh";
  if (flat.includes("/rsi_en")) return "en";
  return /[一-鿿]{4}/.test(flat) ? "zh" : "en";
}

function decide(body) {
  const messages = body.messages ?? [];
  const flat = JSON.stringify(messages);
  const lang = langOfRequest(flat);
  if (flat.includes("You are a title generator")) {
    const user = /<user>([\s\S]*?)<\/user>/.exec(flat)?.[1] ?? "";
    const zh = /[一-鿿]/.test(user);
    return { text: TITLES[zh ? "zh" : "en"] };
  }
  if (flat.includes("candidate_round_limit")) {
    const toolResults = messages.filter((m) => m.role === "tool").length;
    return optimizerTurn(lang, toolResults);
  }
  const m = /case_id: (CASE-[A-Za-z0-9-]+)/.exec(flat);
  if (m && flat.includes("protocol_version: 1")) {
    // An evaluator holds its reply for a while, the way a Harbor trial takes its time, so the
    // run's durations read like an evaluation rather than a mock answering instantly.
    const n = Number(/^CASE-(\d+)/.exec(m[1])?.[1] ?? 1);
    return { text: cellResult(lang, m[1]), hold: 9000 + ((n * 5300) % 14000) };
  }
  return { text: "OK." };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reply(res, body) {
  const turn = decide(body);
  if (turn.hold) await sleep(turn.hold);
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const chunk = (delta, finish = null, usage) => {
    const payload = {
      id: "chatcmpl-rsi",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: MODEL.modelId,
      choices: [{ index: 0, delta, finish_reason: finish }],
    };
    if (usage) payload.usage = usage;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  chunk({ role: "assistant" });
  if (turn.thinking)
    for (const t of turn.thinking.match(/[\s\S]{1,24}/g) ?? []) {
      chunk({ reasoning_content: t });
      await sleep(60);
    }
  if (turn.text)
    for (const t of turn.text.match(/[\s\S]{1,40}/g) ?? []) {
      chunk({ content: t });
      await sleep(turn.hold ? 0 : 50);
    }
  const calls = turn.calls ?? [];
  for (const [i, call] of calls.entries()) {
    await sleep(500);
    chunk({
      tool_calls: [
        {
          index: i,
          id: `call_rsi_${Date.now()}_${i}`,
          type: "function",
          function: { name: call.name, arguments: "" },
        },
      ],
    });
    const json = JSON.stringify(call.args);
    for (const part of json.match(/[\s\S]{1,200}/g) ?? []) {
      chunk({ tool_calls: [{ index: i, function: { arguments: part } }] });
      await sleep(120);
    }
  }
  const prompt = 9000 + (body.messages?.length ?? 0) * 900;
  chunk({}, calls.length ? "tool_calls" : "stop", {
    prompt_tokens: prompt,
    completion_tokens: 420,
    total_tokens: prompt + 420,
    prompt_cache_hit_tokens: Math.round(prompt * 0.85),
    prompt_cache_miss_tokens: prompt - Math.round(prompt * 0.85),
  });
  res.write("data: [DONE]\n\n");
  res.end();
}

function startMock() {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method !== "POST" || !req.url?.includes("chat/completions")) {
        console.log(`[mock] unexpected ${req.method} ${req.url}`);
        res.writeHead(404).end();
        return;
      }
      try {
        reply(res, JSON.parse(body || "{}")).catch((err) => {
          console.error("[mock] reply error:", err);
          res.end();
        });
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
// Server and API helpers.
// ---------------------------------------------------------------------------

const NO_PROXY_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^(https?|all|no)_proxy$/i.test(k)),
);

async function waitFor(url, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server not ready: ${url}`);
}

let cookie = null;
async function api(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${await res.text()}`);
  return { json: await res.json().catch(() => ({})), setCookie: res.headers.get("set-cookie") };
}

async function login(password) {
  cookie = null;
  const { setCookie } = await api("POST", "/api/auth/login", { userId: "admin", password });
  if (!setCookie) throw new Error("no session cookie from login");
  cookie = setCookie.split(";")[0];
}

/** One Project per language: the mock model, three agents, seeded scoreboards. */
async function provisionProject(lang) {
  const projectId = `rsi_${lang}`;
  await api("POST", "/api/projects", { projectId, name: PROJECT_NAME[lang] }).catch((e) => {
    if (!String(e).includes("409")) throw e;
  });
  await api("PUT", `/api/projects/${projectId}/models`, {
    defaultModel: MODEL,
    models: [
      {
        ...MODEL,
        clientType: "openai-chat",
        apiKey: "sk-demo",
        baseUrl: MOCK,
        contextWindow: 1000000,
        pricing: { cacheRead: 0.003571, cacheWrite: 0.428571, output: 0.857143 },
      },
    ],
  });
  for (const agent of AGENTS[lang]) {
    await api("POST", `/api/projects/${projectId}/agents`, agent).catch((e) => {
      if (!String(e).includes("409")) throw e;
    });
  }
  await api("DELETE", `/api/projects/${projectId}/benchmarks/example-benchmark`).catch(() => {});

  const app = path.join(HOME, projectId);
  const benchDir = (id) => path.join(app, "benchmarks", id);
  const casesOf = (id) =>
    readdirSync(benchDir(id))
      .filter((n) => n.startsWith("CASE-"))
      .sort();
  const trainCases = casesOf(TRAIN);
  const testCases = casesOf(TEST);
  if (trainCases.length !== 30 || testCases.length !== 30)
    throw new Error(`unexpected case counts ${trainCases.length}/${testCases.length}`);

  const vec = buildVectors();
  const seedOf = (key) => 1000 + key.charCodeAt(0) * 10 + Number(key.slice(1));
  const history = [...HISTORY].sort((x, y) => x.time.localeCompare(y.time));
  const train = history.map((h) =>
    evaluationRecord(h, vec[h.key], trainCases, lang, seedOf(h.key)),
  );
  const test = TEST_HISTORY.map((h) =>
    evaluationRecord(h, vec[h.key], testCases, lang, seedOf(h.key)),
  );
  const cand = evaluationRecord(V3, vec.a3, trainCases, lang, seedOf("a3"));
  writeFileSync(
    path.join(benchDir(TRAIN), "scoreboard.yaml"),
    "evaluations:\n" + train.map(evaluationYaml).join(""),
  );
  writeFileSync(
    path.join(benchDir(TEST), "scoreboard.yaml"),
    "evaluations:\n" + test.map(evaluationYaml).join(""),
  );

  // The tested agents' state: their version and thinking level match their latest evaluation.
  const setState = (agentId, version, thinking, agentsMd) => {
    const dir = path.join(app, "agents", agentId, "agent_state");
    const cfgPath = path.join(dir, "system_config.yaml");
    let cfg = readFileSync(cfgPath, "utf8");
    cfg = /^version:/m.test(cfg)
      ? cfg.replace(/^version:.*$/m, `version: ${version}`)
      : `version: ${version}\n${cfg}`;
    cfg = /^\s+thinking_level:/m.test(cfg)
      ? cfg.replace(/^(\s+thinking_level:).*$/m, `$1 ${thinking}`)
      : cfg;
    writeFileSync(cfgPath, cfg);
    if (agentsMd) writeFileSync(path.join(dir, "AGENTS.md"), agentsMd);
  };
  setState("biz_analyst", 2, "high", AGENTS_MD[lang]);
  setState("backoffice", 2, "medium");
  setState("claims_analyst", 4, "high");

  STATE[lang] = {
    projectId,
    app,
    caseIds: trainCases,
    base: train.find((e) => e.agent_id === TESTED && e.version === 1),
    ref: train.find((e) => e.agent_id === TESTED && e.version === 2),
    cand,
    train,
    test,
  };
  console.log(
    `[rsi] ${lang}: train ${train.map((e) => `${e.agent_id}@v${e.version}=${e.score}`).join(", ")}; v3=${cand.score}; test ${test.map((e) => e.score).join(" → ")}`,
  );
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
if (!process.env.SHOT_KEEP) {
  // A fresh data root and auth database: the seeded admin password only applies to a new one.
  rmSync(HOME, { recursive: true, force: true });
  for (const f of ["web.db", "web.db-wal", "web.db-shm"])
    rmSync(path.join(DATA, f), { force: true });
}
mkdirSync(HOME, { recursive: true });

const mock = await startMock();
console.log(`[rsi] mock LLM on ${MOCK}`);
const srv = spawn("node", [path.join(ROOT, "packages/server/dist/index.js")], {
  env: {
    ...NO_PROXY_ENV,
    PENGUIN_HOME: HOME,
    PENGUIN_WEB_DB: path.join(DATA, "web.db"),
    PENGUIN_WEB_DIST: path.join(ROOT, "packages/web/dist"),
    PORT: String(SRV_PORT),
    HOST: "127.0.0.1",
    PENGUIN_SEED_ADMIN_PASSWORD: SEED_PASSWORD,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
srv.stdout.on("data", (d) => process.stdout.write(`[srv] ${d}`));
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

const STR = {
  en: {
    send: "Send",
    use: "Use",
    optimize: "Optimize",
    method: "Method",
    roundLimit: "Round limit",
    testedAgent: "Tested agent",
    text3: "Candidate v3 is in place",
    editInChat: "Edit in a new conversation",
    evolveFolder: "Evaluate and optimize agents",
    counts: ["Agents", "RSI algorithms", "Benchmarks"],
    rsiGroup: "Agent Self-Evolution",
    trend: "Score over time",
    evaluations: "Evaluations",
    evalCenter: "Evaluation Center",
    gdpevoTrain: "PenguinHarness Benchmark GDPevo Train",
  },
  zh: {
    send: "发送",
    use: "使用",
    optimize: "优化",
    method: "方法",
    roundLimit: "最多轮数",
    testedAgent: "被测智能体",
    text3: "候选 v3 已就位",
    editInChat: "在新对话中编辑",
    evolveFolder: "评测与优化智能体",
    counts: ["智能体", "自进化算法", "评估集"],
    rsiGroup: "Agent 自进化",
    trend: "分数随时间变化",
    evaluations: "评估明细",
    evalCenter: "评估中心",
    gdpevoTrain: "PenguinHarness Benchmark GDPevo Train",
  },
};

let browser;
const ONLY = process.env.SHOT_ONLY ? new Set(process.env.SHOT_ONLY.split(",")) : null;
const want = (name) => !ONLY || ONLY.has(name);

async function dump(page, tag) {
  try {
    writeFileSync(path.join(OUT_DIR, `fail-${tag}.png`), await page.screenshot());
    writeFileSync(
      path.join(OUT_DIR, `fail-${tag}.txt`),
      await page.evaluate(() => document.body.innerText),
    );
  } catch {}
}

async function openPage(lang, url, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    locale: lang === "zh" ? "zh-CN" : "en-US",
    timezoneId: "Europe/Berlin",
  });
  await context.addInitScript(
    ([l, p]) => {
      try {
        localStorage.setItem("penguin.theme", "light");
        localStorage.setItem("penguin.themeId", "modern");
        localStorage.setItem("penguin.lang", l);
        localStorage.setItem("penguin.lastProjectId", p);
      } catch {}
    },
    [lang, `rsi_${lang}`],
  );
  if (SHOW_VERSION) {
    await context.route(
      (u) => u.pathname === "/api/version" || u.pathname === "/api/plugins",
      async (route) => {
        const res = await route.fetch();
        const body = (await res.text()).replaceAll(
          '"version":"0.2.13"',
          `"version":"${SHOW_VERSION}"`,
        );
        await route.fulfill({ response: res, body });
      },
    );
  }
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  const res = await page.request.post(`${BASE}/api/auth/login`, {
    data: { userId: "admin", password: ADMIN_PASSWORD },
  });
  if (!res.ok()) throw new Error(`browser login failed: ${res.status()}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return { context, page };
}

/** Screenshot clipped to the union of the given element boxes, padded. */
async function shootUnion(page, locators, file, pad = 16) {
  const boxes = [];
  for (const l of locators) {
    const b = await l.boundingBox();
    if (b) boxes.push(b);
  }
  if (boxes.length === 0) throw new Error(`nothing to clip for ${file}`);
  const vp = page.viewportSize();
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const x1 = Math.min(vp.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
  const y1 = Math.min(vp.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
  await page.screenshot({
    path: path.join(OUT_DIR, file),
    clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
  });
  console.log(`[rsi] ${file}`);
}

async function shootPage(page, file) {
  await page.screenshot({ path: path.join(OUT_DIR, file) });
  console.log(`[rsi] ${file}`);
}

try {
  await waitFor(`${BASE}/`);
  console.log(`[rsi] server ready on ${BASE}`);
  await login(SEED_PASSWORD);
  await api("PUT", "/api/me/password", {
    oldPassword: SEED_PASSWORD,
    newPassword: ADMIN_PASSWORD,
  }).catch((e) => console.log(`[rsi] password rotate: ${e}`));
  await login(ADMIN_PASSWORD);

  for (const lang of LANGS) await provisionProject(lang);

  browser = await chromium.launch({
    env: {
      ...NO_PROXY_ENV,
      FONTCONFIG_FILE: path.join(ROOT, "packages/ui-gallery/scripts/fonts.conf"),
      LANG: "en_US.UTF-8",
    },
    args: ["--no-proxy-server"],
  });

  for (const lang of LANGS) {
    const t = STR[lang];

    // ---- Use dialog: Method select open (before the round, so the Reference is v2) ----------
    if (want("method") || want("chat")) {
      const { context, page } = await openPage(lang, `${BASE}/benchmark/${TRAIN}`, {
        width: 1440,
        height: 1000,
      });
      try {
        await page
          .getByRole("button", { name: t.use, exact: true })
          .first()
          .click({ timeout: 30000 });
        const dialog = page.getByRole("dialog").last();
        await dialog.waitFor({ timeout: 15000 });
        await dialog.getByText(t.optimize, { exact: true }).first().click();
        const trigger = dialog.locator('button[aria-haspopup="listbox"]').first();
        // The Method select is the first select of the tab; it is enabled once the library is read.
        await page.waitForFunction(
          () =>
            [...document.querySelectorAll('[role="dialog"] button[aria-haspopup="listbox"]')].some(
              (b) => !b.disabled && /rsi-toolkit/.test(b.textContent ?? ""),
            ),
          null,
          { timeout: 30000 },
        );
        // The agent under test: the newest evaluation is another agent's, so pick it.
        await dialog
          .getByText(t.testedAgent, { exact: true })
          .first()
          .locator('xpath=following::button[@aria-haspopup="listbox"][1]')
          .click();
        await page.getByRole("option", { name: AGENTS[lang][0].name }).first().click();
        await page.waitForTimeout(500);
        if (want("method")) {
          await trigger.click();
          const listbox = page.getByRole("listbox");
          await listbox.waitFor({ timeout: 10000 });
          await page.waitForTimeout(600);
          // The dialog from its title down to just under the open list.
          const d = await dialog.boundingBox();
          const l = await listbox.boundingBox();
          await page.screenshot({
            path: path.join(OUT_DIR, `rsi-toolkits-method-${lang}.png`),
            clip: { x: d.x, y: d.y, width: d.width, height: l.y + l.height + 28 - d.y },
          });
          console.log(`[rsi] rsi-toolkits-method-${lang}.png`);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(300);
        }
        if (want("chat")) {
          // One round: the conversation shows one Candidate end to end.
          const rounds = dialog.getByLabel(t.roundLimit);
          await rounds.fill("1");
          await dialog.getByRole("button", { name: t.editInChat }).click();
          await page.waitForURL(/\/chat\/new/, { timeout: 15000 });
          const send = page.getByRole("button", { name: t.send, exact: true });
          await send.waitFor({ timeout: 20000 });
          await page.waitForTimeout(1500);
          await send.click();
          await page.waitForURL(/\/chat\/(?!new)[^/]+$/, { timeout: 30000 });
          // The round ends with the table's total row.
          await page
            .getByText(lang === "zh" ? "保留 v3。" : "Kept v3.")
            .first()
            .waitFor({ timeout: 600000 });
          await page.waitForTimeout(3000);
          const chatUrl = page.url();
          await context.close();
          // Reopen: a fresh load renders the finished Trace as a reader returning to it sees it.
          writeFileSync(path.join(OUT_DIR, `chat-url-${lang}.txt`), chatUrl);
          const again = await openPage(lang, chatUrl, { width: 1440, height: 1300 });
          try {
            const p = again.page;
            await p
              .getByText(lang === "zh" ? "保留 v3。" : "Kept v3.")
              .first()
              .waitFor({ timeout: 30000 });
            await p.waitForTimeout(2000);
            // Open the group that changes the agent (snapshot, Skill, AGENTS.md, version).
            await p
              .getByText(lang === "zh" ? "4 步" : "4 steps", { exact: true })
              .first()
              .click();
            await p.waitForTimeout(1500);
            await p.evaluate(() => document.activeElement?.blur?.());
            await p.mouse.move(1000, 600);
            await p.mouse.wheel(0, 6000);
            await p.waitForTimeout(1500);
            await shootPage(p, `rsi-toolkits-optimize-chat-${lang}.png`);
            // The evaluation group open: one run_subagent row per cell, from its lead-in line.
            await p
              .getByText(lang === "zh" ? "30 步" : "30 steps", { exact: true })
              .first()
              .click();
            await p.waitForTimeout(1500);
            const lead = p.getByText(t.text3).first();
            await lead.evaluate((el) => el.scrollIntoView({ block: "start" }));
            await p.mouse.move(1000, 600);
            await p.mouse.wheel(0, -140);
            await p.evaluate(() => document.activeElement?.blur?.());
            await p.waitForTimeout(1200);
            await shootUnion(
              p,
              [lead, p.getByText(/CASE-007/).first()],
              `rsi-toolkits-optimize-cells-${lang}.png`,
              24,
            );
          } catch (err) {
            await dump(again.page, `chat-${lang}`);
            throw err;
          } finally {
            await again.context.close();
          }
        }
      } catch (err) {
        await dump(page, `method-${lang}`);
        throw err;
      } finally {
        await context.close().catch(() => {});
      }
    }

    // ---- Start page ---------------------------------------------------------------------------
    if (want("start")) {
      const { context, page } = await openPage(lang, `${BASE}/chat/new`);
      try {
        await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 30000 });
        await page.getByText(t.evolveFolder, { exact: true }).first().click();
        // Every count has arrived (none reads "—").
        await page.waitForFunction(
          (labels) =>
            labels.every((label) =>
              [...document.querySelectorAll("a")].some(
                (a) => a.innerText.includes(label) && /\d/.test(a.innerText),
              ),
            ),
          t.counts,
          { timeout: 30000 },
        );
        await page.waitForTimeout(1500);
        await shootPage(page, `penguinharness-0-2-14-start-page-${lang}.png`);
      } catch (err) {
        await dump(page, `start-${lang}`);
        throw err;
      } finally {
        await context.close();
      }
    }

    // ---- Plugin market: the RSI category ------------------------------------------------------
    if (want("plugins")) {
      const { context, page } = await openPage(lang, `${BASE}/plugins`, {
        width: 1440,
        height: 1400,
      });
      try {
        const title = page.getByText(t.rsiGroup, { exact: true }).first();
        await title.waitFor({ timeout: 30000 });
        await page.getByText("ace-rsi-toolkit").first().waitFor({ timeout: 30000 });
        await page.waitForTimeout(1500);
        // The category's section: the nearest ancestor of its title that holds all five cards.
        const section = title.locator(
          "xpath=ancestor::*[count(.//*[contains(text(),'rsi-toolkit')]) >= 5][1]",
        );
        await shootUnion(page, [section], `penguinharness-0-2-14-rsi-plugins-${lang}.png`, 12);
      } catch (err) {
        await dump(page, `plugins-${lang}`);
        throw err;
      } finally {
        await context.close();
      }
    }

    // ---- Evaluation Center list ---------------------------------------------------------------
    if (want("benchmarks")) {
      const { context, page } = await openPage(lang, `${BASE}/benchmark`, {
        width: 1440,
        height: 1700,
      });
      try {
        await page.getByText("PenguinHarness Benchmark Sec E").first().waitFor({ timeout: 30000 });
        await page.waitForTimeout(1500);
        // From the page title down to the bottom of the last card.
        const box = await page.evaluate(() => {
          const title = [...document.querySelectorAll("h1, h2")].find((h) => h.offsetParent);
          const last = [...document.querySelectorAll("*")].find(
            (el) =>
              el.childElementCount === 0 && el.textContent === "PenguinHarness Benchmark Sec E",
          );
          let card = last;
          while (card && card.parentElement && card.parentElement.childElementCount < 7)
            card = card.parentElement;
          const t = title.getBoundingClientRect();
          const c = card.getBoundingClientRect();
          const frame = card.parentElement.getBoundingClientRect();
          return { x: frame.x, y: t.y, width: frame.width, bottom: c.bottom };
        });
        await page.screenshot({
          path: path.join(OUT_DIR, `penguinharness-0-2-14-benchmarks-${lang}.png`),
          clip: {
            x: box.x - 24,
            y: box.y - 24,
            width: box.width + 48,
            height: box.bottom - box.y + 48,
          },
        });
        console.log(`[rsi] penguinharness-0-2-14-benchmarks-${lang}.png`);
      } catch (err) {
        await dump(page, `benchmarks-${lang}`);
        throw err;
      } finally {
        await context.close();
      }
    }

    // ---- Benchmark page: chart and evaluations --------------------------------------------------
    if (want("detail")) {
      const { context, page } = await openPage(lang, `${BASE}/benchmark/${TRAIN}`, {
        width: 1440,
        height: 1800,
      });
      try {
        const trend = page.getByText(t.trend, { exact: true }).first();
        await trend.waitFor({ timeout: 30000 });
        await page.waitForTimeout(1500);
        const table = page.locator("table").last();
        await shootUnion(
          page,
          [trend.locator("xpath=.."), table],
          `penguinharness-0-2-14-benchmark-detail-${lang}.png`,
          20,
        );
        // The newest evaluation's dialog: every case of v3 with its run.
        if (want("evaluation")) {
          await table.locator("tbody tr").first().click();
          const dialog = page.getByRole("dialog").last();
          await dialog.waitFor({ timeout: 15000 });
          await page.waitForTimeout(1200);
          // The first case open, to show its run and the Harbor trial it was recorded as.
          await dialog.locator("tbody tr").first().click();
          await page.waitForTimeout(800);
          const d = await dialog.boundingBox();
          await page.screenshot({
            path: path.join(OUT_DIR, `rsi-toolkits-evaluation-${lang}.png`),
            clip: { x: d.x, y: d.y, width: d.width, height: Math.min(d.height, 820) },
          });
          console.log(`[rsi] rsi-toolkits-evaluation-${lang}.png`);
        }
      } catch (err) {
        await dump(page, `detail-${lang}`);
        throw err;
      } finally {
        await context.close();
      }
    }
  }

  await browser.close();
  console.log(`[rsi] done -> ${OUT_DIR}`);
  process.exit(0);
} catch (err) {
  console.error("[rsi] FAILED:", err);
  process.exit(1);
}

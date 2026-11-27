/**
 * The Storage page's demo (`/api/me/storage*`): what the demo's data root holds, the cleanup
 * review, and the conversations by size — built once per demo store, on first use, and kept
 * beside it.
 *
 * The demo account is an admin: the usage carries the whole data root, with the demo Project and
 * two more of the admin's, and two Projects of other users as one sum. A refresh measures for a
 * few seconds (the page polls until it ends). A cleanup removes the items it names from the
 * review and their bytes from the usage, then measures again. The conversation list is the demo
 * store's own conversations — so a deleted one is gone from it — beside a dozen in the other two
 * Projects, which the batch delete forgets the same way.
 */
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import type {
  StorageAgentUsage,
  StorageBytes,
  StorageCategory,
  StorageCleanupItem,
  StorageCleanupKind,
  StorageCleanupResult,
  StorageCleanupReview,
  StorageProjectUsage,
  StorageSessionRow,
  StorageSessionsResponse,
  StorageUsage,
} from "@penguinharness/storage/types";
import type { DemoStore } from "./store";

const MB = 1024 ** 2;
const GB = 1024 ** 3;
const DAY = 86_400_000;

/** How long a demo measurement runs. */
const MEASURE_MS = 2500;

/** The most conversations one list answer holds, as the route caps it. */
const LIST_MAX = 500;

const ZERO: StorageBytes = {
  traces: 0,
  agentState: 0,
  workspaces: 0,
  scratchpads: 0,
  caches: 0,
  logs: 0,
  plugins: 0,
  other: 0,
};

const bytesOf = (part: Partial<StorageBytes>): StorageBytes => ({ ...ZERO, ...part });

const add = (a: StorageBytes, b: StorageBytes): StorageBytes => {
  const out = { ...a };
  for (const key of Object.keys(out) as StorageCategory[]) out[key] += b[key];
  return out;
};

const total = (b: StorageBytes) => Object.values(b).reduce((n, v) => n + v, 0);

/** One Agent's share, as the demo holds it: by category, before the sums. */
interface DemoAgent {
  agentId: string;
  name: string;
  bytes: StorageBytes;
}

interface DemoProject {
  projectId: string;
  name: string;
  path: string;
  /** What the Project holds outside its Agents (its config). */
  own: StorageBytes;
  agents: DemoAgent[];
}

interface StorageDemo {
  projects: DemoProject[];
  /** The data root's own top-level entries. */
  server: { name: string; category: StorageCategory; bytes: number }[];
  others: { count: number; bytes: StorageBytes };
  measuredAt: number;
  /** A measurement runs until then (0: none). */
  measuringUntil: number;
  items: StorageCleanupItem[];
  /** The conversations of the two extra Projects: not in the demo store, listed here alone. */
  extra: StorageSessionRow[];
}

const demos = new WeakMap<DemoStore, StorageDemo>();

/** A stable size for a conversation the demo store holds, from its id. */
function sizeOf(sessionId: string, scale: number): number {
  let h = 0;
  for (const ch of sessionId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Math.round(((h % 997) / 997) * scale + scale / 20);
}

function build(store: DemoStore): StorageDemo {
  const now = store.f.now;
  const zh = store.lang === "zh";
  const L = (a: string, b: string) => (zh ? a : b);
  const root = "/home/demo/.penguin/data";
  const agentName = (id: string) => store.f.agents.find((a) => a.agentId === id)?.name ?? id;
  const demoProject = store.f.project;
  const projects: DemoProject[] = [
    {
      projectId: demoProject.projectId,
      name: demoProject.name ?? demoProject.projectId,
      path: `${root}/projects/${demoProject.projectId}`,
      own: bytesOf({ other: 38 * MB }),
      agents: [
        {
          agentId: "docs-expert",
          name: agentName("docs-expert"),
          bytes: bytesOf({
            traces: 1.24 * GB,
            agentState: 186 * MB,
            workspaces: 642 * MB,
            scratchpads: 231 * MB,
            caches: 868 * MB,
            other: 4 * MB,
          }),
        },
        {
          agentId: "release-notes",
          name: agentName("release-notes"),
          bytes: bytesOf({ traces: 318 * MB, agentState: 41 * MB, scratchpads: 36 * MB }),
        },
        {
          agentId: "default_agent",
          name: agentName("default_agent"),
          bytes: bytesOf({
            traces: 97 * MB,
            agentState: 22 * MB,
            scratchpads: 3 * MB,
            caches: 640 * MB,
          }),
        },
      ],
    },
    {
      projectId: "research-lab",
      name: L("研究实验室", "Research lab"),
      path: `${root}/projects/research-lab`,
      own: bytesOf({ other: 12 * MB }),
      agents: [
        {
          agentId: "analyst",
          name: L("数据分析师", "Analyst"),
          bytes: bytesOf({
            traces: 826 * MB,
            scratchpads: 412 * MB,
            caches: 1.38 * GB,
            workspaces: 118 * MB,
            agentState: 64 * MB,
          }),
        },
        {
          agentId: "reader",
          name: L("文献阅读", "Paper reader"),
          bytes: bytesOf({ traces: 142 * MB, agentState: 18 * MB, scratchpads: 9 * MB }),
        },
      ],
    },
    {
      projectId: "website",
      name: L("官网", "Website"),
      path: `${root}/projects/website`,
      own: bytesOf({ other: 3 * MB }),
      agents: [
        {
          agentId: "builder",
          name: L("前端工程师", "Front-end builder"),
          bytes: bytesOf({
            traces: 264 * MB,
            workspaces: 905 * MB,
            caches: 377 * MB,
            agentState: 31 * MB,
          }),
        },
      ],
    },
  ];

  const ago = (days: number, hours = 0) =>
    new Date(now - days * DAY - hours * 3_600_000).toISOString();
  const item = (
    id: string,
    kind: StorageCleanupKind,
    reason: StorageCleanupItem["reason"],
    name: string,
    bytes: number,
    days: number,
    selected: boolean,
    where?: { projectId: string; agentId: string },
    extra: Partial<StorageCleanupItem> = {},
  ): StorageCleanupItem => {
    const project = projects.find((p) => p.projectId === where?.projectId);
    const agent = project?.agents.find((a) => a.agentId === where?.agentId);
    return {
      id,
      kind,
      reason,
      ...(project !== undefined ? { projectId: project.projectId, projectName: project.name } : {}),
      ...(agent !== undefined ? { agentId: agent.agentId, agentName: agent.name } : {}),
      name,
      bytes,
      lastModifiedAt: ago(days, 3),
      selected,
      ...extra,
    };
  };
  const docs = { projectId: demoProject.projectId, agentId: "docs-expert" };
  const notes = { projectId: demoProject.projectId, agentId: "release-notes" };
  const general = { projectId: demoProject.projectId, agentId: "default_agent" };
  const analyst = { projectId: "research-lab", agentId: "analyst" };
  const builder = { projectId: "website", agentId: "builder" };
  const idle = (
    id: string,
    title: string | null,
    bytes: number,
    days: number,
    where: typeof docs,
  ) =>
    item(id, "scratchpad", "idle", `s-${id}`, bytes, days, false, where, {
      sessionId: `s-${id}`,
      title,
      lastActiveAt: ago(days),
    });
  const items: StorageCleanupItem[] = [
    item("o-1", "scratchpad", "orphan", "s-4e1f9c20b7d3", 186 * MB, 12, true, docs),
    item("o-2", "scratchpad", "orphan", "s-9a07c3e51f62", 64 * MB, 31, true, analyst),
    item("o-3", "scratchpad", "orphan", "s-c23b81d04a9e", 7.4 * MB, 5, true, notes),
    idle("i-1", L("整理季度报告的图表", "Charts for the quarterly report"), 312 * MB, 41, analyst),
    idle("i-2", L("竞品官网的截图对比", "Competitor site screenshots"), 96 * MB, 23, builder),
    idle("i-3", null, 18 * MB, 14, docs),
    idle("i-4", L("发布说明 0.2.12 草稿", "Release notes 0.2.12 draft"), 4.2 * MB, 9, notes),
    item("w-1", "workspace", "orphan", "tmp-3f9c2a", 420 * MB, 6, true, builder),
    item("w-2", "workspace", "orphan", "eval-hooks-b71e", 58 * MB, 18, true, docs),
    item("c-1", "agentCache", "idle", "python-3.12", 812 * MB, 2, false, analyst),
    item("c-2", "agentCache", "idle", "node-22", 377 * MB, 4, false, builder),
    item("c-3", "agentCache", "idle", "playwright", 568 * MB, 11, false, docs),
    // The Self-Evolution Workbench's Harbor checkouts, in its own cache folder on the default Agent.
    item("c-4", "agentCache", "idle", "benchmark", 640 * MB, 3, false, general),
    item("sc-2", "serverCache", "idle", "model-catalog", 22 * MB, 1, true),
  ];

  const extraTitles = zh
    ? [
        "清洗 2025 年的销售数据",
        "复现论文里的消融实验",
        null,
        "批量下载 arXiv 摘要",
        "首页改版的配色方案",
        "移动端导航栏的适配",
        "生成产品对比表",
        "整理用户访谈记录",
        "修复 404 页面",
        null,
        "博客文章的配图",
        "统计各渠道的转化率",
      ]
    : [
        "Clean the 2025 sales data",
        "Reproduce the paper's ablation",
        null,
        "Fetch arXiv abstracts in bulk",
        "Colour scheme for the new home page",
        "Mobile navigation bar",
        "Build the product comparison table",
        "Sort the user interview notes",
        "Fix the 404 page",
        null,
        "Images for the blog post",
        "Conversion rate by channel",
      ];
  const extraOwners = [analyst, analyst, analyst, { projectId: "research-lab", agentId: "reader" }];
  const extra: StorageSessionRow[] = extraTitles.map((title, i) => {
    const where = i < 4 ? extraOwners[i]! : builder;
    const project = projects.find((p) => p.projectId === where.projectId)!;
    const agent = project.agents.find((a) => a.agentId === where.agentId)!;
    const days = [3, 38, 61, 45, 2, 33, 72, 90, 1, 120, 52, 8][i]!;
    return {
      sessionId: `s-x${i + 1}`,
      projectId: project.projectId,
      projectName: project.name,
      agentId: agent.agentId,
      agentName: agent.name,
      title,
      createdAt: ago(days + 2),
      lastActiveAt: ago(days),
      archived: days > 30,
      running: false,
      traceBytes: sizeOf(`s-x${i + 1}`, 180 * MB),
      ...(i % 3 === 0 ? {} : { scratchpadBytes: sizeOf(`p-x${i + 1}`, 90 * MB) }),
    };
  });

  return {
    projects,
    server: [
      { name: ".cache", category: "caches", bytes: 22 * MB },
      { name: "plugins", category: "plugins", bytes: 214 * MB },
      { name: "web.db", category: "other", bytes: 64 * MB },
      { name: "logs", category: "logs", bytes: 48 * MB },
      { name: "hmr", category: "other", bytes: 31 * MB },
      { name: "themes", category: "other", bytes: 1.2 * MB },
      { name: "machines", category: "other", bytes: 0.4 * MB },
    ],
    others: {
      count: 2,
      bytes: bytesOf({ traces: 1.46 * GB, caches: 820 * MB, agentState: 96 * MB }),
    },
    measuredAt: now - 3 * 60_000,
    measuringUntil: 0,
    items,
    extra,
  };
}

function demoOf(store: DemoStore): StorageDemo {
  let demo = demos.get(store);
  if (demo === undefined) {
    demo = build(store);
    demos.set(store, demo);
  }
  return demo;
}

/** Ends a measurement whose time is up: the numbers it took are now the measured ones. */
function settle(demo: StorageDemo): void {
  if (demo.measuringUntil !== 0 && Date.now() >= demo.measuringUntil) {
    demo.measuredAt = demo.measuringUntil;
    demo.measuringUntil = 0;
  }
}

function agentUsage(agent: DemoAgent): StorageAgentUsage {
  return {
    agentId: agent.agentId,
    name: agent.name,
    bytes: total(agent.bytes),
    categories: agent.bytes,
  };
}

function projectUsage(project: DemoProject): StorageProjectUsage {
  const categories = project.agents.reduce((sum, a) => add(sum, a.bytes), project.own);
  return {
    projectId: project.projectId,
    name: project.name,
    path: project.path,
    bytes: total(categories),
    categories,
    agents: project.agents.map(agentUsage).sort((a, b) => b.bytes - a.bytes),
  };
}

/** GET /api/me/storage. */
export function storageUsage(store: DemoStore): StorageUsage {
  const demo = demoOf(store);
  settle(demo);
  const projects = demo.projects.map(projectUsage).sort((a, b) => b.bytes - a.bytes);
  const mine = projects.reduce((sum, p) => add(sum, p.categories), ZERO);
  const serverOwn = { ...ZERO };
  for (const entry of demo.server) serverOwn[entry.category] += entry.bytes;
  const all = add(add(mine, demo.others.bytes), serverOwn);
  return {
    measuredAt: new Date(demo.measuredAt).toISOString(),
    measuring: demo.measuringUntil !== 0,
    bytes: total(mine),
    categories: mine,
    projects,
    // The demo is not the desktop shell: there is no file manager to show a folder in.
    reveal: false,
    server: {
      root: "/home/demo/.penguin/data",
      bytes: total(all),
      categories: all,
      otherProjects: { count: demo.others.count, bytes: total(demo.others.bytes) },
      entries: [...demo.server].sort((a, b) => b.bytes - a.bytes),
    },
  };
}

/** POST /api/me/storage/refresh: a measurement starts (one under way is reused). */
export function refreshStorage(store: DemoStore): StorageUsage {
  const demo = demoOf(store);
  settle(demo);
  if (demo.measuringUntil === 0) demo.measuringUntil = Date.now() + MEASURE_MS;
  return storageUsage(store);
}

/** An item's idle age, in days, by the demo clock. */
const ageOf = (store: DemoStore, item: StorageCleanupItem) =>
  (store.f.now - Date.parse(item.lastActiveAt ?? item.lastModifiedAt ?? "")) / DAY;

/** GET /api/me/storage/cleanup: an idle scratchpad shows once it is older than the age asked. */
export function cleanupReview(store: DemoStore, olderThanDays: number): StorageCleanupReview {
  const demo = demoOf(store);
  return {
    measuredAt: new Date(demo.measuredAt).toISOString(),
    olderThanDays,
    items: demo.items.filter(
      (item) =>
        item.kind !== "scratchpad" || item.reason !== "idle" || ageOf(store, item) > olderThanDays,
    ),
  };
}

/** What a removed item took from the usage: its category in its Agent, or the server's cache. */
const CATEGORY_OF: Record<StorageCleanupKind, StorageCategory> = {
  scratchpad: "scratchpads",
  workspace: "workspaces",
  agentCache: "caches",
  serverCache: "caches",
};

/** POST /api/me/storage/cleanup. */
export function runCleanup(store: DemoStore, ids: readonly string[]): StorageCleanupResult {
  const demo = demoOf(store);
  const result: StorageCleanupResult = { removed: 0, bytes: 0, skipped: [] };
  for (const id of ids) {
    const item = demo.items.find((i) => i.id === id);
    if (item === undefined) {
      result.skipped.push({ id, reason: "gone" });
      continue;
    }
    demo.items = demo.items.filter((i) => i !== item);
    result.removed += 1;
    result.bytes += item.bytes;
    const category = CATEGORY_OF[item.kind];
    if (item.kind === "serverCache") {
      const cache = demo.server.find((entry) => entry.name === ".cache");
      if (cache !== undefined) cache.bytes = Math.max(0, cache.bytes - item.bytes);
      continue;
    }
    const agent = demo.projects
      .find((p) => p.projectId === item.projectId)
      ?.agents.find((a) => a.agentId === item.agentId);
    if (agent !== undefined) {
      const next = { ...agent.bytes };
      next[category] = Math.max(0, next[category] - item.bytes);
      agent.bytes = next;
    }
  }
  // What the cleanup touched is measured again.
  if (result.removed > 0 && demo.measuringUntil === 0) {
    demo.measuringUntil = Date.now() + MEASURE_MS;
  }
  return result;
}

/** A demo store conversation as the list holds it, or null when the listing rule leaves it out. */
function rowOf(store: DemoStore, demo: StorageDemo, s: SessionInfo): StorageSessionRow | null {
  if (
    s.source === "company" ||
    s.source === "subagent" ||
    (s.orgId ?? "") !== "" ||
    s.client === "org"
  ) {
    return null;
  }
  const project = demo.projects.find((p) => p.projectId === s.projectId);
  const agent = store.f.agents.find((a) => a.agentId === s.agentId);
  return {
    sessionId: s.sessionId,
    projectId: s.projectId,
    projectName: project?.name ?? s.projectId,
    agentId: s.agentId,
    agentName: agent?.name ?? s.agentId,
    title: s.title ?? null,
    createdAt: s.createdAt,
    lastActiveAt: s.lastActiveAt,
    archived: s.archived === true,
    running: s.status !== "idle",
    traceBytes: sizeOf(s.sessionId, 140 * MB),
    ...(s.hasTrace ? { scratchpadBytes: sizeOf(`p-${s.sessionId}`, 60 * MB) } : {}),
  };
}

/** GET /api/me/storage/sessions. */
export function storageSessions(store: DemoStore, query: URLSearchParams): StorageSessionsResponse {
  const demo = demoOf(store);
  const projectId = query.get("projectId");
  const agentId = query.get("agentId");
  const listing = query.get("listing") ?? "all";
  const days = Number(query.get("olderThanDays"));
  const before = Number.isFinite(days) && days > 0 ? store.f.now - days * DAY : null;
  const rows = [
    ...store.f.sessions.flatMap((s) => rowOf(store, demo, s) ?? []),
    ...demo.extra,
  ].filter(
    (row) =>
      (projectId === null || row.projectId === projectId) &&
      (agentId === null || row.agentId === agentId) &&
      (listing === "all" || (listing === "archived") === row.archived) &&
      (before === null || Date.parse(row.lastActiveAt) < before),
  );
  const size = (row: StorageSessionRow) => row.traceBytes + (row.scratchpadBytes ?? 0);
  rows.sort((a, b) =>
    query.get("sort") === "age"
      ? Date.parse(a.lastActiveAt) - Date.parse(b.lastActiveAt)
      : size(b) - size(a),
  );
  return {
    sessions: rows.slice(0, LIST_MAX),
    total: rows.length,
    totalBytes: rows.reduce((n, row) => n + size(row), 0),
    truncated: rows.length > LIST_MAX,
  };
}

/** The batch delete reached a conversation of the extra Projects: the list forgets it. */
export function forgetStorageSession(store: DemoStore, sessionId: string): boolean {
  const demo = demoOf(store);
  const before = demo.extra.length;
  demo.extra = demo.extra.filter((row) => row.sessionId !== sessionId);
  return demo.extra.length < before;
}

/**
 * The Storage page's routes (`/api/me/storage*`), which the storage plugin's server module
 * contributes: the data root measured by category, the review-then-delete cleanup, and the
 * Sessions by size and age. The App boots with the plugin loaded from its sources (./plugin.ts).
 *
 * The admin's own Project is `default_project` (Agent `default_agent`); a member is a user with
 * their own `<name>-default_project`, which the admin cannot open.
 *
 * - Given files of known sizes in each place an Agent and the data root keep them, the admin's
 *   figures grow by exactly those bytes in each category — server-wide, in the Project and in the
 *   Agent — and a member's figures hold their own Project only, with no server part.
 * - Given an orphan scratchpad, an orphan temporary Workspace and a server cache entry left alone
 *   for over a day, the review offers each one ticked, and removing them takes them off the disk
 *   and out of the next figures. An orphan written into today is not offered yet. The local API
 *   token an Agent's shell holds reads the review but its removal is 403 `human_required`.
 * - Given a running Session, its scratchpad and its Agent's tool environment are never offered
 *   while it runs, and a removal naming them leaves them in place; the environment is offered
 *   once the run ends. A long-idle Session's scratchpad is offered, unticked.
 * - Given a temporary Workspace a Session still has — itself, or a folder inside it — it is never
 *   offered, and a removal naming it leaves it in place.
 * - Given a member, the review never offers another Project's folder or a server cache, and a
 *   removal naming another Project's folder leaves it in place; the admin's review offers both.
 * - Given Sessions with Traces of different sizes, the list orders them by size or by age and
 *   filters by archive state, age and Agent, marking a running one; deleting chosen ones through
 *   the archive page's batch removes their Trace files and scratchpads, and they leave the list.
 * - Given a malformed request, the answer is a 400 (an unknown Project a 404).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  benchmarksDir,
  requestBegin,
  scratchpadDir,
  sessionMeta,
  sharedEnvDir,
  snapshotsDir,
  tracesDir,
  userText,
  workspacesDir,
} from "@prismshadow/penguin-core";
import type {
  StorageCleanupResult,
  StorageCleanupReview,
  StorageSessionsResponse,
  StorageUsage,
} from "./plugin.js";
import {
  apiClient,
  createTestApp,
  loginAdmin,
  provisionUser,
  tokenClient,
  waitFor,
  writeTraceFile,
} from "../helpers.js";
import type { TestApp } from "../helpers.js";
import { fakeSession } from "../fixtures/session.js";
import { deletingDir } from "../../src/services/agent-service.js";
import { storagePlugin } from "./plugin.js";

const P = "default_project";
const A = "default_agent";
const DAY_MS = 24 * 60 * 60 * 1000;
const TRACE_DAY = "2026-11-01";

describe("the Storage page", () => {
  let t: TestApp;
  let seq = 0;

  beforeEach(async () => {
    t = await createTestApp({ plugins: storagePlugin() });
  });
  afterEach(async () => {
    await t.cleanup();
  });

  type Client = ReturnType<typeof apiClient>;
  const json = async <T>(pending: Response | Promise<Response>, status = 200): Promise<T> => {
    const res = await pending;
    expect(res.status, await res.clone().text()).toBe(status);
    return (await res.json()) as T;
  };
  const admin = async () => apiClient(t.app, (await loginAdmin(t.app)).cookie);
  const member = async (name: string) => ({
    client: apiClient(t.app, (await provisionUser(t.app, name)).cookie),
    projectId: `${name}-default_project`,
  });

  /** The figures once a fresh measurement has ended. */
  async function measured(client: Client): Promise<StorageUsage> {
    expect((await client.post("/api/me/storage/refresh")).status).toBe(200);
    const deadline = Date.now() + 20_000;
    for (;;) {
      const usage = await json<StorageUsage>(client.get("/api/me/storage"));
      if (!usage.measuring && usage.measuredAt !== null) return usage;
      if (Date.now() > deadline) throw new Error("the measurement did not end");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  const review = (client: Client, days = 7) =>
    json<StorageCleanupReview>(client.get(`/api/me/storage/cleanup?olderThanDays=${days}`));
  const clean = (client: Client, items: string[], olderThanDays = 7) =>
    json<StorageCleanupResult>(client.post("/api/me/storage/cleanup", { items, olderThanDays }));
  const list = (client: Client, qs = "") =>
    json<StorageSessionsResponse>(client.get(`/api/me/storage/sessions${qs}`));

  // Every place is built by the layout's own helpers, as the server builds it.
  const traces = (projectId = P) => tracesDir(t.root, projectId, A);
  const scratchpad = (projectId = P) => scratchpadDir(t.root, projectId, A);
  const workspaces = (projectId = P) => workspacesDir(t.root, projectId, A);
  const sharedEnv = (projectId = P) => sharedEnvDir(t.root, projectId, A);
  /** Writes `bytes` bytes at `file`, making its folders. */
  async function put(file: string, bytes: number): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.alloc(bytes, 7));
  }
  /** Sets every modification time under `target`, and its own, `days` back. */
  async function backdate(target: string, days: number): Promise<void> {
    const when = new Date(Date.now() - days * DAY_MS);
    const walk = async (entry: string): Promise<void> => {
      const st = await fs.lstat(entry);
      if (st.isDirectory()) {
        for (const name of await fs.readdir(entry)) await walk(path.join(entry, name));
      }
      await fs.utimes(entry, when, when);
    };
    await walk(target);
  }
  const exists = (target: string) =>
    fs.stat(target).then(
      () => true,
      () => false,
    );

  /** A Session id no other seed in this file holds. */
  const nextSessionId = () => {
    seq += 1;
    return `session-2026-10-01-09-00-00-5701${String(seq).padStart(4, "0")}`;
  };
  /** A Session's index row, and its Trace (padded by `prompt`), last active `daysAgo` days back. */
  async function seed(
    opts: {
      projectId?: string;
      workspace?: string;
      daysAgo?: number;
      prompt?: string;
      source?: "user" | "subagent";
    } = {},
  ): Promise<string> {
    const sessionId = nextSessionId();
    const projectId = opts.projectId ?? P;
    const stamp = new Date(Date.now() - (opts.daysAgo ?? 0) * DAY_MS).toISOString();
    const workspace = opts.workspace ?? "/tmp/storage-ws";
    t.deps.sessionsRepo.insert({
      sessionId,
      projectId,
      agentId: A,
      provider: "custom",
      modelId: "m-x",
      workspace,
      approvalMode: "allow-all",
      title: null,
      client: "web",
      hasTrace: true,
      createdAt: stamp,
      lastActiveAt: stamp,
    });
    const meta = {
      session_id: sessionId,
      model_id: "m-x",
      provider: "custom",
      model_context_window: 1000,
      system_prompt: "",
      agent_state: "/tmp/a",
      workspace,
      source: opts.source ?? "user",
    };
    await writeTraceFile(t.root, projectId, A, TRACE_DAY, sessionId, 1, [
      sessionMeta(meta as Parameters<typeof sessionMeta>[0]),
      userText(opts.prompt ?? "hello"),
    ]);
    return sessionId;
  }
  /** Starts a Task on `sessionId` that runs until it is aborted. */
  async function startRunning(sessionId: string): Promise<void> {
    t.deps.manager.adopt(
      t.deps.sessionsRepo.findById(sessionId)!,
      fakeSession(sessionId, {
        async *run(_input, { signal }) {
          yield requestBegin();
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
        },
      }),
    );
    await t.deps.manager.startTask(sessionId, [userText("long job")]);
    await waitFor(() => t.deps.manager.statusOf(sessionId) === "running");
  }

  it("lets concurrent waiting readers see the completed measurement and refreshes the same scope", async () => {
    const client = await admin();
    const first = await json<StorageUsage>(client.get("/api/me/storage"));
    expect(first.measuring).toBe(true);
    const read = () => json<StorageUsage>(client.get("/api/me/storage?wait=1"));
    const [a, b] = await Promise.all([read(), read()]);
    expect(a.measuredAt).not.toBeNull();
    expect(b).toEqual(a);
    const sample = path.join(traces(), "storage-size-sample");
    await put(sample, 300);
    const refresh = await json<StorageUsage>(client.post("/api/me/storage/refresh"));
    expect(refresh.measuring).toBe(true);
    expect(refresh.categories).toEqual(a.categories);
    const result = await read();
    expect(result.measuring).toBe(false);
    expect(result.categories.traces).toBe(a.categories.traces + 300);
    await fs.unlink(sample);
    await client.post("/api/me/storage/refresh");
    expect((await read()).categories.traces).toBe(a.categories.traces);
  });

  it("counts each byte in its category, per Project, per Agent and server-wide; a member sees their own Project only", async () => {
    const client = await admin();
    const peer = await member("st_member");
    const before = await measured(client);

    const sessionDir = path.join(scratchpad(), nextSessionId());
    await put(path.join(traces(), TRACE_DAY, "probe.bin"), 1000);
    await put(path.join(snapshotsDir(t.root, P, A), "v9.tar.gz"), 2000);
    await put(path.join(workspaces(), "tmp-1234abcd", "a.bin"), 3000);
    await put(path.join(sessionDir, "b.bin"), 4000);
    await put(path.join(sharedEnv(), "venv", "c.bin"), 5000);
    await put(path.join(benchmarksDir(t.root, P), "probe.bin"), 600);
    await put(path.join(t.root, "logs", "probe.log"), 700);
    await put(path.join(t.root, "plugins", "probe.bin"), 800);
    await put(path.join(t.root, ".cache", "probe", "x.bin"), 900);
    await put(path.join(t.root, "misc.bin"), 1100);
    await put(path.join(traces(peer.projectId), TRACE_DAY, "probe.bin"), 1300);

    const after = await measured(client);
    const grew = (a: StorageUsage["categories"], b: StorageUsage["categories"]) =>
      Object.fromEntries(
        Object.keys(a).map((k) => [k, b[k as keyof typeof b] - a[k as keyof typeof a]]),
      );
    expect(grew(before.server!.categories, after.server!.categories)).toEqual({
      traces: 1000 + 1300,
      agentState: 2000,
      workspaces: 3000,
      scratchpads: 4000,
      caches: 5000 + 900,
      logs: 700,
      plugins: 800,
      other: 600 + 1100,
    });
    const project = (u: StorageUsage) => u.projects.find((p) => p.projectId === P)!;
    expect(grew(project(before).categories, project(after).categories)).toEqual({
      traces: 1000,
      agentState: 2000,
      workspaces: 3000,
      scratchpads: 4000,
      caches: 5000,
      logs: 0,
      plugins: 0,
      other: 600,
    });
    const agent = (u: StorageUsage) => project(u).agents.find((a) => a.agentId === A)!;
    expect(agent(after).bytes - agent(before).bytes).toBe(1000 + 2000 + 3000 + 4000 + 5000);
    // The member's Project is not the admin's to open: it is counted, never named.
    expect(after.projects.map((p) => p.projectId)).toEqual([P]);
    expect(after.server!.otherProjects.count).toBe(1);
    expect(after.server!.otherProjects.bytes - before.server!.otherProjects.bytes).toBe(1300);
    expect(after.server!.entries.find((e) => e.name === "logs")).toMatchObject({
      category: "logs",
    });

    const theirs = await measured(peer.client);
    expect(theirs.server).toBeUndefined();
    expect(theirs.projects.map((p) => p.projectId)).toEqual([peer.projectId]);
    expect(theirs.projects[0]!.categories.traces).toBeGreaterThanOrEqual(1300);
    expect(theirs.bytes).toBe(theirs.projects[0]!.bytes);
  });

  it("offers orphans left alone for a day, ticked, and removing them takes them off the disk", async () => {
    const client = await admin();
    const orphanPad = path.join(scratchpad(), nextSessionId());
    const youngPad = path.join(scratchpad(), nextSessionId());
    const orphanWorkspace = path.join(workspaces(), "tmp-0000bbbb");
    const cacheEntry = path.join(t.root, ".cache", "market");
    await put(path.join(orphanPad, "plan.md"), 4096);
    await put(path.join(youngPad, "plan.md"), 10);
    await put(path.join(orphanWorkspace, "out.bin"), 8192);
    await put(path.join(cacheEntry, "cover.webp"), 2048);
    await backdate(orphanPad, 2);
    await backdate(orphanWorkspace, 2);

    const { items } = await review(client);
    const named = (name: string) => items.find((item) => item.name === name);
    expect(named(path.basename(orphanPad))).toMatchObject({
      kind: "scratchpad",
      reason: "orphan",
      bytes: 4096,
      selected: true,
      projectId: P,
      agentId: A,
    });
    expect(named("tmp-0000bbbb")).toMatchObject({ kind: "workspace", bytes: 8192, selected: true });
    expect(named("market")).toMatchObject({ kind: "serverCache", bytes: 2048, selected: true });
    expect(named(path.basename(youngPad))).toBeUndefined();

    const chosen = items.filter((item) => item.selected).map((item) => item.id);
    // The local API token every Agent's shell holds may read the review, never remove from it.
    const agentShell = tokenClient(t.app, t.deps.authService.localApiToken()!);
    expect((await agentShell.get("/api/me/storage/cleanup")).status).toBe(200);
    const refused = await agentShell.post("/api/me/storage/cleanup", { items: chosen });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      "human_required",
    );
    expect(await exists(orphanPad)).toBe(true);

    const result = await clean(client, chosen);
    expect(result).toEqual({ removed: chosen.length, bytes: 4096 + 8192 + 2048, skipped: [] });
    for (const gone of [orphanPad, orphanWorkspace, cacheEntry])
      expect(await exists(gone)).toBe(false);
    expect(await exists(youngPad)).toBe(true);

    // The removal re-measures once the contents are gone: nothing of them is left anywhere.
    const after = await measured(client);
    expect((await review(client)).items.map((item) => item.name)).not.toContain("tmp-0000bbbb");
    const leftovers = await fs.readdir(deletingDir(t.root, P)).catch(() => []);
    expect(leftovers).toEqual([]);
    expect(after.server!.entries.find((e) => e.name === ".cache")?.bytes ?? 0).toBe(0);
  });

  it("never offers or removes what a running Session uses, and offers the environment once it stops", async () => {
    const client = await admin();
    const running = await seed({ daysAgo: 30 });
    const idle = await seed({ daysAgo: 30 });
    const child = await seed({ daysAgo: 30, source: "subagent" });
    const runningPad = path.join(scratchpad(), running);
    const idlePad = path.join(scratchpad(), idle);
    const childPad = path.join(scratchpad(), child);
    await put(path.join(childPad, "notes.md"), 200);
    await backdate(childPad, 30);
    const env = path.join(sharedEnv(), "venv");
    await put(path.join(runningPad, "GOAL.json"), 300);
    await put(path.join(idlePad, "image.png"), 500);
    await put(path.join(env, "lib.so"), 7000);
    await backdate(runningPad, 30);
    await backdate(idlePad, 30);
    await startRunning(running);

    const whileRunning = await review(client);
    expect(whileRunning.items.find((item) => item.name === running)).toBeUndefined();
    expect(whileRunning.items.find((item) => item.kind === "agentCache")).toBeUndefined();
    // The idle Session's scratchpad is offered, but not ticked: its chat's images would go.
    expect(whileRunning.items.find((item) => item.name === idle)).toMatchObject({
      kind: "scratchpad",
      reason: "idle",
      sessionId: idle,
      selected: false,
    });
    // A subagent's scratchpad goes with its parent, as its Trace does.
    expect(whileRunning.items.find((item) => item.name === child)).toBeUndefined();

    // Named anyway (an id built by hand, or a review read before the run began), they stay.
    const forged = [`scratchpad/${P}/${A}/${running}`, `agentCache/${P}/${A}/shared_env/venv`];
    const result = await clean(client, forged);
    expect(result.removed).toBe(0);
    expect(result.skipped).toEqual(forged.map((id) => ({ id, reason: "in_use" })));
    expect(await exists(path.join(runningPad, "GOAL.json"))).toBe(true);
    expect(await exists(path.join(env, "lib.so"))).toBe(true);

    t.deps.manager.abortTask(running);
    await waitFor(() => t.deps.manager.statusOf(running) === "idle");
    const afterRun = await review(client);
    expect(afterRun.items.find((item) => item.kind === "agentCache")).toMatchObject({
      name: "venv",
      bytes: 7000,
      selected: false,
    });
    // Its run made it active again: it is no longer an idle Session's scratchpad.
    expect(afterRun.items.find((item) => item.name === running)).toBeUndefined();
  });

  it("never offers or removes a temporary Workspace a Session still has", async () => {
    const client = await admin();
    const held = path.join(workspaces(), "tmp-0000dddd");
    const holdsInside = path.join(workspaces(), "tmp-0000eeee");
    const free = path.join(workspaces(), "tmp-0000ffff");
    await put(path.join(held, "report.md"), 100);
    await put(path.join(holdsInside, "app", "main.ts"), 100);
    await put(path.join(free, "scratch.txt"), 100);
    await backdate(free, 90);
    const archived = await seed({ workspace: held, daysAgo: 90 });
    expect((await client.patch(`/api/sessions/${archived}`, { archived: true })).status).toBe(200);
    await seed({ workspace: path.join(holdsInside, "app"), daysAgo: 90 });
    await backdate(held, 90);
    await backdate(holdsInside, 90);

    const offered = async () =>
      (await review(client)).items.filter((i) => i.kind === "workspace").map((i) => i.name);
    expect(await offered()).toEqual(["tmp-0000ffff"]);
    // A Session working in the Agent's `workspaces/` folder itself has every one of them.
    await seed({ workspace: workspaces(), daysAgo: 90 });
    expect(await offered()).toEqual([]);
    const ids = [
      `workspace/${P}/${A}/tmp-0000dddd`,
      `workspace/${P}/${A}/tmp-0000eeee`,
      `workspace/${P}/${A}/tmp-0000ffff`,
    ];
    expect((await clean(client, ids)).skipped).toEqual(ids.map((id) => ({ id, reason: "in_use" })));
    expect(await exists(path.join(held, "report.md"))).toBe(true);
    expect(await exists(path.join(holdsInside, "app", "main.ts"))).toBe(true);
    expect(await exists(path.join(free, "scratch.txt"))).toBe(true);
  });

  it("lets a member clean their own Projects only, and never a server cache", async () => {
    const client = await admin();
    const owner = await member("st_owner");
    const stranger = await member("st_stranger");
    const pad = path.join(scratchpad(owner.projectId), nextSessionId());
    await put(path.join(pad, "notes.md"), 640);
    await backdate(pad, 3);
    await put(path.join(t.root, ".cache", "market", "cover.webp"), 64);
    const id = `scratchpad/${owner.projectId}/${A}/${path.basename(pad)}`;

    const strangers = await review(stranger.client);
    expect(strangers.items.filter((item) => item.projectId === owner.projectId)).toEqual([]);
    expect(strangers.items.filter((item) => item.kind === "serverCache")).toEqual([]);
    expect(await clean(stranger.client, [id, "serverCache/.cache/market"])).toEqual({
      removed: 0,
      bytes: 0,
      skipped: [
        { id, reason: "gone" },
        { id: "serverCache/.cache/market", reason: "gone" },
      ],
    });
    expect(await exists(pad)).toBe(true);

    // The owner's review offers it; so does the admin's, server-wide, cache included.
    expect((await review(owner.client)).items.map((item) => item.id)).toContain(id);
    const admins = (await review(client)).items.map((item) => item.id);
    expect(admins).toEqual(expect.arrayContaining([id, "serverCache/.cache/market"]));
    expect((await clean(owner.client, [id])).removed).toBe(1);
    expect(await exists(pad)).toBe(false);
  });

  it("lists Sessions by size and age, and deleting chosen ones takes their files with them", async () => {
    const client = await admin();
    const big = await seed({ daysAgo: 40, prompt: "x".repeat(20_000) });
    const small = await seed({ daysAgo: 2, prompt: "short" });
    const archived = await seed({ daysAgo: 60, prompt: "y".repeat(5_000) });
    expect((await client.patch(`/api/sessions/${archived}`, { archived: true })).status).toBe(200);
    const running = await seed({ daysAgo: 1, prompt: "z" });
    await put(path.join(scratchpad(), big, "upload.png"), 1000);
    await startRunning(running);
    const ids = (r: StorageSessionsResponse) => r.sessions.map((s) => s.sessionId);

    const bySize = await list(client, `?projectId=${P}`);
    expect(ids(bySize)).toEqual([big, archived, expect.any(String), expect.any(String)]);
    expect(bySize.sessions[0]!.traceBytes).toBeGreaterThan(20_000);
    expect(bySize.sessions.find((s) => s.sessionId === running)).toMatchObject({ running: true });
    expect(bySize.total).toBe(4);
    expect(ids(await list(client, "?sort=age"))).toEqual([archived, big, small, running]);
    expect(ids(await list(client, "?listing=archived"))).toEqual([archived]);
    expect(ids(await list(client, "?listing=active&olderThanDays=30"))).toEqual([big]);
    expect(ids(await list(client, `?projectId=${P}&agentId=nobody`))).toEqual([]);

    // A measurement adds what the scratchpad holds to the Session's size.
    await measured(client);
    expect((await list(client)).sessions.find((s) => s.sessionId === big)).toMatchObject({
      scratchpadBytes: 1000,
    });

    // Deleting goes through the archive page's batch: the one Session delete path.
    const res = await client.post("/api/me/archived-sessions/delete", {
      sessionIds: [big, archived],
    });
    expect(await res.json()).toEqual({ done: 2, missing: [] });
    expect(ids(await list(client))).toEqual(expect.not.arrayContaining([big, archived]));
    const traceOf = (sessionId: string) => path.join(traces(), TRACE_DAY, `${sessionId}_001.jsonl`);
    expect(await exists(traceOf(big))).toBe(false);
    expect(await exists(traceOf(archived))).toBe(false);
    expect(await exists(path.join(scratchpad(), big))).toBe(false);
    expect(await exists(traceOf(small))).toBe(true);
    t.deps.manager.abortTask(running);
  });

  it("answers a malformed request with a 400, and a Project the user cannot open with a 404", async () => {
    const client = await admin();
    for (const days of ["0", "3651", "1.5", "x"]) {
      expect((await client.get(`/api/me/storage/cleanup?olderThanDays=${days}`)).status, days).toBe(
        400,
      );
    }
    expect((await client.post("/api/me/storage/cleanup", { items: [] })).status).toBe(400);
    expect((await client.post("/api/me/storage/cleanup", { items: [42] })).status).toBe(400);
    expect((await client.get("/api/me/storage/sessions?agentId=default_agent")).status).toBe(400);
    expect((await client.get("/api/me/storage/sessions?sort=name")).status).toBe(400);
    expect((await client.get("/api/me/storage/sessions?projectId=nobody_here")).status).toBe(404);
    // Showing a folder is the desktop shell's: a browser session on a plain server is not offered it.
    expect((await client.post("/api/me/storage/reveal", {})).status).toBe(404);
  });
});

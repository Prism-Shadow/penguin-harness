/**
 * Integration tests for the schedule routes: CRUD and permissions (any member can read, only the owner can
 * modify, outsiders get 404), 400 validation, 409 on name collision, hand-edited
 * invalid files landing in invalidFiles, and the on-disk file shape.
 *
 * - A write that could never fire — a one-shot whose start_at is past, or a task whose end_at is
 *   past — is refused with 400 on POST and PUT, and nothing is written.
 * - Settled tasks are archived into schedule/expired/: absent from the agent and Project listings
 *   and from the agent card's scheduleCount.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scheduleDir } from "@prismshadow/penguin-core";
import type {
  AgentsResponse,
  ProjectCreateResponse,
  ProjectSchedulesResponse,
  ScheduleItem,
  SchedulesResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const FUTURE = "2099-01-01T09:00:00Z";
const PAST = "2020-01-01T00:00:00Z";

describe("schedules api", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let projectId: string;
  let base: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_a");
    const b = await provisionUser(t.app, "member_b");
    const c = await provisionUser(t.app, "outsider_c");
    owner = apiClient(t.app, a.cookie);
    member = apiClient(t.app, b.cookie);
    outsider = apiClient(t.app, c.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_a-sched", name: "schedule project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    base = `/api/projects/${projectId}/agents/default_agent/schedules`;
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_b" })).status,
    ).toBe(201);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("POST creates (owner only) and lands TOML on disk; GET list and single item; DELETE cleans up", async () => {
    const body = {
      name: "daily-report",
      prompt: "Write the daily report",
      enabled: true,
      startAt: FUTURE,
      period: "30m",
    };
    expect((await member.post(base, body)).status).toBe(403);
    const createdRes = await owner.post(base, body);
    expect(createdRes.status).toBe(201);
    const item = (await createdRes.json()) as ScheduleItem;
    expect(item).toMatchObject({
      name: "daily-report",
      prompt: "Write the daily report",
      enabled: true,
      period: "30m",
      status: "active",
      queued: false,
      creatorUserId: "owner_a",
      nextFireAt: "2099-01-01T09:00:00.000Z",
    });

    // The filename is the identifier; the TOML lands under agent_state/schedule/.
    const file = path.join(scheduleDir(t.root, projectId, "default_agent"), "daily-report.toml");
    const raw = await fs.readFile(file, "utf8");
    expect(raw).toContain('prompt = "Write the daily report"');
    expect(raw).toContain('period = "30m"');

    // Any member can read; outsiders get 404.
    const list = (await (await member.get(base)).json()) as SchedulesResponse;
    expect(list.schedules.map((s) => s.name)).toEqual(["daily-report"]);
    expect(list.invalidFiles).toEqual([]);
    expect((await outsider.get(base)).status).toBe(404);
    expect((await member.get(`${base}/daily-report`)).status).toBe(200);

    // Name collision returns 409.
    expect((await owner.post(base, body)).status).toBe(409);

    // Delete (owner only): removes both the file and the state.
    expect((await member.delete(`${base}/daily-report`)).status).toBe(403);
    expect((await owner.delete(`${base}/daily-report`)).status).toBe(204);
    await expect(fs.access(file)).rejects.toThrow();
    expect((await owner.delete(`${base}/daily-report`)).status).toBe(404);
  });

  it("new-Session mode can specify workspace and a paired model reference, echoed back", async () => {
    // The model reference is given as a pair (provider + modelId), and it must
    // resolve within the Project config.
    const res = await owner.post(base, {
      name: "fresh",
      prompt: "p",
      enabled: true,
      startAt: FUTURE,
      workspace: "/tmp/ws",
      provider: "deepseek",
      modelId: "deepseek-v4-pro",
    });
    expect(res.status).toBe(201);
    expect((await res.json()) as ScheduleItem).toMatchObject({
      workspace: "/tmp/ws",
      provider: "deepseek",
      modelId: "deepseek-v4-pro",
    });
  });

  it("an unresolvable model reference (absent from config) is 400 and writes nothing", async () => {
    const res = await owner.post(base, {
      name: "bad-model",
      prompt: "p",
      enabled: true,
      startAt: FUTURE,
      provider: "custom",
      modelId: "not-configured",
    });
    expect(res.status).toBe(400);
    expect((await owner.get(`${base}/bad-model`)).status).toBe(404);
  });

  it("PUT replaces the whole file (owner only); missing is 404", async () => {
    const body = { name: "job", prompt: "p1", enabled: false, startAt: FUTURE };
    expect((await owner.post(base, body)).status).toBe(201);
    expect(
      (await member.put(`${base}/job`, { prompt: "p2", enabled: true, startAt: FUTURE })).status,
    ).toBe(403);
    const updated = await owner.put(`${base}/job`, {
      prompt: "p2",
      enabled: true,
      startAt: FUTURE,
      sessionId: "session-2099",
    });
    expect(updated.status).toBe(200);
    expect((await updated.json()) as ScheduleItem).toMatchObject({
      prompt: "p2",
      enabled: true,
      sessionId: "session-2099",
      status: "active",
    });
    expect(
      (await owner.put(`${base}/nope`, { prompt: "p", enabled: false, startAt: FUTURE })).status,
    ).toBe(404);
  });

  it("validation 400: period below the minimum, invalid instant, pick-one target, half a model reference, invalid task name", async () => {
    const ok = { prompt: "p", enabled: false, startAt: FUTURE };
    const cases = [
      { name: "j1", ...ok, period: "4m" },
      { name: "j2", ...ok, startAt: "someday" },
      { name: "j3", ...ok, sessionId: "s", workspace: "/w" },
      // A model reference is a pair: neither half alone is accepted (nothing is inferred).
      { name: "j4", ...ok, modelId: "deepseek-v4-pro" },
      { name: "j5", ...ok, provider: "deepseek" },
      { name: "bad.name", ...ok },
    ];
    for (const body of cases) {
      expect((await owner.post(base, body)).status, JSON.stringify(body)).toBe(400);
    }
    // Nothing was persisted for any of them.
    const list = (await (await owner.get(base)).json()) as SchedulesResponse;
    expect(list.schedules).toEqual([]);
    expect(list.invalidFiles).toEqual([]);
  });

  it("hand-edited files: invalid ones land in invalidFiles; a valid one is listed with the Project owner as its creator", async () => {
    const dir = scheduleDir(t.root, projectId, "default_agent");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "broken.toml"), "not = toml =", "utf8");
    await fs.writeFile(
      path.join(dir, "hand.toml"),
      `prompt = "h"\nenabled = true\nstart_at = "${FUTURE}"\n`,
      "utf8",
    );
    const list = (await (await owner.get(base)).json()) as SchedulesResponse;
    expect(list.invalidFiles.map((f) => f.name)).toEqual(["broken"]);
    expect(list.schedules.map((s) => [s.name, s.status, s.creatorUserId])).toEqual([
      // For a hand-edited file, the creator falls back to the Project owner.
      ["hand", "active", "owner_a"],
    ]);
  });

  it("a one-shot whose start_at is past, or a task whose end_at is past, is refused with 400 and writes nothing", async () => {
    const refusal = async (res: Response): Promise<[number, string]> => [
      res.status,
      ((await res.json()) as { error: { message: string } }).error.message,
    ];
    expect(
      await refusal(
        await owner.post(base, { name: "late", prompt: "p", enabled: true, startAt: PAST }),
      ),
    ).toEqual([400, expect.stringContaining("start_at is already past")]);
    expect(
      await refusal(
        await owner.post(base, {
          name: "over",
          prompt: "p",
          enabled: true,
          startAt: PAST,
          period: "1d",
          endAt: "2021-01-01T00:00:00Z",
        }),
      ),
    ).toEqual([400, expect.stringContaining("end_at is already past")]);
    // A periodic task may start in the past: later slots are still ahead of it. (Disabled here
    // only so the test does not fire it.)
    expect(
      (
        await owner.post(base, {
          name: "daily",
          prompt: "p",
          enabled: false,
          startAt: PAST,
          period: "1d",
        })
      ).status,
    ).toBe(201);
    // PUT is held to the same rule, and the stored file is left as it was.
    const file = path.join(scheduleDir(t.root, projectId, "default_agent"), "daily.toml");
    const before = await fs.readFile(file, "utf8");
    expect(
      await refusal(
        await owner.put(`${base}/daily`, { prompt: "p2", enabled: true, startAt: PAST }),
      ),
    ).toEqual([400, expect.stringContaining("start_at is already past")]);
    expect(await fs.readFile(file, "utf8")).toBe(before);
    const list = (await (await owner.get(base)).json()) as SchedulesResponse;
    expect(list.schedules.map((s) => s.name)).toEqual(["daily"]);
  });

  it("settled tasks are archived: absent from the agent and Project listings and from the agent card's count", async () => {
    expect(
      (
        await owner.post(base, {
          name: "live",
          prompt: "p",
          enabled: true,
          startAt: FUTURE,
          period: "30m",
        })
      ).status,
    ).toBe(201);
    // Hand-edited files the API would refuse: a one-shot already past, a task past end_at.
    const dir = scheduleDir(t.root, projectId, "default_agent");
    await fs.writeFile(
      path.join(dir, "stale.toml"),
      `prompt = "s"\nenabled = true\nstart_at = "${PAST}"\n`,
      "utf8",
    );
    await fs.writeFile(
      path.join(dir, "over.toml"),
      `prompt = "o"\nenabled = true\nstart_at = "${PAST}"\nperiod = "1d"\nend_at = "2021-01-01T00:00:00Z"\n`,
      "utf8",
    );

    const project = (await (
      await member.get(`/api/projects/${projectId}/schedules`)
    ).json()) as ProjectSchedulesResponse;
    expect(project.schedules.map((s) => s.name)).toEqual(["live"]);
    const agent = (await (await member.get(base)).json()) as SchedulesResponse;
    expect(agent.schedules.map((s) => s.name)).toEqual(["live"]);
    expect((await owner.get(`${base}/stale`)).status).toBe(404);
    const cards = (await (
      await member.get(`/api/projects/${projectId}/agents`)
    ).json()) as AgentsResponse;
    expect(cards.agents.find((a) => a.agentId === "default_agent")?.scheduleCount).toBe(1);
    // The files are kept, unchanged, under schedule/expired/.
    expect((await fs.readdir(path.join(dir, "expired"))).sort()).toEqual([
      "over.toml",
      "stale.toml",
    ]);
  });

  it("a hand-edited file is reconciled past a warm mtime cache (an in-place edit moves only the file's mtime)", async () => {
    expect(
      (
        await owner.post(base, {
          name: "hand",
          prompt: "before",
          enabled: true,
          startAt: FUTURE,
          period: "30m",
        })
      ).status,
    ).toBe(201);
    // Make the tree look quiet (a fresh mtime is never cached as clean), then warm the
    // scan cache with one GET — the steady state the schedule routes now serve from.
    const dir = scheduleDir(t.root, projectId, "default_agent");
    const file = path.join(dir, "hand.toml");
    const old = new Date("2026-01-01T00:00:00Z");
    await fs.utimes(dir, old, old);
    await fs.utimes(file, old, old);
    let list = (await (await owner.get(base)).json()) as SchedulesResponse;
    expect(list.schedules[0]?.prompt).toBe("before");
    // Hand-edit the file in place (like over SSH): the content and file mtime change,
    // the directory's mtime does NOT — the per-file stat still catches it.
    const raw = await fs.readFile(file, "utf8");
    await fs.writeFile(file, raw.replace('"before"', '"after"'), "utf8");
    const edited = new Date("2026-01-01T00:01:00Z");
    await fs.utimes(file, edited, edited);
    list = (await (await owner.get(base)).json()) as SchedulesResponse;
    expect(list.schedules[0]?.prompt).toBe("after");
  });

  it("a file holding model_id without provider lands in invalidFiles instead of being scheduled", async () => {
    // What a schedule file persisted before the pairing rule looks like: the provider is
    // never filled in for it, the file is simply reported invalid and skipped.
    const dir = scheduleDir(t.root, projectId, "default_agent");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "legacy.toml"),
      `prompt = "p"\nenabled = true\nstart_at = "${FUTURE}"\nmodel_id = "deepseek-v4-pro"\n`,
      "utf8",
    );
    const list = (await (await owner.get(base)).json()) as SchedulesResponse;
    expect(list.schedules).toEqual([]);
    expect(list.invalidFiles.map((f) => f.name)).toEqual(["legacy"]);
    expect(list.invalidFiles[0]?.error).toContain("given together");
    // Reading it by name reports the same error rather than 404 or a 500.
    expect((await owner.get(`${base}/legacy`)).status).toBe(400);
  });

  it("the Project-wide list spans every Agent, stamping each task and each invalid file with its Agent", async () => {
    expect(
      (await owner.post(`/api/projects/${projectId}/agents`, { agentId: "agent_two" })).status,
    ).toBe(201);
    const secondBase = `/api/projects/${projectId}/agents/agent_two/schedules`;
    expect(
      (
        await owner.post(base, {
          name: "default-job",
          prompt: "p",
          enabled: true,
          startAt: FUTURE,
          period: "30m",
          sessionId: "session-aaa",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await owner.post(secondBase, {
          name: "second-job",
          prompt: "p",
          enabled: true,
          startAt: FUTURE,
          period: "30m",
          sessionId: "session-bbb",
        })
      ).status,
    ).toBe(201);
    // A hand-edited file that does not parse is reported under the Agent holding it.
    const dir = scheduleDir(t.root, projectId, "agent_two");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "broken.toml"), "not = toml =", "utf8");

    // Any member can read the whole Project in one request; Agents come back in id order.
    const res = await member.get(`/api/projects/${projectId}/schedules`);
    expect(res.status).toBe(200);
    const list = (await res.json()) as ProjectSchedulesResponse;
    expect(list.schedules.map((s) => [s.agentId, s.name, s.sessionId])).toEqual([
      ["agent_two", "second-job", "session-bbb"],
      ["default_agent", "default-job", "session-aaa"],
    ]);
    for (const item of list.schedules) {
      expect(item, item.name).toMatchObject({
        status: "active",
        nextFireAt: "2099-01-01T09:00:00.000Z",
      });
    }
    expect(list.invalidFiles).toEqual([
      { agentId: "agent_two", name: "broken", error: expect.any(String) },
    ]);

    // Same access rule as the per-Agent list: an outsider is told the Project is not there.
    expect((await outsider.get(`/api/projects/${projectId}/schedules`)).status).toBe(404);
  });
});

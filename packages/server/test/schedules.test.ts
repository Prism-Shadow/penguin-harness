/**
 * Integration tests for the schedule routes: CRUD and permissions (any member can read, only the owner can
 * modify, outsiders get 404), 400 validation, 409 on name collision, hand-edited
 * invalid files landing in invalidFiles, expired one-shot tasks marked missed
 * during reconciliation, and the on-disk file shape.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scheduleDir } from "@prismshadow/penguin-core";
import type { ProjectCreateResponse, ScheduleItem, SchedulesResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const FUTURE = "2099-01-01T09:00:00Z";

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

  it("validation 400: period below the minimum, invalid instant, pick-one target, invalid task name", async () => {
    const ok = { prompt: "p", enabled: false, startAt: FUTURE };
    const cases = [
      { name: "j1", ...ok, period: "4m" },
      { name: "j2", ...ok, startAt: "someday" },
      { name: "j3", ...ok, sessionId: "s", workspace: "/w" },
      { name: "bad.name", ...ok },
    ];
    for (const body of cases) {
      expect((await owner.post(base, body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("hand-edited files: invalid ones land in invalidFiles; expired one-shots are marked missed during reconciliation", async () => {
    const dir = scheduleDir(t.root, projectId, "default_agent");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "broken.toml"), "not = toml =", "utf8");
    await fs.writeFile(
      path.join(dir, "stale.toml"),
      `prompt = "s"\nenabled = true\nstart_at = "2020-01-01T00:00:00Z"\n`,
      "utf8",
    );
    const list = (await (await owner.get(base)).json()) as SchedulesResponse;
    expect(list.invalidFiles.map((f) => f.name)).toEqual(["broken"]);
    const stale = list.schedules.find((s) => s.name === "stale");
    expect(stale?.status).toBe("missed");
    // For a hand-edited file, the creator falls back to the Project owner.
    expect(stale?.creatorUserId).toBe("owner_a");
  });
});

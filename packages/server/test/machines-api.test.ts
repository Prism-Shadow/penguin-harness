/**
 * The machines API: who may use it, what the list answers, and the install job's lifecycle
 * as the Machines page sees it — start, poll, finish, and every way a start is refused
 * before an ssh runs.
 *
 * The service's three reaching-out effects are faked (see MachinesEffects): the real ones
 * read the developer's own ~/.ssh/config and spawn ssh against whatever it names. What the
 * push actually does over ssh is covered by machines-push.test.ts, against a fake ssh
 * binary and the real installOnRemote.
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MachinesResponse } from "../src/api/types.js";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/db/database.js";
import { MachinesRepo } from "../src/db/repos/machines.js";
import { MachinesService } from "../src/machines/service.js";
import type { MachinesEffects } from "../src/machines/service.js";
import type { RemoteInstallOutcome } from "../src/machines/install-server.js";
import type { RemoteIdentity } from "../src/machines/detect.js";
import {
  apiClient,
  createTestApp,
  loginAdmin,
  makeTempRoot,
  provisionUser,
  waitFor,
} from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** Every route is under a Project; the seeded one every server has. */
const PROJECT = "default_project";

/** This machine's id. Minted from the `machine` table in the real server; fixed here. */
const LOCAL_ID = "TESTlocalID00000";

const IDENTITY: RemoteIdentity = {
  platform: "linux",
  arch: "x64",
  installedVersion: null,
  harness: null,
};

/** Addresses the fake transport holds a session to. */
const connected = new Set<string>();

/** An effects set that names two hosts and installs successfully, with the parts a test cares about overridden. */
function effects(over: Partial<MachinesEffects> = {}): Partial<MachinesEffects> {
  return {
    listAliases: () => ["build-box", "nas"],
    resolvePlan: () => ({ baseVersion: "9.9.9", harness: null, hmrDir: null, version: "9.9.9" }),
    now: () => new Date("2026-08-24T12:00:00.000Z"),
    startServer: async () => ({ ok: true }),
    stopServer: async () => ({ ok: true as const }),
    upgrade: async () => ({ kind: "upgraded", detail: "" }),
    runOn: async () => ({
      code: 0,
      stdout: "---penguin-auth-token---\nremote-token\n",
      stderr: "",
      timedOut: false,
    }),
    // The connection: a fake registry this suite marks machines connected in, the way the
    // transport's own registry answers `session` for a held ssh session.
    hold: async (target) => {
      connected.add(`ssh:${target.alias}`);
      return { ok: true, session: { pid: process.pid, socksPort: 1 } };
    },
    session: (address) => (connected.has(address) ? { pid: process.pid, socksPort: 1 } : null),
    agent: () => new http.Agent(),
    probe: async () => ({ state: { kind: "running", port: 7364, pid: 4242 }, machineId: null }),
    install: async (opts): Promise<RemoteInstallOutcome> => {
      opts.onProgress?.("Pushing…");
      return { kind: "installed", output: "done", identity: IDENTITY };
    },
    ...over,
  };
}

describe("machines API", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  /** The service's own data root — where it writes the install records this suite reads back. */
  let machinesRoot: string;
  let machinesRepo: MachinesRepo;
  let store: DatabaseSync;

  const boot = async (over: Partial<MachinesEffects> = {}) => {
    connected.clear();
    machinesRoot = await makeTempRoot();
    // The store is the service's own here, not the App's, so it needs the Project row the
    // membership table's foreign key points at — a membership follows its Project out.
    store = openDatabase(":memory:");
    store
      .prepare(
        "INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES (?, ?, 1, ?)",
      )
      .run("admin", "x", "2026-08-24T00:00:00.000Z");
    store
      .prepare("INSERT INTO projects (project_id, owner_user_id, created_at) VALUES (?, ?, ?)")
      .run("default_project", "admin", "2026-08-24T00:00:00.000Z");
    machinesRepo = new MachinesRepo(store);
    t = await createTestApp({
      machines: new MachinesService(machinesRoot, LOCAL_ID, machinesRepo, effects(over)),
    });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  };

  /** What the store holds for each machine, as the service left it. */
  const recordsInStore = (): Record<string, { version: string; at: string }> =>
    Object.fromEntries(
      machinesRepo
        .all()
        .filter((row) => row.version !== null)
        .map((row) => [row.address, { version: row.version!, at: row.installedAt! }]),
    );

  afterEach(async () => {
    await t.cleanup();
    fs.rmSync(machinesRoot, { recursive: true, force: true });
  });

  describe("permission", () => {
    beforeEach(() => boot());

    it("is admin-only: a provisioned user gets 403", async () => {
      const user = await provisionUser(t.app, "member");
      const member = apiClient(t.app, user.cookie);
      expect((await member.get("/api/projects/default_project/machines")).status).toBe(403);
      expect(
        (await member.post("/api/projects/default_project/machines/ssh:nas/install")).status,
      ).toBe(403);
    });

    it("needs a session at all", async () => {
      expect((await t.app.request("/api/projects/default_project/machines")).status).toBe(401);
    });
  });

  describe("the list", () => {
    it("is the ssh config's aliases, with the version this server would push", async () => {
      await boot();
      const body = (await (
        await admin.get("/api/projects/default_project/machines")
      ).json()) as MachinesResponse;
      expect(body.machines[0]).toMatchObject({
        id: "local",
        local: true,
        status: { state: "running" },
      });
      expect(body.machines[0]?.installed).not.toBeNull();
      expect(body.machines.slice(1)).toEqual([
        {
          id: "ssh:build-box",
          alias: "build-box",
          machineId: null,
          installed: null,
          local: false,
          connection: null,
          api: null,
          status: null,
        },
        {
          id: "ssh:nas",
          alias: "nas",
          machineId: null,
          installed: null,
          local: false,
          connection: null,
          api: null,
          status: null,
        },
      ]);
      expect(body.imageVersion).toBe("9.9.9");
      expect(body.job).toBeNull();
    });

    it("an empty or unreadable ssh config leaves this machine alone in the list, not an error", async () => {
      await boot({ listAliases: () => [] });
      const res = await admin.get("/api/projects/default_project/machines");
      expect(res.status).toBe(200);
      const machines = ((await res.json()) as MachinesResponse).machines;
      expect(machines.map((m) => m.id)).toEqual(["local"]);
    });

    it("reports no image when this server has none to push", async () => {
      await boot({ resolvePlan: () => null });
      const body = (await (
        await admin.get("/api/projects/default_project/machines")
      ).json()) as MachinesResponse;
      expect(body.imageVersion).toBeNull();
    });
  });

  describe("installing", () => {
    it("starts a job, narrates it, and finishes", async () => {
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await boot({
        install: async (opts) => {
          opts.onProgress?.("Pushing…");
          await held;
          return { kind: "installed", output: "done", identity: IDENTITY };
        },
      });
      const started = await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      expect(started.status).toBe(202);
      expect(((await started.json()) as MachinesResponse).job).toMatchObject({
        machineId: "ssh:nas",
        alias: "nas",
        running: true,
        result: null,
      });

      release();
      await waitFor(() => t.deps.machines.job()?.running === false);
      const body = (await (
        await admin.get("/api/projects/default_project/machines")
      ).json()) as MachinesResponse;
      expect(body.job?.result).toEqual({ ok: true, installed: "installed", version: "9.9.9" });
      expect(body.job?.log[0]).toBe("Installing 9.9.9 on nas…");
      expect(body.job?.log).toContain("Pushing…");
    });

    it("reports the far side's own words when the push fails", async () => {
      await boot({
        install: async () => ({
          kind: "failed",
          step: "connect",
          detail: "Permission denied (publickey).",
        }),
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toEqual({
        ok: false,
        step: "connect",
        message: "Permission denied (publickey).",
      });
    });

    it("a machine already on this version is a result, not a failure", async () => {
      await boot({
        install: async () => ({ kind: "already-installed", version: "9.9.9", identity: IDENTITY }),
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toEqual({
        ok: true,
        installed: "already-installed",
        version: "9.9.9",
      });
    });

    it("an alias that points back at this machine is refused by the machine's own id, before anything is written", async () => {
      // `Host localhost`, or a second alias for this host: the address is new to the store,
      // so nothing recorded says "that is here" — only the machine can, and it does.
      let installs = 0;
      await boot({
        probe: async () => ({
          state: { kind: "running" as const, port: 7364, pid: 1 },
          machineId: LOCAL_ID,
        }),
        install: async () => {
          installs++;
          return { kind: "installed", output: "", identity: IDENTITY };
        },
      });
      await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/install`);
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toMatchObject({
        ok: false,
        message: expect.stringContaining("this very machine"),
      });
      expect(installs).toBe(0);
      expect(recordsInStore()).toEqual({});
    });

    it("records the platform the install found, and probes the machine in that dialect", async () => {
      const dialects: (string | null)[] = [];
      await boot({
        install: async () => ({
          kind: "installed",
          output: "",
          identity: { ...IDENTITY, platform: "win32" as const },
        }),
        probe: async (_target, _run, platform) => {
          dialects.push(platform ?? null);
          return { state: { kind: "stopped" as const }, machineId: null };
        },
      });
      await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/install`);
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(machinesRepo.get("ssh:nas")?.platform).toBe("win32");
      // Before the install nothing was known (null). The install records what it found
      // before the restart asks the machine again, so that probe and the explicit one after
      // both speak cmd.exe.
      await admin.post(`/api/projects/${PROJECT}/machines/probe`);
      expect(dialects).toEqual([null, "win32", "win32"]);
    });

    it("re-running an install keeps the machine id the record already carried", async () => {
      await boot({
        install: async () => ({ kind: "already-installed", version: "9.9.9", identity: IDENTITY }),
      });
      machinesRepo.patch("ssh:nas", {
        version: "9.9.9",
        installedAt: "2026-08-01T00:00:00.000Z",
        machineId: "kUkIyqU-1GOfXgKD",
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(machinesRepo.get("ssh:nas")?.machineId).toBe("kUkIyqU-1GOfXgKD");
    });

    it("a machine that refuses this build says so, instead of reporting an install", async () => {
      await boot({
        install: async () => ({ kind: "state-only", identity: IDENTITY }),
        upgrade: async () => ({
          kind: "refused",
          detail: "this runtime publishes no business capabilities this platform can claim",
        }),
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toMatchObject({
        ok: false,
        step: "hand over the pushed build",
        // The release over there matches, so the installer is skipped and nothing else can
        // change that machine: installing anyway is the one step left, and it needs a yes.
        canReplaceProgram: true,
      });
      expect((t.deps.machines.job()?.result as { message: string }).message).toContain(
        "no business capabilities",
      );
    });

    it("a machine with nothing running on it is done, not failed — its disk already has this", async () => {
      // A hot swap replaces the code a RUNNING server is serving. With none there is nothing
      // to swap and nothing wrong: the files are in place for its next start.
      let asked = false;
      await boot({
        probe: async () => ({ state: { kind: "stopped" }, machineId: null }),
        install: async () => ({ kind: "state-only", identity: IDENTITY }),
        upgrade: async () => {
          asked = true;
          return { kind: "upgraded", detail: "" };
        },
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);

      expect(asked).toBe(false);
      expect(t.deps.machines.job()?.result).toMatchObject({ ok: true });
      expect(t.deps.machines.job()?.log.join(" ")).toContain("next starts");
    });

    it("a machine already carrying this build still gets it handed over: files are not the process", async () => {
      // `already-installed` is decided from what is on its disk. What runs there is what it
      // loaded at start — so a machine whose files were brought forward while it ran reports
      // a version it is not running until the update channel makes the two agree.
      let asked = false;
      await boot({
        install: async () => ({ kind: "already-installed", version: "9.9.9", identity: IDENTITY }),
        upgrade: async () => {
          asked = true;
          return { kind: "upgraded", detail: "" };
        },
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);

      expect(asked).toBe(true);
      expect(t.deps.machines.job()?.result).toMatchObject({
        ok: true,
        installed: "already-installed",
      });
    });

    it("answering that offer runs the installer the version check would have skipped", async () => {
      let forced: boolean | undefined;
      await boot({
        install: async (opts) => {
          forced = opts.forceInstaller;
          return { kind: "installed", output: "", identity: IDENTITY };
        },
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install", {
        replaceProgram: true,
      });
      await waitFor(() => t.deps.machines.job()?.running === false);

      expect(forced).toBe(true);
    });

    it("a throw from the push path still ends the job", async () => {
      await boot({
        install: () => {
          throw new Error("scp vanished");
        },
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toMatchObject({ ok: false, message: "scp vanished" });
    });
  });

  describe("what stays installed", () => {
    /** GET /api/machines, as the page reads it. */
    const listed = async () =>
      (
        (await (
          await admin.get(`/api/projects/default_project/machines`)
        ).json()) as MachinesResponse
      ).machines;

    it("a successful install is remembered, and is already visible on the first settled poll", async () => {
      await boot();
      await admin.post(`/api/projects/default_project/machines/ssh:nas/install`);
      await waitFor(() => t.deps.machines.job()?.running === false);

      const machines = await listed();
      expect(machines.find((m) => m.id === "ssh:nas")?.installed).toEqual({
        version: "9.9.9",
        at: "2026-08-24T12:00:00.000Z",
      });
      // The machine that was never installed to is untouched.
      expect(machines.find((m) => m.id === "ssh:build-box")?.installed).toBeNull();
    });

    it("survives the process: a fresh service over the same data root reads it back", async () => {
      await boot();
      await admin.post(`/api/projects/default_project/machines/ssh:nas/install`);
      await waitFor(() => t.deps.machines.job()?.running === false);

      // A new instance has no job and no memory — only the file. This is the restart case,
      // and the hot-push case: the App is rebuilt, the data root is not.
      const reborn = new MachinesService(machinesRoot, LOCAL_ID, machinesRepo, effects());
      expect(reborn.job()).toBeNull();
      expect(reborn.list("default_project").find((m) => m.id === "ssh:nas")?.installed).toEqual({
        version: "9.9.9",
        at: "2026-08-24T12:00:00.000Z",
      });
    });

    it("belongs to the Project that installed it, and to no other", async () => {
      await boot();
      await admin.post(`/api/projects/default_project/machines/ssh:nas/install`);
      await waitFor(() => t.deps.machines.job()?.running === false);

      // Another Project sees the same host as installed-but-not-mine: an adoption, not an
      // install. The record is one machine's, the membership is per Project.
      const other = t.deps.machines.list("other_project").find((m) => m.id === "ssh:nas");
      expect(other?.installed).toBeNull();
      expect(other?.elsewhere).toEqual({ version: "9.9.9", at: "2026-08-24T12:00:00.000Z" });
    });

    it("release drops the membership and leaves the install alone", async () => {
      await boot();
      await admin.post(`/api/projects/default_project/machines/ssh:nas/install`);
      await waitFor(() => t.deps.machines.job()?.running === false);

      const body = (await (
        await admin.post(`/api/projects/default_project/machines/ssh:nas/release`)
      ).json()) as MachinesResponse;
      expect(body.machines.find((m) => m.id === "ssh:nas")?.installed).toBeNull();
      // Still installed — the program is on that host whoever uses it.
      expect(recordsInStore()["ssh:nas"]).toEqual({
        version: "9.9.9",
        at: "2026-08-24T12:00:00.000Z",
      });
    });

    it("installing elsewhere does not erase the first machine", async () => {
      // The job is one slot, so before the records file existed this is exactly what made an
      // installed machine disappear: the second install overwrote the only evidence.
      await boot();
      await admin.post(`/api/projects/default_project/machines/ssh:nas/install`);
      await waitFor(() => t.deps.machines.job()?.running === false);
      await admin.post(`/api/projects/default_project/machines/ssh:build-box/install`);
      await waitFor(() => t.deps.machines.job()?.machineId === "ssh:build-box");
      await waitFor(() => t.deps.machines.job()?.running === false);

      const machines = await listed();
      expect(machines.every((m) => m.installed !== null)).toBe(true);
      expect(recordsInStore()).toEqual({
        "ssh:nas": { version: "9.9.9", at: "2026-08-24T12:00:00.000Z" },
        "ssh:build-box": { version: "9.9.9", at: "2026-08-24T12:00:00.000Z" },
      });
    });

    it("records what the REMOTE already had when nothing needed sending", async () => {
      await boot({
        install: async () => ({ kind: "already-installed", version: "8.8.8", identity: IDENTITY }),
      });
      await admin.post(`/api/projects/default_project/machines/ssh:nas/install`);
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect((await listed()).find((m) => m.id === "ssh:nas")?.installed?.version).toBe("8.8.8");
    });

    it("a deleted Project takes its machine list with it, and leaves the install alone", async () => {
      await boot();
      await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/install`);
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(machinesRepo.members(PROJECT)).toEqual(["ssh:nas"]);

      // The membership row is the Project's and follows it out (ON DELETE CASCADE), so a
      // Project later recreated under the same id does not inherit a dead one's machines.
      // The install record is the machine's, and stays.
      store.prepare("DELETE FROM projects WHERE project_id = ?").run(PROJECT);
      expect(machinesRepo.members(PROJECT)).toBeNull();
      expect(recordsInStore()["ssh:nas"]).toEqual({
        version: "9.9.9",
        at: "2026-08-24T12:00:00.000Z",
      });
    });

    it("a failed install records nothing", async () => {
      await boot({
        install: async () => ({ kind: "failed", step: "connect", detail: "no route to host" }),
      });
      await admin.post(`/api/projects/default_project/machines/ssh:nas/install`);
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect((await listed()).filter((m) => !m.local).every((m) => m.installed === null)).toBe(
        true,
      );
      expect(recordsInStore()).toEqual({});
    });
  });

  describe("server status", () => {
    const listed = async () =>
      (
        (await (
          await admin.get("/api/projects/default_project/machines")
        ).json()) as MachinesResponse
      ).machines;
    const byId = async (id: string) => (await listed()).find((machine) => machine.id === id);

    it("this machine reports itself running without any probe", async () => {
      await boot({
        probe: () => {
          throw new Error("the local entry must not be probed");
        },
      });
      expect(await byId("local")).toMatchObject({ local: true, status: { state: "running" } });
    });

    it("is null until probed — listing costs no ssh", async () => {
      let probes = 0;
      await boot({
        probe: async () => {
          probes++;
          return { state: { kind: "running", port: 7364, pid: 1 }, machineId: null };
        },
      });
      await admin.get("/api/projects/default_project/machines");
      await admin.get("/api/projects/default_project/machines");
      expect(probes).toBe(0);
      expect((await byId("ssh:nas"))?.status).toBeNull();
    });

    it("probes only the machines something was installed on", async () => {
      const probed: string[] = [];
      await boot({
        probe: async (target) => {
          probed.push(target.alias);
          return { state: { kind: "running", port: 7364, pid: 1 }, machineId: null };
        },
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      probed.length = 0;

      const res = await admin.post("/api/projects/default_project/machines/probe");
      expect(res.status).toBe(200);
      expect(probed).toEqual(["nas"]);
      expect((await byId("ssh:nas"))?.status).toMatchObject({ state: "running", port: 7364 });
      expect((await byId("ssh:build-box"))?.status).toBeNull();
    });

    it("a stopped server and an unreachable machine are both answers, not errors", async () => {
      await boot({ probe: async () => ({ state: { kind: "stopped" }, machineId: null }) });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      await admin.post("/api/projects/default_project/machines/probe");
      expect((await byId("ssh:nas"))?.status).toMatchObject({ state: "stopped" });
      expect((await byId("ssh:nas"))?.status?.port).toBeUndefined();

      await boot({
        probe: async () => ({
          state: { kind: "unreachable", detail: "Permission denied (publickey)." },
          machineId: null,
        }),
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      await admin.post("/api/projects/default_project/machines/probe");
      expect((await byId("ssh:nas"))?.status).toMatchObject({
        state: "unreachable",
        detail: "Permission denied (publickey).",
      });
    });

    it("two probe requests at once share one round: each machine is asked once", async () => {
      let probes = 0;
      await boot({
        probe: async () => {
          probes++;
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { state: { kind: "stopped" as const }, machineId: null };
        },
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      probes = 0;
      // Two tabs, one Project: the second asker joins the round the first started.
      await Promise.all([
        admin.post("/api/projects/default_project/machines/probe"),
        admin.post("/api/projects/default_project/machines/probe"),
      ]);
      expect(probes).toBe(1);
      // A round that has settled is not reused: the next ask is a fresh one.
      await admin.post("/api/projects/default_project/machines/probe");
      expect(probes).toBe(2);
    });

    it("refuses to install onto this very machine", async () => {
      await boot();
      const res = await admin.post("/api/projects/default_project/machines/local/install");
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("self_install");
      expect(t.deps.machines.job()).toBeNull();
    });
  });

  describe("putting a new build into service", () => {
    it("restarts a machine whose server was running, so the installed build is the running one", async () => {
      const calls: string[] = [];
      await boot({
        probe: async () => ({ state: { kind: "running", port: 7364, pid: 99 }, machineId: null }),
        stopServer: async () => {
          calls.push("stop");
          return { ok: true as const };
        },
        startServer: async (_t, port) => {
          calls.push(`start:${port}`);
          return { ok: true };
        },
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toMatchObject({ ok: true, installed: "installed" });
      expect(calls).toEqual(["stop", "start:7364"]);
      expect(t.deps.machines.job()?.log.join(" ")).toContain("Stopping its server");
    });

    it("leaves a machine that was NOT running down — installing is not a decision to serve", async () => {
      const calls: string[] = [];
      await boot({
        probe: async () => ({ state: { kind: "stopped" }, machineId: null }),
        stopServer: async () => {
          calls.push("stop");
          return { ok: true as const };
        },
        startServer: async () => {
          calls.push("start");
          return { ok: true };
        },
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(calls).toEqual([]);
      expect(t.deps.machines.job()?.log.join(" ")).toContain("was not running");
    });

    it("does not restart when nothing was sent — an unchanged version is a no-op", async () => {
      const calls: string[] = [];
      await boot({
        install: async () => ({ kind: "already-installed", version: "9.9.9", identity: IDENTITY }),
        probe: async () => ({ state: { kind: "running", port: 7364, pid: 99 }, machineId: null }),
        stopServer: async () => {
          calls.push("stop");
          return { ok: true as const };
        },
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(calls).toEqual([]);
    });

    it("says so when the server does not come back, instead of reporting a clean install", async () => {
      await boot({
        probe: async () => ({ state: { kind: "running", port: 7364, pid: 99 }, machineId: null }),
        startServer: async () => ({ ok: false, detail: "port 7364 already in use" }),
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.log.join(" ")).toContain("did not come back up");
    });
  });

  describe("connecting", () => {
    /** An install this server did earlier, so the machine is one connect() accepts. */
    const installed = (version: string) =>
      machinesRepo.patch("ssh:nas", { version, installedAt: "2026-08-01T00:00:00.000Z" });

    it("a live connection to a dead server is not 'connected': connect asks the machine and starts it", async () => {
      // The loop this guards: the connection is an ssh process on THIS side and outlives the
      // far server. Connect used to answer "Already connected" on the connection's word alone,
      // so the one job that could have started the dead server never did — and every caller
      // that found the machine silent asked for another connect, forever.
      const starts: number[] = [];
      let up = false;
      await boot({
        probe: async () =>
          up
            ? { state: { kind: "running" as const, port: 7364, pid: 4242 }, machineId: null }
            : { state: { kind: "stopped" as const }, machineId: null },
        startServer: async (_t, port) => {
          starts.push(port);
          up = true;
          return { ok: true };
        },
      });
      installed("9.9.9");
      // A connection that is up, to a server that probes as stopped.
      connected.add("ssh:nas");
      machinesRepo.patch("ssh:nas", { remotePort: 7364 });
      await admin.post("/api/projects/default_project/machines/ssh:nas/connect");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toEqual({ ok: true, connected: true });
      expect(starts).toEqual([7364]);
      expect(t.deps.machines.job()?.log.join(" ")).toContain("Starting its server");
    });

    it("reconnecting over a live connection to an answering server starts nothing new", async () => {
      // hold() is idempotent in the transport: it promotes the session in place. What must
      // not happen is a start — the server is up — and the record must name the held session.
      const starts: number[] = [];
      let holds = 0;
      await boot({
        startServer: async (_t, port) => {
          starts.push(port);
          return { ok: true };
        },
        hold: async () => {
          holds++;
          return { ok: true, session: { pid: process.pid, socksPort: 1 } };
        },
      });
      installed("9.9.9");
      connected.add("ssh:nas");
      machinesRepo.patch("ssh:nas", { remotePort: 7364 });
      await admin.post("/api/projects/default_project/machines/ssh:nas/connect");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toEqual({ ok: true, connected: true });
      expect(starts).toEqual([]);
      expect(holds).toBe(1);
      expect(machinesRepo.get("ssh:nas")?.sessionPid).toBe(process.pid);
    });

    it("a connect's own probes are the machine's status: it does not read as stopped until the next round", async () => {
      let up = false;
      await boot({
        probe: async () =>
          up
            ? {
                state: { kind: "running" as const, port: 7364, pid: 4242 },
                machineId: "LNrJdHAZJ91G58i0",
              }
            : { state: { kind: "stopped" as const }, machineId: null },
        startServer: async () => {
          up = true;
          return { ok: true };
        },
      });
      installed("9.9.9");
      await admin.post("/api/projects/default_project/machines/ssh:nas/connect");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toEqual({ ok: true, connected: true });
      const nas = (
        (await (await admin.get(`/api/projects/${PROJECT}/machines`)).json()) as MachinesResponse
      ).machines.find((m) => m.id === "ssh:nas");
      expect(nas?.status).toMatchObject({ state: "running", port: 7364 });
      expect(nas?.machineId).toBe("LNrJdHAZJ91G58i0");
      expect(nas?.connection).not.toBeNull();
    });

    it("refuses, from what it just heard, an alias that answers this server's own id", async () => {
      // Never probed before, so the record could not refuse it; the probe inside the job can.
      let holds = 0;
      await boot({
        probe: async () => ({
          state: { kind: "running" as const, port: 7364, pid: 1 },
          machineId: LOCAL_ID,
        }),
        hold: async () => {
          holds++;
          return { ok: true, session: { pid: process.pid, socksPort: 1 } };
        },
      });
      installed("9.9.9");
      await admin.post("/api/projects/default_project/machines/ssh:nas/connect");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toMatchObject({ ok: false, step: "connect" });
      expect((t.deps.machines.job()?.result as { message: string }).message).toContain(
        "this server's own id",
      );
      expect(holds).toBe(0);
    });

    it("409s a Windows machine up front: there is no shell to hold a session on", async () => {
      await boot();
      installed("9.9.9");
      machinesRepo.patch("ssh:nas", { platform: "win32" });
      const res = await admin.post("/api/projects/default_project/machines/ssh:nas/connect");
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "connect_unsupported",
      );
      expect(t.deps.machines.job()).toBeNull();
    });

    it("start() re-holds what the record says was held, and only that", async () => {
      const heldNow: string[] = [];
      await boot({
        hold: async (target) => {
          heldNow.push(target.alias);
          connected.add(`ssh:${target.alias}`);
          return { ok: true, session: { pid: process.pid, socksPort: 1 } };
        },
      });
      // nas was held by the generation before; build-box was installed on but never asked
      // for, and a Windows host has nothing to hold.
      machinesRepo.patch("ssh:nas", {
        version: "9.9.9",
        installedAt: "2026-08-01T00:00:00.000Z",
        sessionPid: 424242,
        remotePort: 7364,
      });
      machinesRepo.patch("ssh:build-box", {
        version: "9.9.9",
        installedAt: "2026-08-01T00:00:00.000Z",
        sessionPid: null,
      });
      await t.deps.machines.start();
      expect(heldNow).toEqual(["nas"]);
      expect(machinesRepo.get("ssh:nas")?.sessionPid).toBe(process.pid);
      expect(t.deps.machines.list(PROJECT).find((m) => m.id === "ssh:nas")?.connection).toEqual({
        pid: process.pid,
      });
    });

    it("disconnect clears the record, so a later boot leaves the machine alone", async () => {
      const heldNow: string[] = [];
      await boot({
        hold: async (target) => {
          heldNow.push(target.alias);
          connected.add(`ssh:${target.alias}`);
          return { ok: true, session: { pid: process.pid, socksPort: 1 } };
        },
      });
      installed("9.9.9");
      await admin.post("/api/projects/default_project/machines/ssh:nas/connect");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(machinesRepo.get("ssh:nas")?.sessionPid).toBe(process.pid);

      await admin.post("/api/projects/default_project/machines/ssh:nas/disconnect");
      connected.delete("ssh:nas");
      expect(machinesRepo.get("ssh:nas")?.sessionPid).toBeNull();
      heldNow.length = 0;
      await t.deps.machines.start();
      expect(heldNow).toEqual([]);
    });
  });

  describe("syncing models outward", () => {
    /** A machine's server: counts what it is asked, and can be made slow. */
    const machineServer = async (opts: { delayMs: number }) => {
      const asked: string[] = [];
      const server = http.createServer((req, res) => {
        asked.push(`${req.method} ${req.url}`);
        setTimeout(() => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            req.url === "/api/projects"
              ? JSON.stringify({ projects: [{ projectId: PROJECT }] })
              : JSON.stringify({ models: [] }),
          );
        }, opts.delayMs);
      });
      const port = await new Promise<number>((resolve) =>
        server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
      );
      return { asked, port, close: () => server.close() };
    };

    it("an edit that lands while a sync is in flight is written afterwards, once — not dropped", async () => {
      const remote = await machineServer({ delayMs: 60 });
      try {
        await boot({
          loadConfig: async () =>
            ({
              models: [{ provider: "deepseek", model_id: "deepseek-v4-flash", api_key: "sk-x" }],
            }) as never,
        });
        machinesRepo.patch("ssh:nas", {
          version: "9.9.9",
          installedAt: "2026-08-01T00:00:00.000Z",
          remotePort: remote.port,
        });
        machinesRepo.setMembers(PROJECT, ["ssh:nas"]);
        connected.add("ssh:nas");

        // Three edits in a burst: the first starts a sync, the next two land during it.
        const first = t.deps.machines.syncModelsEverywhere(PROJECT);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const second = t.deps.machines.syncModelsEverywhere(PROJECT);
        const third = t.deps.machines.syncModelsEverywhere(PROJECT);
        await Promise.all([first, second, third]);
        // Give the trailing run its own round trips.
        await waitFor(() => remote.asked.filter((a) => a.startsWith("PUT")).length >= 2);

        const puts = remote.asked.filter((a) => a.startsWith("PUT"));
        // Exactly two writes: the one in flight, and ONE trailing run for everything that
        // arrived during it — the config is read fresh then, so the last edit is what lands.
        expect(puts).toHaveLength(2);
      } finally {
        remote.close();
      }
    });
  });

  describe("browsing a machine's directories", () => {
    const ID = "LNrJdHAZJ91G58i0";
    /** A machine this server holds a connection to, whose id a probe has heard. */
    const connectedMachine = () => {
      machinesRepo.patch("ssh:nas", {
        version: "9.9.9",
        installedAt: "2026-08-01T00:00:00.000Z",
        machineId: ID,
        remotePort: 7364,
      });
      connected.add("ssh:nas");
    };
    const listing = (stdout: string) => async (_t: unknown, command: string) =>
      command.includes("---penguin-dirs---")
        ? { code: 0, stdout, stderr: "", timedOut: false }
        : {
            code: 0,
            stdout: "---penguin-auth-token---\nremote-token\n",
            stderr: "",
            timedOut: false,
          };

    it("lists the subdirectories at the path the machine resolved, parent included", async () => {
      const asked: string[] = [];
      await boot({
        runOn: async (_t, command) => {
          asked.push(command);
          return listing("/home/deploy/work\n---penguin-dirs---\nsrc\nnotes\n")(_t, command);
        },
      });
      connectedMachine();
      const res = await admin.get(`/api/projects/${PROJECT}/machines/${ID}/dirs?path=~/work`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        path: "/home/deploy/work",
        parent: "/home/deploy",
        entries: [
          { name: "notes", path: "/home/deploy/work/notes" },
          { name: "src", path: "/home/deploy/work/src" },
        ],
      });
      // The path went to the machine quoted, so a name with a space is one argument there.
      expect(asked.find((c) => c.includes("---penguin-dirs---"))).toContain("'~/work'");
    });

    it("404s a directory the machine does not have", async () => {
      await boot({
        runOn: async (_t, command) =>
          command.includes("---penguin-dirs---")
            ? { code: 3, stdout: "", stderr: "", timedOut: false }
            : { code: 0, stdout: "", stderr: "", timedOut: false },
      });
      connectedMachine();
      const res = await admin.get(`/api/projects/${PROJECT}/machines/${ID}/dirs?path=/nope`);
      expect(res.status).toBe(404);
    });

    it("404s a machine that is not connected, and asks it nothing — a read never opens ssh", async () => {
      const asked: string[] = [];
      await boot({
        runOn: async (_t, command) => {
          asked.push(command);
          return { code: 0, stdout: "", stderr: "", timedOut: false };
        },
      });
      connectedMachine();
      connected.delete("ssh:nas");
      const res = await admin.get(`/api/projects/${PROJECT}/machines/${ID}/dirs`);
      expect(res.status).toBe(404);
      expect(asked).toEqual([]);
    });

    it("speaks through the alias that holds the session when two aliases share one machine", async () => {
      const asked: string[] = [];
      await boot({
        runOn: async (target, command) => {
          asked.push(target.alias);
          return listing("/home/deploy\n---penguin-dirs---\n")(target, command);
        },
      });
      // Both aliases answered the same id; only build-box is connected.
      machinesRepo.patch("ssh:nas", {
        machineId: ID,
        version: "9.9.9",
        installedAt: "2026-08-02T00:00:00.000Z",
      });
      machinesRepo.patch("ssh:build-box", {
        machineId: ID,
        version: "9.9.9",
        installedAt: "2026-08-01T00:00:00.000Z",
      });
      connected.add("ssh:build-box");
      const res = await admin.get(`/api/projects/${PROJECT}/machines/${ID}/dirs`);
      expect(res.status).toBe(200);
      expect(asked).toEqual(["build-box"]);
    });
  });

  describe("the api sighting", () => {
    const REMOTE = "kUkIyqU-1GOfXgKD";
    const nas = async () =>
      (
        (await (
          await admin.get("/api/projects/default_project/machines")
        ).json()) as MachinesResponse
      ).machines.find((m) => m.id === "ssh:nas");

    it("is stamped by the proxy's report and served with the list, by machine id", async () => {
      await boot();
      machinesRepo.patch("ssh:nas", { machineId: REMOTE });
      expect((await nas())?.api).toBeNull();
      t.deps.machines.noteApiSeen(REMOTE, { ok: true });
      expect((await nas())?.api).toEqual({ answeredAt: "2026-08-24T12:00:00.000Z" });
      t.deps.machines.noteApiSeen(REMOTE, { ok: false, detail: "connect ECONNREFUSED" });
      expect((await nas())?.api).toEqual({
        failedAt: "2026-08-24T12:00:00.000Z",
        detail: "connect ECONNREFUSED",
      });
    });

    it("a sighting of a machine no row names lands nowhere, and does not throw", async () => {
      await boot();
      t.deps.machines.noteApiSeen("nobody-knows-this", { ok: true });
      expect((await nas())?.api).toBeNull();
    });
  });

  describe("machine identity", () => {
    const ID = "LNrJdHAZJ91G58i0";
    const listed = async () =>
      (
        (await (
          await admin.get("/api/projects/default_project/machines")
        ).json()) as MachinesResponse
      ).machines;
    const byId = async (id: string) => (await listed()).find((machine) => machine.id === id);

    it("mints this machine's id once and keeps answering with it", async () => {
      await boot();
      const db = openDatabase(path.join(machinesRoot, "machine-id.db"));
      try {
        const minted = new MachinesRepo(db).ownId();
        expect(minted).toMatch(/^[A-Za-z0-9_-]{16}$/);
        expect(new MachinesRepo(db).ownId()).toBe(minted);
      } finally {
        db.close();
      }
    });

    it("reports it as this machine's own, alongside the machines it reaches", async () => {
      await boot();
      expect((await byId("local"))?.machineId).toBe(LOCAL_ID);
    });

    it("a remote's id is null until a probe has heard it", async () => {
      await boot();
      expect((await byId("ssh:nas"))?.machineId).toBeNull();
    });

    it("a probe learns it, and it is remembered without another round trip", async () => {
      await boot({
        probe: async () => ({ state: { kind: "running", port: 7364, pid: 1 }, machineId: ID }),
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      await admin.post("/api/projects/default_project/machines/probe");
      expect((await byId("ssh:nas"))?.machineId).toBe(ID);

      const reborn = new MachinesService(machinesRoot, LOCAL_ID, machinesRepo, effects());
      expect(reborn.list("default_project").find((m) => m.id === "ssh:nas")?.machineId).toBe(ID);
    });

    it("a restart records the id the machine minted when it came back", async () => {
      // A machine mints its id when a server that mints one starts there, so a restart can be
      // the moment an identity comes into existence. Until this side has heard it the machine
      // is addressable by nothing — the proxy cannot route to it and the workspace picker
      // will not offer it — so the restart asks rather than leaving it to the next probe.
      let id: string | null = null;
      await boot({
        // Already carrying this build, so the install path never restarts it: the explicit
        // restart below is the only thing that brings a new process — and its id — up.
        install: async () => ({ kind: "already-installed", version: "9.9.9", identity: IDENTITY }),
        probe: async () => ({ state: { kind: "running", port: 7364, pid: 1 }, machineId: id }),
        stopServer: async () => {
          id = ID; // It minted one on the way back up.
          return { ok: true as const };
        },
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect((await byId("ssh:nas"))?.machineId).toBeNull();

      await admin.post("/api/projects/default_project/machines/ssh:nas/restart");
      await waitFor(() => t.deps.machines.job()?.kind === "restart");
      await waitFor(() => t.deps.machines.job()?.running === false);

      expect(t.deps.machines.job()?.result).toMatchObject({ ok: true });
      expect((await byId("ssh:nas"))?.machineId).toBe(ID);
    });

    it("a machine whose server never started stays without one", async () => {
      await boot({ probe: async () => ({ state: { kind: "stopped" }, machineId: null }) });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      await admin.post("/api/projects/default_project/machines/probe");
      expect((await byId("ssh:nas"))?.status).toMatchObject({ state: "stopped" });
      expect((await byId("ssh:nas"))?.machineId).toBeNull();
    });

    it("an alias repointed at a different machine takes the newer id, and forgets the old one", async () => {
      let id = ID;
      await boot({
        probe: async () => ({ state: { kind: "running", port: 7364, pid: 1 }, machineId: id }),
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      await admin.post("/api/projects/default_project/machines/probe");
      expect((await byId("ssh:nas"))?.machineId).toBe(ID);
      expect(machinesRepo.get("ssh:nas")?.version).not.toBeNull();

      id = "PO_VCwpQrw1hQLV-";
      await admin.post("/api/projects/default_project/machines/probe");
      expect((await byId("ssh:nas"))?.machineId).toBe(id);
      // What the row held was learned from the machine no longer at this address. Kept, the
      // newcomer would read as already installed at a build it has never run — and an
      // "already installed" record is what suppresses the install that would correct it.
      const row = machinesRepo.get("ssh:nas");
      expect(row?.version).toBeNull();
      expect(row?.installedAt).toBeNull();
      expect(row?.platform).toBeNull();
      expect(row?.remotePort).toBeNull();
      expect((await byId("ssh:nas"))?.installed).toBeNull();
    });
  });

  describe("refusals decided before any ssh runs", () => {
    it("409s an install through an alias a probe has already heard this machine's id from", async () => {
      await boot();
      machinesRepo.patch("ssh:nas", { machineId: LOCAL_ID });
      const res = await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/install`);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("self_install");
      expect(t.deps.machines.job()).toBeNull();
    });

    it("409s a second install while one is running", async () => {
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await boot({
        install: async () => {
          await held;
          return { kind: "installed", output: "", identity: IDENTITY };
        },
      });
      expect(
        (await admin.post("/api/projects/default_project/machines/ssh:nas/install")).status,
      ).toBe(202);
      const second = await admin.post(
        "/api/projects/default_project/machines/ssh:build-box/install",
      );
      expect(second.status).toBe(409);
      expect(((await second.json()) as { error: { code: string } }).error.code).toBe(
        "install_running",
      );
      release();
      await waitFor(() => t.deps.machines.job()?.running === false);
    });

    it("404s a host this server's config does not declare", async () => {
      await boot();
      const res = await admin.post(
        "/api/projects/default_project/machines/ssh:not-in-config/install",
      );
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "unknown_machine",
      );
      expect(t.deps.machines.job()).toBeNull();
    });

    it("409s when this server carries no install image", async () => {
      await boot({ resolvePlan: () => null });
      const res = await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "no_install_image",
      );
    });
  });
});

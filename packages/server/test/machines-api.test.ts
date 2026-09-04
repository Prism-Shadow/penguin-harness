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

/** Every route is under a Project now; the seeded one every server has. */
const PROJECT = "default_project";

/** This machine's id. Minted from the `machine` table in the real server; fixed here. */
const LOCAL_ID = "TESTlocalID00000";

const IDENTITY: RemoteIdentity = {
  platform: "linux",
  arch: "x64",
  installedVersion: null,
  harness: null,
};

/** An effects set that names two hosts and installs successfully, with the parts a test cares about overridden. */
function effects(over: Partial<MachinesEffects> = {}): Partial<MachinesEffects> {
  return {
    listAliases: () => ["build-box", "nas"],
    resolvePlan: () => ({ baseVersion: "9.9.9", harness: null, hmrDir: null, version: "9.9.9" }),
    now: () => new Date("2026-08-24T12:00:00.000Z"),
    // An install asks the machine who it is before writing anything; a host with nothing on
    // it yet answers stopped with no id, which is the shape that refuses nothing.
    probe: async () => ({ state: { kind: "stopped" as const }, machineId: null }),
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
  /** The service's own data root — where the pushable image would live. */
  let machinesRoot: string;
  /** The store the service records installs and memberships in; this suite reads it back. */
  let machinesRepo: MachinesRepo;
  let store: DatabaseSync;

  const boot = async (over: Partial<MachinesEffects> = {}) => {
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
      expect((await member.get(`/api/projects/${PROJECT}/machines`)).status).toBe(403);
      expect((await member.post(`/api/projects/${PROJECT}/machines/ssh:nas/install`)).status).toBe(
        403,
      );
    });

    it("needs a session at all", async () => {
      expect((await t.app.request(`/api/projects/${PROJECT}/machines`)).status).toBe(401);
    });
  });

  describe("the list", () => {
    it("is the ssh config's aliases, with the version this server would push", async () => {
      await boot();
      const body = (await (
        await admin.get(`/api/projects/${PROJECT}/machines`)
      ).json()) as MachinesResponse;
      // This machine leads the list: always present, always up, never a target.
      expect(body.machines[0]).toMatchObject({
        id: "local",
        local: true,
        machineId: LOCAL_ID,
        status: { state: "running" },
      });
      expect(body.machines.slice(1)).toEqual([
        {
          id: "ssh:build-box",
          alias: "build-box",
          machineId: null,
          installed: null,
          local: false,
          status: null,
        },
        {
          id: "ssh:nas",
          alias: "nas",
          machineId: null,
          installed: null,
          local: false,
          status: null,
        },
      ]);
      expect(body.imageVersion).toBe("9.9.9");
      expect(body.job).toBeNull();
    });

    it("an empty or unreadable ssh config is a list of none, not an error", async () => {
      await boot({ listAliases: () => [] });
      const res = await admin.get(`/api/projects/${PROJECT}/machines`);
      expect(res.status).toBe(200);
      // Not empty: this machine is always in the list, whatever the config says.
      expect(((await res.json()) as MachinesResponse).machines.map((m) => m.id)).toEqual(["local"]);
    });

    it("reports no image when this server has none to push", async () => {
      await boot({ resolvePlan: () => null });
      const body = (await (
        await admin.get(`/api/projects/${PROJECT}/machines`)
      ).json()) as MachinesResponse;
      expect(body.imageVersion).toBeNull();
    });
  });

  describe("installing", () => {
    it("starts a job, narrates it, and finishes", async () => {
      // Held open so the 202 is observed mid-flight, which is the real shape: a push takes
      // minutes, and the page has to render a running job from this very body.
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
      const started = await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/install`);
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
        await admin.get(`/api/projects/${PROJECT}/machines`)
      ).json()) as MachinesResponse;
      expect(body.job?.result).toEqual({ ok: true, kind: "installed", version: "9.9.9" });
      // The first line is this server's own, the rest are the push's.
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
      await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/install`);
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
      await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/install`);
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toEqual({
        ok: true,
        kind: "already-installed",
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
      // Before the install nothing was known (null); after it the probe speaks cmd.exe.
      await admin.post(`/api/projects/${PROJECT}/machines/probe`);
      expect(dialects).toEqual([null, "win32"]);
    });

    it("a throw from the push path still ends the job", async () => {
      await boot({
        install: () => {
          throw new Error("scp vanished");
        },
      });
      await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/install`);
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toMatchObject({ ok: false, message: "scp vanished" });
    });
  });

  describe("what stays installed", () => {
    /** GET /api/machines, as the page reads it. */
    const listed = async () =>
      ((await (await admin.get(`/api/projects/${PROJECT}/machines`)).json()) as MachinesResponse)
        .machines;

    it("a successful install is remembered, and is already visible on the first settled poll", async () => {
      await boot();
      await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/install`);
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
      await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/install`);
      await waitFor(() => t.deps.machines.job()?.running === false);

      // A new instance has no job and no memory — only the file. This is the restart case,
      // and the hot-push case: the App is rebuilt, the data root is not.
      const reborn = new MachinesService(machinesRoot, LOCAL_ID, machinesRepo, effects());
      expect(reborn.job()).toBeNull();
      expect(reborn.list(PROJECT).find((m) => m.id === "ssh:nas")?.installed).toEqual({
        version: "9.9.9",
        at: "2026-08-24T12:00:00.000Z",
      });
    });

    it("belongs to the Project that installed it, and to no other", async () => {
      await boot();
      await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/install`);
      await waitFor(() => t.deps.machines.job()?.running === false);

      // Another Project sees the same host as installed-but-not-mine: an adoption, not an
      // install. The record is one machine's, the membership is per Project.
      const other = t.deps.machines.list("other_project").find((m) => m.id === "ssh:nas");
      expect(other?.installed).toBeNull();
      expect(other?.elsewhere).toEqual({ version: "9.9.9", at: "2026-08-24T12:00:00.000Z" });
    });

    it("release drops the membership and leaves the install alone", async () => {
      await boot();
      await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/install`);
      await waitFor(() => t.deps.machines.job()?.running === false);

      const body = (await (
        await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/release`)
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
      await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/install`);
      await waitFor(() => t.deps.machines.job()?.running === false);
      await admin.post(`/api/projects/${PROJECT}/machines/ssh:build-box/install`);
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
      await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/install`);
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
      await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/install`);
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect((await listed()).filter((m) => !m.local).every((m) => m.installed === null)).toBe(
        true,
      );
      expect(recordsInStore()).toEqual({});
    });
  });

  describe("asking the machines what they are doing", () => {
    /** A machine that answers `penguin server status` with the JSON below. */
    const answering = (o: Record<string, unknown>) =>
      ({
        probe: async () => {
          const status = o as { running?: boolean; port?: number; pid?: number };
          return {
            state:
              status.running === true
                ? { kind: "running" as const, port: status.port!, pid: status.pid! }
                : { kind: "stopped" as const },
            machineId: (o.machineId as string | null) ?? null,
          };
        },
      }) satisfies Partial<MachinesEffects>;

    it("probes only the machines this Project installed on, and keeps the answer", async () => {
      await boot(answering({ running: true, port: 7364, pid: 42, machineId: "LNrJdHAZJ91G58i0" }));
      await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/install`);
      await waitFor(() => t.deps.machines.job()?.running === false);

      const body = (await (
        await admin.post(`/api/projects/${PROJECT}/machines/probe`)
      ).json()) as MachinesResponse;
      const nas = body.machines.find((m) => m.id === "ssh:nas");
      expect(nas?.status).toMatchObject({ state: "running", port: 7364 });
      // build-box was never installed on, so nothing was asked of it.
      expect(body.machines.find((m) => m.id === "ssh:build-box")?.status).toBeNull();
    });

    it("remembers the id a machine answered, so later reads point at the machine", async () => {
      await boot(answering({ running: true, port: 7364, pid: 42, machineId: "LNrJdHAZJ91G58i0" }));
      await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/install`);
      await waitFor(() => t.deps.machines.job()?.running === false);
      await admin.post(`/api/projects/${PROJECT}/machines/probe`);

      expect(machinesRepo.get("ssh:nas")?.machineId).toBe("LNrJdHAZJ91G58i0");
    });

    it("an alias repointed at another host answers a different id, and the newer one wins", async () => {
      // An id never changes for a machine, so a change of id is a change of machine.
      let answers = "first00000000000";
      await boot({
        probe: async () => ({
          state: { kind: "running" as const, port: 7364, pid: 42 },
          machineId: answers,
        }),
      });
      await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/install`);
      await waitFor(() => t.deps.machines.job()?.running === false);
      await admin.post(`/api/projects/${PROJECT}/machines/probe`);
      expect(machinesRepo.get("ssh:nas")?.machineId).toBe("first00000000000");
      expect(machinesRepo.get("ssh:nas")?.version).not.toBeNull();

      answers = "second0000000000";
      await admin.post(`/api/projects/${PROJECT}/machines/probe`);
      const row = machinesRepo.get("ssh:nas");
      expect(row?.machineId).toBe("second0000000000");
      // What the row knew was learned from the machine that is no longer at this address.
      // Kept, the newcomer would read as already installed at a build it has never run —
      // and an "already installed" record is exactly what suppresses the install that would
      // have corrected it.
      expect(row?.version).toBeNull();
      expect(row?.installedAt).toBeNull();
      expect(row?.platform).toBeNull();
      expect(row?.remotePort).toBeNull();

      const body = (await (
        await admin.get(`/api/projects/${PROJECT}/machines`)
      ).json()) as MachinesResponse;
      expect(body.machines.find((m) => m.id === "ssh:nas")?.installed).toBeNull();
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
      await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/install`);
      await waitFor(() => t.deps.machines.job()?.running === false);
      probes = 0;
      // Two tabs, one Project: the second asker joins the round the first started.
      await Promise.all([
        admin.post(`/api/projects/${PROJECT}/machines/probe`),
        admin.post(`/api/projects/${PROJECT}/machines/probe`),
      ]);
      expect(probes).toBe(1);
      // A round that has settled is not reused: the next ask is a fresh one.
      await admin.post(`/api/projects/${PROJECT}/machines/probe`);
      expect(probes).toBe(2);
    });

    it("a machine with no server yet has no id, and says stopped rather than guessing", async () => {
      await boot(answering({ running: false, machineId: null }));
      await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/install`);
      await waitFor(() => t.deps.machines.job()?.running === false);

      const body = (await (
        await admin.post(`/api/projects/${PROJECT}/machines/probe`)
      ).json()) as MachinesResponse;
      const nas = body.machines.find((m) => m.id === "ssh:nas");
      expect(nas?.status?.state).toBe("stopped");
      expect(nas?.machineId).toBeNull();
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

    it("409s an install onto the machine this server runs on", async () => {
      await boot();
      const res = await admin.post(`/api/projects/${PROJECT}/machines/local/install`);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("self_install");
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
      expect((await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/install`)).status).toBe(
        202,
      );
      const second = await admin.post(`/api/projects/${PROJECT}/machines/ssh:build-box/install`);
      expect(second.status).toBe(409);
      expect(((await second.json()) as { error: { code: string } }).error.code).toBe(
        "install_running",
      );
      release();
      await waitFor(() => t.deps.machines.job()?.running === false);
    });

    it("404s a host this server's config does not declare", async () => {
      await boot();
      const res = await admin.post(`/api/projects/${PROJECT}/machines/ssh:not-in-config/install`);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "unknown_machine",
      );
      expect(t.deps.machines.job()).toBeNull();
    });

    it("409s when this server carries no install image", async () => {
      await boot({ resolvePlan: () => null });
      const res = await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/install`);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "no_install_image",
      );
    });
  });
});

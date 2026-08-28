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
    resolveTarget: async (alias) => ({
      alias,
      settings: {
        user: "deploy",
        hostname: `${alias}.example`,
        port: 22,
        identityFiles: [],
        proxyJump: null,
      },
      machine: `deploy@${alias}`,
    }),
    resolvePlan: () => ({ baseVersion: "9.9.9", harness: null, hmrDir: null, version: "9.9.9" }),
    now: () => new Date("2026-08-24T12:00:00.000Z"),
    startServer: async () => ({ ok: true }),
    stopServer: async () => true,
    upgrade: async () => ({ kind: "upgraded", detail: "" }),
    runOn: async () => ({
      code: 0,
      stdout: "---penguin-auth-token---\nremote-token\n",
      stderr: "",
      timedOut: false,
    }),
    // A forward that reads as live: `process.pid` because liveness is checked against the
    // real process table, so a made-up pid would (correctly) read as a dead forward.
    forward: async () => ({ ok: true, port: 7364, pid: process.pid }),
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

  const boot = async (over: Partial<MachinesEffects> = {}) => {
    machinesRoot = await makeTempRoot();
    machinesRepo = new MachinesRepo(openDatabase(":memory:"));
    t = await createTestApp({
      machines: new MachinesService(machinesRoot, LOCAL_ID, machinesRepo, effects(over)),
    });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  };

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
          connected: false,
          status: null,
        },
        {
          id: "ssh:nas",
          alias: "nas",
          machineId: null,
          installed: null,
          local: false,
          connected: false,
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
      expect(body.job?.log[0]).toBe("Installing 9.9.9 on deploy@nas…");
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
      });
      expect((t.deps.machines.job()?.result as { message: string }).message).toContain(
        "no business capabilities",
      );
    });

    it("will not hot-update a machine with nothing running on it, and says which it was", async () => {
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
      expect((t.deps.machines.job()?.result as { message: string }).message).toContain(
        "no server is running",
      );
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

    it("an alias ssh can no longer resolve is unreachable, and costs no probe", async () => {
      let probes = 0;
      let resolvable = true;
      await boot({
        resolveTarget: async (alias) =>
          resolvable
            ? {
                alias,
                settings: {
                  user: "deploy",
                  hostname: `${alias}.example`,
                  port: 22,
                  identityFiles: [],
                  proxyJump: null,
                },
                machine: `deploy@${alias}`,
              }
            : null,
        probe: async () => {
          probes++;
          return { state: { kind: "running", port: 7364, pid: 1 }, machineId: null };
        },
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      probes = 0;

      resolvable = false;
      await admin.post("/api/projects/default_project/machines/probe");
      expect((await byId("ssh:nas"))?.status).toMatchObject({ state: "unreachable" });
      expect(probes).toBe(0);
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
          return true;
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
      expect(t.deps.machines.job()?.log.join(" ")).toContain("Restarting its server");
    });

    it("leaves a machine that was NOT running down — installing is not a decision to serve", async () => {
      const calls: string[] = [];
      await boot({
        probe: async () => ({ state: { kind: "stopped" }, machineId: null }),
        stopServer: async () => {
          calls.push("stop");
          return true;
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
          return true;
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

    it("a machine whose server never started stays without one", async () => {
      await boot({ probe: async () => ({ state: { kind: "stopped" }, machineId: null }) });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      await admin.post("/api/projects/default_project/machines/probe");
      expect((await byId("ssh:nas"))?.status).toMatchObject({ state: "stopped" });
      expect((await byId("ssh:nas"))?.machineId).toBeNull();
    });

    it("an alias repointed at a different machine takes the newer id", async () => {
      let id = ID;
      await boot({
        probe: async () => ({ state: { kind: "running", port: 7364, pid: 1 }, machineId: id }),
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      await admin.post("/api/projects/default_project/machines/probe");
      expect((await byId("ssh:nas"))?.machineId).toBe(ID);

      id = "PO_VCwpQrw1hQLV-";
      await admin.post("/api/projects/default_project/machines/probe");
      expect((await byId("ssh:nas"))?.machineId).toBe(id);
    });
  });

  describe("refusals decided before any ssh runs", () => {
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

    it("502s a host ssh itself cannot resolve", async () => {
      await boot({ resolveTarget: async () => null });
      const res = await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      expect(res.status).toBe(502);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "unresolvable_host",
      );
    });
  });
});

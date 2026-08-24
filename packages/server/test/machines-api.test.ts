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

const IDENTITY: RemoteIdentity = {
  platform: "linux",
  arch: "x64",
  installedVersion: null,
  harness: null,
};

/**
 * A tunnel that reads as live. `process.pid` deliberately: tunnelPortFor checks the pid
 * against the real process table, so a made-up number would (correctly) read as a dead
 * tunnel and no origin — which is its own test further down.
 */
const liveTunnel = (port = 7364) => ({
  port,
  pid: process.pid,
  exited: () => false,
  stderr: () => "",
  close: () => {},
  detach: () => {},
});

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
    portBusy: async () => false,
    waitForHttp: async () => ({ ok: true }),
    openTunnel: () => ({
      port: 7364,
      pid: process.pid,
      exited: () => false,
      stderr: () => "",
      close: () => {},
      detach: () => {},
    }),
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

  const boot = async (over: Partial<MachinesEffects> = {}) => {
    machinesRoot = await makeTempRoot();
    t = await createTestApp({ machines: new MachinesService(machinesRoot, effects(over)) });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  };

  /** The records file as the service left it on disk. */
  const recordsOnDisk = (): unknown =>
    JSON.parse(fs.readFileSync(path.join(machinesRoot, "machines-installs.json"), "utf8"));

  afterEach(async () => {
    await t.cleanup();
    fs.rmSync(machinesRoot, { recursive: true, force: true });
  });

  describe("permission", () => {
    beforeEach(() => boot());

    it("is admin-only: a provisioned user gets 403", async () => {
      const user = await provisionUser(t.app, "member");
      const member = apiClient(t.app, user.cookie);
      expect((await member.get("/api/machines")).status).toBe(403);
      expect((await member.post("/api/machines/ssh:nas/install")).status).toBe(403);
    });

    it("needs a session at all", async () => {
      expect((await t.app.request("/api/machines")).status).toBe(401);
    });
  });

  describe("the list", () => {
    it("is the ssh config's aliases, with the version this server would push", async () => {
      await boot();
      const body = (await (await admin.get("/api/machines")).json()) as MachinesResponse;
      // This machine heads the list: always installed, always up, never a target.
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
          origin: null,
          status: null,
        },
        {
          id: "ssh:nas",
          alias: "nas",
          machineId: null,
          installed: null,
          local: false,
          origin: null,
          status: null,
        },
      ]);
      expect(body.imageVersion).toBe("9.9.9");
      expect(body.job).toBeNull();
    });

    it("an empty or unreadable ssh config leaves this machine alone in the list, not an error", async () => {
      await boot({ listAliases: () => [] });
      const res = await admin.get("/api/machines");
      expect(res.status).toBe(200);
      const machines = ((await res.json()) as MachinesResponse).machines;
      expect(machines.map((m) => m.id)).toEqual(["local"]);
    });

    it("reports no image when this server has none to push", async () => {
      await boot({ resolvePlan: () => null });
      const body = (await (await admin.get("/api/machines")).json()) as MachinesResponse;
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
      const started = await admin.post("/api/machines/ssh:nas/install");
      expect(started.status).toBe(202);
      expect(((await started.json()) as MachinesResponse).job).toMatchObject({
        machineId: "ssh:nas",
        alias: "nas",
        running: true,
        result: null,
      });

      release();
      await waitFor(() => t.deps.machines.job()?.running === false);
      const body = (await (await admin.get("/api/machines")).json()) as MachinesResponse;
      expect(body.job?.result).toEqual({ ok: true, kind: "installed", version: "9.9.9" });
      // The first line is this server's own, the rest are the push's.
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
      await admin.post("/api/machines/ssh:nas/install");
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
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toEqual({
        ok: true,
        kind: "already-installed",
        version: "9.9.9",
      });
    });

    it("a throw from the push path still ends the job", async () => {
      await boot({
        install: () => {
          throw new Error("scp vanished");
        },
      });
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toMatchObject({ ok: false, message: "scp vanished" });
    });
  });

  describe("what stays installed", () => {
    /** GET /api/machines, as the page reads it. */
    const listed = async () =>
      ((await (await admin.get("/api/machines")).json()) as MachinesResponse).machines;

    /** The ssh hosts only — the local entry is always installed, so it never belongs in these. */
    const remotes = async () => (await listed()).filter((machine) => !machine.local);

    it("a successful install is remembered, and is already visible on the first settled poll", async () => {
      await boot();
      await admin.post("/api/machines/ssh:nas/install");
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
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);

      // A new instance has no job and no memory — only the file. This is the restart case,
      // and the hot-push case: the App is rebuilt, the data root is not.
      const reborn = new MachinesService(machinesRoot, effects());
      expect(reborn.job()).toBeNull();
      expect(reborn.list().find((m) => m.id === "ssh:nas")?.installed).toEqual({
        version: "9.9.9",
        at: "2026-08-24T12:00:00.000Z",
      });
    });

    it("installing elsewhere does not erase the first machine", async () => {
      // The job is one slot, so before the records file existed this is exactly what made an
      // installed machine disappear: the second install overwrote the only evidence.
      await boot();
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      await admin.post("/api/machines/ssh:build-box/install");
      await waitFor(() => t.deps.machines.job()?.machineId === "ssh:build-box");
      await waitFor(() => t.deps.machines.job()?.running === false);

      const machines = await remotes();
      expect(machines.every((m) => m.installed !== null)).toBe(true);
      expect(recordsOnDisk()).toEqual({
        "ssh:nas": { version: "9.9.9", at: "2026-08-24T12:00:00.000Z" },
        "ssh:build-box": { version: "9.9.9", at: "2026-08-24T12:00:00.000Z" },
      });
    });

    it("records what the REMOTE already had when nothing needed sending", async () => {
      await boot({
        install: async () => ({ kind: "already-installed", version: "8.8.8", identity: IDENTITY }),
      });
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect((await listed()).find((m) => m.id === "ssh:nas")?.installed?.version).toBe("8.8.8");
    });

    it("a failed install records nothing", async () => {
      await boot({
        install: async () => ({ kind: "failed", step: "connect", detail: "no route to host" }),
      });
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect((await remotes()).every((m) => m.installed === null)).toBe(true);
      expect(fs.existsSync(path.join(machinesRoot, "machines-installs.json"))).toBe(false);
    });

    it("a damaged records file reads as nothing remembered, not as a broken list", async () => {
      await boot();
      fs.writeFileSync(path.join(machinesRoot, "machines-installs.json"), "{ not json");
      const machines = await remotes();
      expect(machines).toHaveLength(2);
      expect(machines.every((m) => m.installed === null)).toBe(true);
    });
  });

  describe("server status", () => {
    const listed = async () =>
      ((await (await admin.get("/api/machines")).json()) as MachinesResponse).machines;
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
      await admin.get("/api/machines");
      await admin.get("/api/machines");
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
      // Only nas gets an install; build-box has no server to ask about.
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      probed.length = 0;

      const res = await admin.post("/api/machines/probe");
      expect(res.status).toBe(200);
      expect(probed).toEqual(["nas"]);
      expect((await byId("ssh:nas"))?.status).toMatchObject({ state: "running", port: 7364 });
      expect((await byId("ssh:build-box"))?.status).toBeNull();
    });

    it("a stopped server and an unreachable machine are both answers, not errors", async () => {
      await boot({ probe: async () => ({ state: { kind: "stopped" }, machineId: null }) });
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      await admin.post("/api/machines/probe");
      expect((await byId("ssh:nas"))?.status).toMatchObject({ state: "stopped" });
      expect((await byId("ssh:nas"))?.status?.port).toBeUndefined();

      await boot({
        probe: async () => ({
          state: { kind: "unreachable", detail: "Permission denied (publickey)." },
          machineId: null,
        }),
      });
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      await admin.post("/api/machines/probe");
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
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);

      // The host disappears from ssh's view between the install and the refresh.
      resolvable = false;
      await admin.post("/api/machines/probe");
      expect((await byId("ssh:nas"))?.status).toMatchObject({ state: "unreachable" });
      // No ssh child at all: an alias ssh cannot name is a dead end before the probe.
      expect(probes).toBe(0);
    });

    it("refuses to install onto this very machine", async () => {
      await boot();
      const res = await admin.post("/api/machines/local/install");
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("self_install");
      expect(t.deps.machines.job()).toBeNull();
    });
  });

  describe("machine identity", () => {
    const ID = "LNrJdHAZJ91G58i0";
    const listed = async () =>
      ((await (await admin.get("/api/machines")).json()) as MachinesResponse).machines;
    const byId = async (id: string) => (await listed()).find((machine) => machine.id === id);

    it("this machine has an id of its own, minted into its data root", async () => {
      await boot();
      const local = await byId("local");
      expect(local?.machineId).toMatch(/^[A-Za-z0-9_-]{16}$/);
      expect(fs.readFileSync(path.join(machinesRoot, "machine-id"), "utf8").trim()).toBe(
        local?.machineId,
      );
      // Stable across reads: an identity, not a token.
      expect((await byId("local"))?.machineId).toBe(local?.machineId);
    });

    it("a remote's id is null until a probe has heard it", async () => {
      await boot();
      expect((await byId("ssh:nas"))?.machineId).toBeNull();
    });

    it("a probe learns it, and it is remembered without another round trip", async () => {
      await boot({
        probe: async () => ({ state: { kind: "running", port: 7364, pid: 1 }, machineId: ID }),
      });
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      await admin.post("/api/machines/probe");
      expect((await byId("ssh:nas"))?.machineId).toBe(ID);

      // A fresh service over the same data root — the restart case — still knows it, with
      // no probe at all.
      const reborn = new MachinesService(machinesRoot, effects());
      expect(reborn.list().find((m) => m.id === "ssh:nas")?.machineId).toBe(ID);
    });

    it("a machine whose server never started stays without one", async () => {
      // The id is minted by the server over there, so an installed-but-never-run machine
      // legitimately has none — reporting a made-up one would be worse than null.
      await boot({ probe: async () => ({ state: { kind: "stopped" }, machineId: null }) });
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      await admin.post("/api/machines/probe");
      expect((await byId("ssh:nas"))?.status).toMatchObject({ state: "stopped" });
      expect((await byId("ssh:nas"))?.machineId).toBeNull();
    });

    it("an alias repointed at a different machine takes the newer id", async () => {
      let id = ID;
      await boot({
        probe: async () => ({ state: { kind: "running", port: 7364, pid: 1 }, machineId: id }),
      });
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      await admin.post("/api/machines/probe");
      expect((await byId("ssh:nas"))?.machineId).toBe(ID);

      // Someone points `nas` at another host. An id never changes for a machine, so a
      // different answer means a different machine behind that alias.
      id = "PO_VCwpQrw1hQLV-";
      await admin.post("/api/machines/probe");
      expect((await byId("ssh:nas"))?.machineId).toBe(id);
    });
  });

  describe("connecting", () => {
    const listed = async () =>
      ((await (await admin.get("/api/machines")).json()) as MachinesResponse).machines;
    const byId = async (id: string) => (await listed()).find((machine) => machine.id === id);
    const connectJob = () => t.deps.machines.connectJob();

    /** Install first: connect refuses a machine with nothing on it. */
    const installed = async (id = "ssh:nas") => {
      await admin.post(`/api/machines/${id}/install`);
      await waitFor(() => t.deps.machines.job()?.running === false);
    };

    it("starts the remote server, opens a tunnel, and reports the origin", async () => {
      await boot();
      await installed();
      expect((await admin.post("/api/machines/ssh:nas/connect")).status).toBe(202);
      await waitFor(() => connectJob()?.running === false);
      expect(connectJob()?.result).toEqual({ ok: true, origin: "http://localhost:7364" });
      expect((await byId("ssh:nas"))?.origin).toBe("http://localhost:7364");
    });

    it("does not start a server that is already up, and keeps ITS port", async () => {
      let started = 0;
      await boot({
        probe: async () => ({ state: { kind: "running", port: 7401, pid: 9 }, machineId: null }),
        startServer: async () => {
          started++;
          return { ok: true };
        },
        openTunnel: (opts) => ({
          port: opts.port,
          pid: process.pid,
          exited: () => false,
          stderr: () => "",
          close: () => {},
          detach: () => {},
        }),
      });
      await installed();
      await admin.post("/api/machines/ssh:nas/connect");
      await waitFor(() => connectJob()?.running === false);
      // The remote is bound to 7401; both ends must use the same number.
      expect(connectJob()?.result).toEqual({ ok: true, origin: "http://localhost:7401" });
      expect(started).toBe(0);
    });

    it("a second connect adopts the live tunnel instead of fighting for the port", async () => {
      let tunnels = 0;
      await boot({
        openTunnel: () => {
          tunnels++;
          return {
            port: 7364,
            pid: process.pid,
            exited: () => false,
            stderr: () => "",
            close: () => {},
            detach: () => {},
          };
        },
      });
      await installed();
      await admin.post("/api/machines/ssh:nas/connect");
      await waitFor(() => connectJob()?.running === false);
      await admin.post("/api/machines/ssh:nas/connect");
      await waitFor(() => connectJob()?.running === false);
      expect(connectJob()?.result).toMatchObject({ ok: true });
      expect(tunnels).toBe(1);
    });

    it("carries ssh's own words when the tunnel never answers", async () => {
      await boot({
        waitForHttp: async () => ({ ok: false, detail: "no HTTP answer through the tunnel" }),
        openTunnel: () => ({
          port: 7364,
          pid: process.pid,
          exited: () => false,
          stderr: () => "bind: Address already in use",
          close: () => {},
          detach: () => {},
        }),
      });
      await installed();
      await admin.post("/api/machines/ssh:nas/connect");
      await waitFor(() => connectJob()?.running === false);
      expect(connectJob()?.result).toMatchObject({
        ok: false,
        message: "bind: Address already in use",
      });
      // A failed connect leaves no origin behind for the proxy to trust.
      expect((await byId("ssh:nas"))?.origin).toBeNull();
    });

    it("refuses the machine this server runs on, by its id and not by its alias", async () => {
      const mine = t.deps?.machines;
      void mine;
      await boot();
      const res = await admin.post("/api/machines/local/connect");
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("self_connect");
    });

    it("refuses a machine with nothing installed on it", async () => {
      await boot();
      const res = await admin.post("/api/machines/ssh:nas/connect");
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_installed");
    });

    it("409s a second connect while one runs, without touching the install job", async () => {
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await boot({
        waitForHttp: async () => {
          await held;
          return { ok: true };
        },
      });
      await installed();
      await installed("ssh:build-box");
      expect((await admin.post("/api/machines/ssh:nas/connect")).status).toBe(202);
      const second = await admin.post("/api/machines/ssh:build-box/connect");
      expect(second.status).toBe(409);
      expect(((await second.json()) as { error: { code: string } }).error.code).toBe(
        "connect_running",
      );
      // The install job is a separate slot and is untouched by a connect.
      expect(t.deps.machines.job()?.running).toBe(false);
      release();
      await waitFor(() => connectJob()?.running === false);
    });

    it("disconnect drops the tunnel and the origin with it", async () => {
      let closed = 0;
      await boot({
        openTunnel: () => ({
          port: 7364,
          pid: process.pid,
          exited: () => false,
          stderr: () => "",
          close: () => {
            closed++;
          },
          detach: () => {},
        }),
      });
      await installed();
      await admin.post("/api/machines/ssh:nas/connect");
      await waitFor(() => connectJob()?.running === false);
      expect((await byId("ssh:nas"))?.origin).toBe("http://localhost:7364");

      await admin.post("/api/machines/ssh:nas/disconnect");
      expect(closed).toBe(1);
      expect((await byId("ssh:nas"))?.origin).toBeNull();
    });

    it("the proxy finds the tunnel by the machine's id, not by the alias", async () => {
      const ID = "QS7J4YVgSovi-Z2c";
      await boot({
        probe: async () => ({ state: { kind: "running", port: 7364, pid: 9 }, machineId: ID }),
        openTunnel: () => liveTunnel(),
      });
      await installed();
      await admin.post("/api/machines/ssh:nas/connect");
      await waitFor(() => connectJob()?.running === false);

      expect(t.deps.machines.tunnelPortForMachine(ID)).toBe(7364);
      // The address still works for acting ON the machine; it is not how the proxy is keyed.
      expect(t.deps.machines.tunnelPortForMachine("ssh:nas")).toBeNull();
      expect(t.deps.machines.tunnelPortForMachine("some-other-machine")).toBeNull();
    });

    it("stays addressable after its ssh alias is renamed or deleted", async () => {
      const ID = "QS7J4YVgSovi-Z2c";
      let aliases = ["nas", "build-box"];
      await boot({
        listAliases: () => aliases,
        probe: async () => ({ state: { kind: "running", port: 7364, pid: 9 }, machineId: ID }),
        openTunnel: () => liveTunnel(),
      });
      await installed();
      await admin.post("/api/machines/ssh:nas/connect");
      await waitFor(() => connectJob()?.running === false);
      expect(t.deps.machines.tunnelPortForMachine(ID)).toBe(7364);

      // The host is renamed in ssh config; the tunnel is still forwarding.
      aliases = ["nas-renamed", "build-box"];
      expect(t.deps.machines.tunnelPortForMachine(ID)).toBe(7364);

      // ...and removed from the config outright. A live connection does not care.
      aliases = [];
      expect(t.deps.machines.tunnelPortForMachine(ID)).toBe(7364);
    });

    it("learns the id of a machine whose server it had to start", async () => {
      const ID = "QS7J4YVgSovi-Z2c";
      let up = false;
      await boot({
        // Down at first, so it has minted nothing; up (and identified) once started.
        probe: async () =>
          up
            ? { state: { kind: "running" as const, port: 7364, pid: 9 }, machineId: ID }
            : { state: { kind: "stopped" as const }, machineId: null },
        startServer: async () => {
          up = true;
          return { ok: true };
        },
        openTunnel: () => liveTunnel(),
      });
      await installed();
      await admin.post("/api/machines/ssh:nas/connect");
      await waitFor(() => connectJob()?.running === false);
      expect(connectJob()?.result).toMatchObject({ ok: true });
      // Without the second probe the proxy would have no id to be addressed by.
      expect((await byId("ssh:nas"))?.machineId).toBe(ID);
      expect(t.deps.machines.tunnelPortForMachine(ID)).toBe(7364);
    });

    it("a tunnel whose ssh process is gone is not an origin, however the file reads", async () => {
      await boot({
        openTunnel: () => ({
          // A pid that cannot be alive: the state file will name it, and the liveness check
          // is what must refuse it rather than the proxy being pointed at a dead port.
          port: 7364,
          pid: 2_147_483_600,
          exited: () => false,
          stderr: () => "",
          close: () => {},
          detach: () => {},
        }),
      });
      await installed();
      await admin.post("/api/machines/ssh:nas/connect");
      await waitFor(() => connectJob()?.running === false);
      expect(connectJob()?.result).toMatchObject({ ok: true });
      expect(t.deps.machines.tunnelPortFor("ssh:nas")).toBeNull();
      expect((await byId("ssh:nas"))?.origin).toBeNull();
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
      expect((await admin.post("/api/machines/ssh:nas/install")).status).toBe(202);
      const second = await admin.post("/api/machines/ssh:build-box/install");
      expect(second.status).toBe(409);
      expect(((await second.json()) as { error: { code: string } }).error.code).toBe(
        "install_running",
      );
      release();
      await waitFor(() => t.deps.machines.job()?.running === false);
    });

    it("404s a host this server's config does not declare", async () => {
      await boot();
      const res = await admin.post("/api/machines/ssh:not-in-config/install");
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "unknown_machine",
      );
      expect(t.deps.machines.job()).toBeNull();
    });

    it("409s when this server carries no install image", async () => {
      await boot({ resolvePlan: () => null });
      const res = await admin.post("/api/machines/ssh:nas/install");
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "no_install_image",
      );
    });

    it("502s a host ssh itself cannot resolve", async () => {
      await boot({ resolveTarget: async () => null });
      const res = await admin.post("/api/machines/ssh:nas/install");
      expect(res.status).toBe(502);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "unresolvable_host",
      );
    });
  });
});

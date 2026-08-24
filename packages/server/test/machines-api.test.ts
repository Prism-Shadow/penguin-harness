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
    stopServer: async () => true,
    upgrade: async () => ({ kind: "upgraded", detail: "" }),
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
    runOn: async () => ({ code: 0, stdout: "", stderr: "" }),
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
      // Only the refresh's probes are the subject; the install makes its own (it restarts
      // the machine onto what it just sent).
      probes = 0;

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

  describe("putting a new build into service", () => {
    it("restarts a machine whose server was running, so the installed build is the running one", async () => {
      // Installing swaps the program directory; the process over there keeps the code it
      // loaded at start. Without the restart the machine reports a version it is not running.
      const calls: string[] = [];
      await boot({
        probe: async () => ({ state: { kind: "running", port: 7364, pid: 99 }, machineId: null }),
        stopServer: async (_t, pid) => {
          calls.push(`stop:${pid}`);
          return true;
        },
        startServer: async (_t, port) => {
          calls.push(`start:${port}`);
          return { ok: true };
        },
      });
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toMatchObject({ ok: true, kind: "installed" });
      expect(calls).toEqual(["stop:99", "start:7364"]);
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
      await admin.post("/api/machines/ssh:nas/install");
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
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(calls).toEqual([]);
    });

    it("says so when the server does not come back, instead of reporting a clean install", async () => {
      await boot({
        probe: async () => ({ state: { kind: "running", port: 7364, pid: 99 }, machineId: null }),
        startServer: async () => ({ ok: false, detail: "port 7364 already in use" }),
      });
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.log.join(" ")).toContain("did not come back up");
    });
  });

  describe("handing this build on to the fleet", () => {
    const listed = async () =>
      ((await (await admin.get("/api/machines")).json()) as MachinesResponse).machines;

    it("upgrades every machine carrying a different build", async () => {
      const sent: string[] = [];
      await boot({
        upgrade: async (o) => {
          sent.push(o.target.alias);
          return { kind: "upgraded", detail: "" };
        },
      });
      // Both installed, both on an older build than this server's 9.9.9.
      for (const id of ["ssh:nas", "ssh:build-box"]) {
        await admin.post(`/api/machines/${id}/install`);
        await waitFor(() => t.deps.machines.job()?.running === false);
      }
      const stale = new MachinesService(
        machinesRoot,
        effects({
          resolvePlan: () => ({
            baseVersion: "10.0.0",
            harness: null,
            hmrDir: null,
            version: "10.0.0",
          }),
          upgrade: async (o) => {
            sent.push(o.target.alias);
            return { kind: "upgraded", detail: "" };
          },
        }),
      );
      sent.length = 0;
      await stale.syncOutOfDate();
      expect(sent.sort()).toEqual(["build-box", "nas"]);
      // Recorded, so the next boot has nothing to do.
      expect(stale.list().filter((m) => m.installed?.version === "10.0.0")).toHaveLength(2);
    });

    it("costs no ssh when the fleet already runs this build", async () => {
      let resolved = 0;
      await boot();
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      const current = new MachinesService(
        machinesRoot,
        effects({
          resolveTarget: async (alias) => {
            resolved++;
            return {
              alias,
              settings: {
                user: "d",
                hostname: alias,
                port: 22,
                identityFiles: [],
                proxyJump: null,
              },
              machine: `d@${alias}`,
            };
          },
        }),
      );
      await current.syncOutOfDate();
      // Decided from the records against the image version — no host is even resolved.
      expect(resolved).toBe(0);
    });

    it("does nothing at all when this server has no build of its own to hand on", async () => {
      await boot();
      let sent = 0;
      const packaged = new MachinesService(
        machinesRoot,
        effects({
          resolvePlan: () => null,
          upgrade: async () => {
            sent++;
            return { kind: "upgraded", detail: "" };
          },
        }),
      );
      await packaged.syncOutOfDate();
      expect(sent).toBe(0);
    });

    it("leaves a machine it could not upgrade recorded as behind, not as done", async () => {
      await boot();
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      const refusing = new MachinesService(
        machinesRoot,
        effects({
          resolvePlan: () => ({
            baseVersion: "10.0.0",
            harness: null,
            hmrDir: null,
            version: "10.0.0",
          }),
          upgrade: async () => ({ kind: "refused", detail: "admin password was changed" }),
        }),
      );
      await refusing.syncOutOfDate();
      // Still 9.9.9: the page keeps saying "Out of sync", which is the truth.
      expect(refusing.list().find((m) => m.id === "ssh:nas")?.installed?.version).toBe("9.9.9");
    });

    it("skips machines nothing was installed on", async () => {
      await boot();
      const sent: string[] = [];
      const service = new MachinesService(
        machinesRoot,
        effects({
          resolvePlan: () => ({
            baseVersion: "10.0.0",
            harness: null,
            hmrDir: null,
            version: "10.0.0",
          }),
          upgrade: async (o) => {
            sent.push(o.target.alias);
            return { kind: "upgraded", detail: "" };
          },
        }),
      );
      await service.syncOutOfDate();
      expect(sent).toEqual([]);
      void listed;
    });
  });

  describe("browsing a machine's directories", () => {
    const ID = "QS7J4YVgSovi-Z2c";
    /** What listDirsCommand's output looks like coming back over ssh. */
    const listing = (path: string, names: string[]) =>
      `${path}\n---penguin-dirs---\n${names.join("\n")}\n`;

    const withDirs = async (stdout: string, code = 0) => {
      await boot({
        probe: async () => ({ state: { kind: "running", port: 7364, pid: 1 }, machineId: ID }),
        runOn: async () => ({ code, stdout, stderr: "" }),
      });
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      await admin.post("/api/machines/probe");
    };

    it("lists that machine's directories WITHOUT signing in to its server", async () => {
      // The whole point: a workspace picker must not demand a second login. This goes over
      // ssh, authenticated by the local admin session like the rest of this surface.
      await withDirs(listing("/home/deploy", ["projects", "src"]));
      const res = await admin.get(`/api/machines/${ID}/dirs?path=`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        path: "/home/deploy",
        parent: "/home",
        entries: [
          { name: "projects", path: "/home/deploy/projects" },
          { name: "src", path: "/home/deploy/src" },
        ],
      });
    });

    it("uses the path the FAR side resolved, not one built here", async () => {
      // Only that machine can say what ~ or a symlink means on it.
      await withDirs(listing("/var/data/real", ["a"]));
      const body = (await (await admin.get(`/api/machines/${ID}/dirs?path=~`)).json()) as {
        path: string;
      };
      expect(body.path).toBe("/var/data/real");
    });

    it("has no parent at the root", async () => {
      await withDirs(listing("/", ["etc", "home"]));
      const body = (await (await admin.get(`/api/machines/${ID}/dirs`)).json()) as {
        parent: string | null;
      };
      expect(body.parent).toBeNull();
    });

    it("is empty rather than broken for a directory with no subdirectories", async () => {
      await withDirs(listing("/home/deploy/leaf", []));
      const body = (await (await admin.get(`/api/machines/${ID}/dirs`)).json()) as {
        entries: unknown[];
      };
      expect(body.entries).toEqual([]);
    });

    it("404s a directory that does not exist over there, with a reason", async () => {
      await withDirs("", 3);
      const res = await admin.get(`/api/machines/${ID}/dirs?path=/nope`);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("dir_not_found");
    });

    it("404s a machine it does not know, rather than reaching for one", async () => {
      await boot();
      expect((await admin.get("/api/machines/NOTAMACHINEaaaa/dirs")).status).toBe(404);
    });

    it("is admin-only, like the rest of this surface", async () => {
      await boot();
      const user = await provisionUser(t.app, "member2");
      expect((await apiClient(t.app, user.cookie).get(`/api/machines/${ID}/dirs`)).status).toBe(
        403,
      );
    });
  });

  describe("connecting without being asked", () => {
    const listed = async () =>
      ((await (await admin.get("/api/machines")).json()) as MachinesResponse).machines;

    it("opens a tunnel to an installed machine that has none", async () => {
      await boot({ openTunnel: () => liveTunnel() });
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect((await listed()).find((m) => m.id === "ssh:nas")?.origin).toBeNull();

      await t.deps.machines.autoConnect();
      expect((await listed()).find((m) => m.id === "ssh:nas")?.origin).toBe(
        "http://localhost:7364",
      );
    });

    it("starts a server that is down — a connect IS that decision", async () => {
      let started = 0;
      let up = false;
      await boot({
        probe: async () =>
          up
            ? { state: { kind: "running" as const, port: 7364, pid: 9 }, machineId: null }
            : { state: { kind: "stopped" as const }, machineId: null },
        startServer: async () => {
          started++;
          up = true;
          return { ok: true };
        },
        openTunnel: () => liveTunnel(),
      });
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      started = 0; // the install's own restart is not the subject
      await t.deps.machines.autoConnect();
      expect(started).toBe(1);
    });

    it("leaves alone a machine that is already connected", async () => {
      let tunnels = 0;
      await boot({
        openTunnel: () => {
          tunnels++;
          return liveTunnel();
        },
      });
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      await t.deps.machines.autoConnect();
      await t.deps.machines.autoConnect();
      expect(tunnels).toBe(1);
    });

    it("never touches a machine with nothing installed on it", async () => {
      let tunnels = 0;
      await boot({
        openTunnel: () => {
          tunnels++;
          return liveTunnel();
        },
      });
      await t.deps.machines.autoConnect();
      expect(tunnels).toBe(0);
    });

    it("does not clobber the log of a connect somebody is watching", async () => {
      await boot({ openTunnel: () => liveTunnel() });
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      await admin.post("/api/machines/ssh:nas/connect");
      await waitFor(() => t.deps.machines.connectJob()?.running === false);
      const watched = t.deps.machines.connectJob();

      await t.deps.machines.autoConnect();
      // Same job object, same log: background work owns no part of the visible one.
      expect(t.deps.machines.connectJob()).toBe(watched);
    });

    it("carries on past a machine it cannot reach", async () => {
      await boot({
        openTunnel: () => liveTunnel(),
        startServer: async () => ({ ok: false, detail: "port in use" }),
        probe: async () => ({ state: { kind: "stopped" }, machineId: null }),
      });
      for (const id of ["ssh:nas", "ssh:build-box"]) {
        await admin.post(`/api/machines/${id}/install`);
        await waitFor(() => t.deps.machines.job()?.running === false);
      }
      await expect(t.deps.machines.autoConnect()).resolves.toBeUndefined();
    });
  });

  describe("one heavy operation per machine", () => {
    it("the automatic sync skips a machine a person is installing to", async () => {
      // Both copy tens of megabytes over one ssh connection. Racing them against a single
      // host is how a 30-second command times out with nothing to say — which then reads
      // as the remote refusing something it never saw.
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let upgrades = 0;
      await boot({
        install: async (o) => {
          await held;
          o.onProgress?.("done");
          return { kind: "installed", output: "", identity: IDENTITY };
        },
        upgrade: async () => {
          upgrades++;
          return { kind: "upgraded", detail: "" };
        },
        resolvePlan: () => ({
          baseVersion: "10.0.0",
          harness: null,
          hmrDir: null,
          version: "10.0.0",
        }),
      });
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === true);

      // A push lands mid-install and fans out; nas is busy, so it is left alone.
      await t.deps.machines.syncOutOfDate();
      expect(upgrades).toBe(0);

      release();
      await waitFor(() => t.deps.machines.job()?.running === false);
    });

    it("syncs it once the install is done — skipping is not giving up", async () => {
      let upgrades = 0;
      await boot({
        upgrade: async () => {
          upgrades++;
          return { kind: "upgraded", detail: "" };
        },
      });
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      const stale = new MachinesService(
        machinesRoot,
        effects({
          resolvePlan: () => ({
            baseVersion: "10.0.0",
            harness: null,
            hmrDir: null,
            version: "10.0.0",
          }),
          upgrade: async () => {
            upgrades++;
            return { kind: "upgraded", detail: "" };
          },
        }),
      );
      await stale.syncOutOfDate();
      expect(upgrades).toBe(1);
    });

    it("a timeout says it timed out, instead of blaming the remote", async () => {
      await boot({
        install: async () => ({
          kind: "failed",
          step: "prepare",
          // What execFailureText produces for a killed child.
          detail: "the machine did not answer in time",
        }),
      });
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toMatchObject({
        ok: false,
        message: "the machine did not answer in time",
      });
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
      // The install restarts the machine onto the build it just sent; what this test is
      // about is whether CONNECT starts a server that is already up.
      started = 0;
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

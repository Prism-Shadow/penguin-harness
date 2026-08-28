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
import { MachineRepo } from "../src/db/repos/machine.js";
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
    // Signing in is one command over the shared connection: the machine's own CLI mints a
    // session from the data root the ssh account owns. `--mark` is what makes the answer
    // parseable, so the stub answers in that shape.
    runOn: async () => ({
      code: 0,
      stdout: "---penguin-auth-token---\nremote-token\n",
      stderr: "",
      timedOut: false,
    }),
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
    t = await createTestApp({
      machines: new MachinesService(machinesRoot, LOCAL_ID, effects(over)),
    });
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
        kind: "already-installed",
        version: "9.9.9",
      });
    });

    it("re-running an install keeps the machine id the record already carried", async () => {
      // The id is learned from a probe and never asked for again, so the record is the only
      // place it lives. This path runs whenever an install is re-run over a build that is
      // already there — and writing a fresh record there un-identifies a machine that never
      // moved: it stops being addressable, and the Sessions living on it leave the merged
      // list they were part of, taking the open conversation's routing with them.
      await boot({
        install: async () => ({ kind: "already-installed", version: "9.9.9", identity: IDENTITY }),
      });
      fs.writeFileSync(
        path.join(machinesRoot, "machines-installs.json"),
        JSON.stringify({
          "ssh:nas": {
            version: "9.9.9",
            at: "2026-08-01T00:00:00.000Z",
            machineId: "kUkIyqU-1GOfXgKD",
          },
        }),
      );
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(recordsOnDisk()).toMatchObject({
        "ssh:nas": { machineId: "kUkIyqU-1GOfXgKD" },
      });
    });

    it("a machine that refuses this build says so, instead of reporting an install", async () => {
      // Same release, different pushed state: a hot update, sent down the machine's own
      // channel. A runtime too old to claim the platform refuses IN WORDS — and that refusal
      // is the whole point of asking. Copying the files over and restarting instead would let
      // it warn, fall back to its packaged default, and keep serving, which from here is
      // indistinguishable from success — and the record would then say the machine is on a
      // build it is not running, which is what excludes it from the sweep that would retry.
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
        // The one failure with a next step this side can take: replacing the program over
        // there. Offered, so a person answers — it restarts a server others may be on.
        canReplaceProgram: true,
      });
      expect((t.deps.machines.job()?.result as { message: string }).message).toContain(
        "no business capabilities",
      );
    });

    it("answering that offer runs the installer the version check would have skipped", async () => {
      // The machine's base already matches, which is why the install became a hot update in
      // the first place. Only the machine's refusal says the program has to be replaced
      // anyway, so `replaceProgram` is what carries that answer past the version check.
      let forced: boolean | undefined;
      await boot({
        install: async (opts: { forceInstaller?: boolean }) => {
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
      // Only nas gets an install; build-box has no server to ask about.
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
      // Only the refresh's probes are the subject; the install makes its own (it restarts
      // the machine onto what it just sent).
      probes = 0;

      // The host disappears from ssh's view between the install and the refresh.
      resolvable = false;
      await admin.post("/api/projects/default_project/machines/probe");
      expect((await byId("ssh:nas"))?.status).toMatchObject({ state: "unreachable" });
      // No ssh child at all: an alias ssh cannot name is a dead end before the probe.
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
      // Installing swaps the program directory; the process over there keeps the code it
      // loaded at start. Without the restart the machine reports a version it is not running.
      const calls: string[] = [];
      await boot({
        probe: async () => ({ state: { kind: "running", port: 7364, pid: 99 }, machineId: null }),
        // No pid argument any more: the machine reads its own lock and stops what it finds.
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
      expect(t.deps.machines.job()?.result).toMatchObject({ ok: true, kind: "installed" });
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

  describe("signing in to a machine without its password crossing the wire", () => {
    const ID = "QS7J4YVgSovi-Z2c";
    const identified = async (over = {}) => {
      await boot({
        probe: async () => ({ state: { kind: "running", port: 7364, pid: 1 }, machineId: ID }),
        openTunnel: () => liveTunnel(),
        ...over,
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      await admin.post("/api/projects/default_project/machines/probe");
    };

    it("hands back that machine's cookie, renamed into its own namespace", async () => {
      await identified();
      const res = await admin.post(`/api/projects/default_project/machines/${ID}/signin`);
      expect(res.status).toBe(200);
      const setCookie = res.headers.get("set-cookie") ?? "";
      // hex("QS7J4YVgSovi-Z2c") — the same marker the proxy forwards back to that machine.
      expect(setCookie).toContain(`penguin_s_${Buffer.from(ID, "utf8").toString("hex")}_`);
      expect(setCookie).toContain("penguin_session=remote-token");
    });

    it("never sets a bare cookie, which would collide with this server's own session", async () => {
      await identified();
      const setCookie =
        (await admin.post(`/api/projects/default_project/machines/${ID}/signin`)).headers.get(
          "set-cookie",
        ) ?? "";
      expect(setCookie.startsWith("penguin_session=")).toBe(false);
    });

    it("says so when that machine cannot mint one, so a person can sign in by hand", async () => {
      // No marker in the output: a build older than `penguin auth token`. That is the machine
      // answering, not the connection failing, so it is a refusal rather than an error.
      await identified({
        runOn: async () => ({
          code: 127,
          stdout: "penguin: unknown command 'auth'",
          stderr: "",
          timedOut: false,
        }),
      });
      const res = await admin.post(`/api/projects/default_project/machines/${ID}/signin`);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("signin_refused");
    });

    it("turns an unexpected throw into that same answer, not a 500", async () => {
      // ssh work has many ways to go wrong and only the anticipated ones are returned. One
      // that is not — here, the sign-in path throwing outright — used to reach the browser as
      // a bare "Internal server error" about a machine whose real answer was specific.
      await identified({
        runOn: () => {
          throw new Error("ssh vanished mid-handshake");
        },
      });
      const res = await admin.post(`/api/projects/default_project/machines/${ID}/signin`);
      expect(res.status).toBe(502);
      expect(await res.text()).toContain("ssh vanished mid-handshake");
    });

    it("signing out expires that machine's cookie and no other", async () => {
      // Under the same per-machine name the proxy renames into: a bare `penguin_session=`
      // would tell the browser to drop THIS server's session instead.
      await identified();
      await admin.post(`/api/projects/default_project/machines/${ID}/signin`);
      const res = await admin.post(`/api/projects/default_project/machines/${ID}/signout`);

      expect(res.status).toBe(200);
      const setCookie = res.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain(`penguin_s_${Buffer.from(ID, "utf8").toString("hex")}_`);
      expect(setCookie).toContain("Max-Age=0");
      expect(setCookie.startsWith("penguin_session=")).toBe(false);
    });

    it("signing out cannot take an upgrade with it: the work mints its own credential", async () => {
      // A person's session on a machine and this server's work on it are separate things. The
      // upgrade authenticates as that machine's admin by asking its CLI for a token (one
      // command on the shared shell) — so a sign-out ends the person's session and nothing
      // else. Borrowing the held one would make signing out break the automatic sweep.
      let presented: string | undefined;
      await identified({
        install: async () => ({ kind: "state-only", identity: IDENTITY }),
        upgrade: async (opts: { cookie: string }) => {
          presented = opts.cookie;
          return { kind: "upgraded", detail: "" };
        },
      });
      await admin.post(`/api/projects/default_project/machines/${ID}/signin`);
      await admin.post(`/api/projects/default_project/machines/${ID}/signout`);
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);

      expect(t.deps.machines.job()?.result).toMatchObject({ ok: true });
      expect(presented).toBe("penguin_session=remote-token");
    });

    it("tells the upgrade where that machine's server is, and that no tunnel already reaches it", async () => {
      // The two together are what decide whether a forward has to be raised: a machine
      // somebody is connected to already has one and its port is passed instead, and a
      // machine nobody has connected to — this one — is reached on a forward of its own,
      // pointed at the port the probe just reported.
      let live: number | null | undefined = 0;
      let remote: number | undefined;
      await identified({
        install: async () => ({ kind: "state-only", identity: IDENTITY }),
        upgrade: async (opts: { livePort?: number | null; remotePort: number }) => {
          live = opts.livePort;
          remote = opts.remotePort;
          return { kind: "upgraded", detail: "" };
        },
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);

      expect(remote).toBe(7364);
      expect(live).toBeNull();
    });

    it("will not hot-update a machine with nothing running on it, and says which it was", async () => {
      // A hot swap replaces the code a RUNNING server is serving. With none there, there is
      // nothing to swap — and reporting that as a refused build would send someone looking at
      // the build instead of at the machine.
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

    it("distinguishes a machine that could not be reached from one that refused", async () => {
      await identified({
        runOn: async () => ({ code: 255, stdout: "", stderr: "no route to host", timedOut: true }),
      });
      expect((await admin.post(`/api/projects/default_project/machines/${ID}/signin`)).status).toBe(
        502,
      );
    });

    it("404s a machine it does not know", async () => {
      await boot();
      expect(
        (await admin.post("/api/projects/default_project/machines/NOTAMACHINEaaaa/signin")).status,
      ).toBe(404);
    });

    it("is admin-only, like the rest of this surface", async () => {
      await identified();
      const user = await provisionUser(t.app, "member3");
      expect(
        (
          await apiClient(t.app, user.cookie).post(
            `/api/projects/default_project/machines/${ID}/signin`,
          )
        ).status,
      ).toBe(403);
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
        const minted = new MachineRepo(db).id();
        expect(minted).toMatch(/^[A-Za-z0-9_-]{16}$/);
        // An identity, not a token: a second reader over the same database gets the same one.
        expect(new MachineRepo(db).id()).toBe(minted);
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

      // A fresh service over the same data root — the restart case — still knows it, with
      // no probe at all.
      const reborn = new MachinesService(machinesRoot, LOCAL_ID, effects());
      expect(reborn.list("default_project").find((m) => m.id === "ssh:nas")?.machineId).toBe(ID);
    });

    it("a machine whose server never started stays without one", async () => {
      // The id is minted by the server over there, so an installed-but-never-run machine
      // legitimately has none — reporting a made-up one would be worse than null.
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

      // Someone points `nas` at another host. An id never changes for a machine, so a
      // different answer means a different machine behind that alias.
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

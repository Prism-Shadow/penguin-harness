/**
 * The machines API: who may use it, what the list answers, and the install job's lifecycle
 * as the Machines page sees it — start, poll, finish, and every way a start is refused
 * before an ssh runs.
 *
 * The service's three reaching-out effects are faked (see MachinesEffects): the real ones
 * read the developer's own ~/.ssh/config and spawn ssh against whatever it names. What the
 * push actually does over ssh is covered by machines-push.test.ts, against a fake ssh
 * binary and the real installOnRemote.
 *
 * One App serves the file; each case builds its own service (data root, store, effects),
 * which the App's machines node forwards to. The one case about the App's own boot boots
 * an App of its own.
 *
 * Scenarios:
 * - Given a member, a stranger or an admin, only the admin reaches the routes and a machine's
 *   proxied API.
 * - Given an ssh config, the list is its aliases with the version this server would push; an
 *   empty or unreadable config leaves this machine alone, and no image is said as such.
 * - Given an install, the job narrates, finishes and is remembered per Project; every failure
 *   (far-side words, a refused build, a throw, an unwritten version) ends the job and records
 *   nothing; a machine already on this build is a result, and still gets pushed state.
 * - Given installed machines, status is probed only when asked, once per round, and a stopped
 *   server or an unreachable machine is an answer; a restart follows an install only where a
 *   server was running.
 * - Given a connect, the remembered port is the one used, a dead server is started, a live one
 *   is left alone, and a held session is re-held at start() and at the App's boot — never
 *   after a disconnect.
 * - Given a model edit during a sync, it is written once afterwards, never dropped; what travels
 *   is every group connection and every row, a bare preset included.
 * - Given a Project config sync, the command policy and the new-chat defaults travel with the
 *   models — the machine keeps its own workspace, and its own default Agent when it lacks ours —
 *   and a value from this server's environment is named as not carried; a part the machine refuses
 *   is said and the rest still lands. Sync config checks the build first and refuses a machine on
 *   another build, writing nothing, and one not connected; a command policy saved here reaches the
 *   Project's machines.
 * - Given a connected machine, its directories are listed through the alias holding it.
 * - Given a probe, the machine's own id is learned and kept; this machine's id is minted once.
 *   A machine is adopted when this server first records it (hearing its id later changes nothing),
 *   and a repointed alias adopts the newcomer; a machine recorded before adoption times were kept
 *   never gets one, whatever a probe or a connect hears later.
 * - Given a batch to use, machines work side by side and each ends connected; stop using keeps
 *   the install.
 * - Given an ssh-config edit, a new block is appended, this app's block is rewritten in place,
 *   and a hand-written one is refused. A password is stored beside the config, never in it or in
 *   an answer, set even on a hand-written block, and deleted by key sign-in and with the machine.
 * - Given a stored password the machine refuses, a machine kept connected stops retrying — a
 *   person's Retry is refused too — until a password is saved for it again.
 * - Given a machine kept connected that does not come back, five failures in a row stop the
 *   automatic attempts, and an ssh refusal no retry mends stops them at the first, with no check;
 *   the look-over then tries nothing. A person's Retry runs one attempt at once: a stopped streak
 *   counts from the first again, a waiting one keeps its count, one running is left alone, and a
 *   host that answers again ends the streak connected. A machine not kept connected, one a job is
 *   working on and an unknown host are refused before anything runs; a connected one is left alone.
 * - Given a person's Stop retrying, a waiting streak stops at once and nothing runs after it
 *   until a Retry, which counts from the first again; an attempt already under way is cut and not
 *   counted, a job pressed then starts at once, and a Retry runs a new attempt at once.
 * - Given a person's job during an attempt, the job starts at once and the attempt is cut, not
 *   counted; the streak looks again once the job is done.
 * - Given a refusal decidable without ssh (self-install, a second install, an unknown host, no
 *   image), nothing runs. Given ssh's own refusal, the job ends at the first step with why, for
 *   the page to say, and no offer to install anyway.
 * - Given a server running from a source checkout, nothing is refused for want of an image: an
 *   install or a batch builds one from the checkout (once per batch), installs it under the
 *   checkout's release with the build's own suffix, and keeps it beside — never in — the
 *   server's own hmr store; an unchanged tree is the same image, a changed one a new version;
 *   a failed build ends the job in the build's own words, and the page says so until a build
 *   succeeds; an image a job is still installing outlives the builds that land meanwhile and
 *   goes at the next build after; the image outlives a restart; an installed server's own
 *   image wins.
 * - Given an installed release nothing was pushed to, an install puts the image the release
 *   ships: a whole store whose CLI the machine's `penguin-hmr` can load, under the release with
 *   the image's suffix, laid down beside — never in — the server's own hmr store; the image is
 *   laid down once and outlives a restart, an upgrade's image replaces the old one, an image
 *   that cannot be read ends the job before any install, and a pushed server's own state wins.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import type { AddressInfo } from "node:net";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { VERSION } from "@prismshadow/penguin-core";
import type {
  MachinesUseResponse,
  MachinesResponse,
  ModelsUpdateRequest,
} from "../src/api/types.js";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/db/database.js";
import { MachinesRepo } from "../src/db/repos/machines.js";
import { MachinesService } from "../src/machines/service.js";
import type { MachinesEffects } from "../src/machines/service.js";
import { remoteLayoutFor } from "../src/machines/layout.js";
import type { RemoteLayout } from "../src/machines/layout.js";
import type { PushPlan, RemoteInstallOutcome } from "../src/machines/install-server.js";
import type { RemoteIdentity } from "../src/machines/detect.js";
import type { CheckoutPacker } from "../src/machines/checkout-image.js";
import { readPushedBuild } from "../src/hmr/pushed-build.js";
import { readPushedCli } from "../src/hmr/manifest.js";
import type { PushedBuild } from "../src/hmr/pushed-build.js";
import {
  apiClient,
  createTestApp,
  loginAdmin,
  makeTempRoot,
  provisionUser,
  waitFor,
} from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { forwardingTo } from "./fixtures/forwarding.js";

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

/**
 * A plan with pushed state of its own: what a hot-pushed controller carries, and the only
 * shape under which an install can come back `state-only` — the release matches, the pushed
 * state does not — and the hand-over has something to hand over.
 */
const PUSHED_PLAN = {
  baseVersion: "9.9.9",
  harness: '{"platform":{"bundle":"store/platform/cafe.mjs"}}',
  hmrDir: "/nonexistent",
  version: "9.9.9+hmr.cafe",
};

/** What a checkout's packer leaves: a whole build, every part inline. */
const CHECKOUT_BUILD: PushedBuild = {
  platform: "export const hotPlatform = { id: 'checkout' };\n",
  cli: "export async function cli() { return 0; }\n",
  web: {
    files: { "index.html": Buffer.from("<!doctype html><title>dev</title>").toString("base64") },
  },
  assets: {
    files: {
      "install.sh": Buffer.from("#!/bin/sh\necho install\n").toString("base64"),
      "node_modules/node-pty/build/Release/spawn-helper": Buffer.from("helper").toString("base64"),
    },
    exec: ["node_modules/node-pty/build/Release/spawn-helper"],
  },
  source: {
    repo: "https://github.com/Prism-Shadow/penguin-harness.git",
    revision: "v0.2.13-1-gabc1234",
  },
};

/** An effects set that names two hosts and installs successfully, with the parts a test cares about overridden. */
function effects(over: Partial<MachinesEffects> = {}): Partial<MachinesEffects> {
  return {
    // The transport's own registry is not this suite's: its ups and downs are told by hand.
    watchSessions: () => () => {},
    // What a connection check asks when the POSIX probe has no answer; never a real ssh here.
    detect: async () => ({ error: "the fake machine said nothing" }),
    listAliases: () => ["build-box", "nas"],
    resolvePlan: () => ({ baseVersion: "9.9.9", harness: null, hmrDir: null, version: "9.9.9" }),
    now: () => new Date("2026-08-24T12:00:00.000Z"),
    startServer: async () => ({ ok: true }),
    stopServer: async () => ({ ok: true as const }),
    upgrade: async () => ({ kind: "upgraded", detail: "", persisted: true }),
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

/**
 * A port this host is not listening on: bound once and released. Lets a case use a layout port
 * of its own, since a shared default can have an unrelated server on it — and a connect asks
 * that server its identity now.
 */
async function quietPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe("machines API", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  /** The service's own data root — where it writes the install records this suite reads back. */
  let machinesRoot: string;
  let machinesRepo: MachinesRepo;
  let store: DatabaseSync;
  /** The case's service: what the App's routes and `t.deps.machines` reach. */
  let service: MachinesService;
  /** Every service built so far (the App's first included), retired after the case. */
  const built: Array<{ service: MachinesService; store: DatabaseSync; root: string }> = [];

  /** Builds the case's service over a fresh data root and store, with its effects overridden. */
  const boot = async (over: Partial<MachinesEffects> = {}, layout?: RemoteLayout) => {
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
    service = new MachinesService(
      machinesRoot,
      LOCAL_ID,
      machinesRepo,
      effects(over),
      undefined,
      layout,
    );
    built.push({ service, store, root: machinesRoot });
  };

  beforeAll(async () => {
    await boot();
    t = await createTestApp({ machines: forwardingTo(() => service) });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  afterEach(async () => {
    for (const retired of built.splice(0)) {
      // Its jobs finish before the next case's service takes over, so nothing a job does
      // lands in another case.
      await waitFor(() => retired.service.jobs().every((job) => !job.running && !job.queued));
      retired.service.stop();
      retired.store.close();
      fs.rmSync(retired.root, { recursive: true, force: true });
    }
  });

  /** What the store holds for each machine, as the service left it. */
  const recordsInStore = (): Record<string, { version: string; at: string }> =>
    Object.fromEntries(
      machinesRepo
        .all()
        .filter((row) => row.version !== null)
        .map((row) => [row.address, { version: row.version!, at: row.installedAt! }]),
    );

  describe("permission", () => {
    let member: ReturnType<typeof apiClient>;
    beforeAll(async () => {
      member = apiClient(t.app, (await provisionUser(t.app, "member")).cookie);
    });
    beforeEach(() => boot());

    it("is admin-only: a provisioned user gets 403", async () => {
      expect((await member.get("/api/projects/default_project/machines")).status).toBe(403);
      expect(
        (await member.post("/api/projects/default_project/machines/ssh:nas/install")).status,
      ).toBe(403);
    });

    it("needs a session at all", async () => {
      expect((await t.app.request("/api/projects/default_project/machines")).status).toBe(401);
    });

    it("gates a machine's proxied API the same way, under its own prefix", async () => {
      // /server/<machineId>/api/… is a protected group outside /api: the gate is what puts
      // the user on the context, and an ungated prefix left the handler reading isAdmin off
      // nothing — a 500, for the admin who was allowed and the stranger who was not.
      expect((await t.app.request("/server/tXIvjrl0pgKa5_dD/api/version")).status).toBe(401);
      expect((await member.get("/server/tXIvjrl0pgKa5_dD/api/version")).status).toBe(403);
      // An admin reaches the proxy itself, which answers for a machine it does not hold.
      const res = await admin.get("/server/tXIvjrl0pgKa5_dD/api/version");
      expect(res.status).toBe(503);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_connected");
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
        // This process's own root, resolved — not the layout's template, which names
        // where a server would run on some OTHER machine.
        root: machinesRoot,
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
          // No stream has asked for a socket to this machine, so there is nothing to report;
          // `machineId` is null here, which is also what decides that.
          socket: null,
          api: null,
          // The release profile's root over there, in the shell a machine of unknown
          // platform is assumed to speak.
          root: "$HOME/.penguin/data",
          status: null,
        },
        {
          id: "ssh:nas",
          alias: "nas",
          machineId: null,
          installed: null,
          local: false,
          connection: null,
          socket: null,
          api: null,
          // The release profile's root over there, in the shell a machine of unknown
          // platform is assumed to speak.
          root: "$HOME/.penguin/data",
          status: null,
        },
      ]);
      expect(body.imageVersion).toBe("9.9.9");
      expect(body.job).toBeNull();
    });

    it("says what the socket to each machine is doing, so a stuck stream is visible on the page", async () => {
      await boot({
        socketFact: (machineId) =>
          machineId === "kUkIyqU-1GOfXgKD"
            ? { state: "dialling", since: "2026-09-26T00:00:00.000Z" }
            : null,
      });
      machinesRepo.patch("ssh:nas", {
        version: "9.9.9",
        installedAt: "2026-08-01T00:00:00.000Z",
        machineId: "kUkIyqU-1GOfXgKD",
      });
      const body = (await (
        await admin.get("/api/projects/default_project/machines")
      ).json()) as MachinesResponse;
      expect(body.machines[0]?.socket).toBeNull(); // the local entry is nobody's socket
      expect(body.machines.find((machine) => machine.id === "ssh:nas")?.socket).toEqual({
        state: "dialling",
        since: "2026-09-26T00:00:00.000Z",
      });
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
          step: "install",
          detail: "error: could not move the existing lib directory aside",
        }),
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toEqual({
        ok: false,
        step: "install",
        message: "error: could not move the existing lib directory aside",
        // A failed install offers installing the program anyway, unless ssh itself refused.
        canReplaceProgram: true,
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
        probe: async (_target, _layout, _run, platform) => {
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
        resolvePlan: () => PUSHED_PLAN,
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
        resolvePlan: () => PUSHED_PLAN,
        install: async () => ({ kind: "state-only", identity: IDENTITY }),
        upgrade: async () => {
          asked = true;
          return { kind: "upgraded", detail: "", persisted: true };
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
        // This server carries a pushed state of its own: there is something to hand over.
        resolvePlan: () => ({
          baseVersion: "9.9.9",
          harness: '{"platform":{"bundle":"store/platform/cafe.mjs"}}',
          hmrDir: "/nonexistent",
          version: "9.9.9+hmr.cafe",
        }),
        install: async () => ({
          kind: "already-installed",
          version: "9.9.9+hmr.cafe",
          identity: IDENTITY,
        }),
        upgrade: async () => {
          asked = true;
          return { kind: "upgraded", detail: "", persisted: true };
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

    it("hands a push over even though the platform boots before the push is committed", async () => {
      // The store is written only once the pushed platform has booted, and start() runs AS
      // that boot: its first sweep reads the previous version off the disk and finds the
      // machine already carrying it. The push used to reach the machines one push late.
      const previous = {
        baseVersion: "9.9.9",
        harness: '{"platform":{"bundle":"store/platform/0dd0.mjs"}}',
        hmrDir: "/nonexistent",
        version: "9.9.9+hmr.0dd0",
      };
      const pushed = { ...previous, version: "9.9.9+hmr.cafe" };
      let committed = false;
      const handed: string[] = [];
      await boot({
        resolvePlan: () => (committed ? pushed : previous),
        install: async () => ({
          kind: "already-installed",
          version: previous.version,
          identity: IDENTITY,
        }),
        upgrade: async () => {
          handed.push(committed ? pushed.version : previous.version);
          return { kind: "upgraded", detail: "", persisted: true };
        },
        lateSweepMs: 30,
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(machinesRepo.get("ssh:nas")?.version).toBe(previous.version);
      handed.length = 0;

      // The new generation boots; the commit lands a moment after.
      const boot2 = t.deps.machines.start();
      committed = true;
      await boot2;
      await waitFor(() => machinesRepo.get("ssh:nas")?.version === pushed.version);
      expect(handed).toContain(pushed.version);
      t.deps.machines.stop();
    });

    it("a server with nothing pushed to it hands nothing over: a matching machine is simply done", async () => {
      // A packaged install has no pushed state (plan.harness === null) and readPushedBuild
      // would answer no-build. The former no-op must stay one, not become a failed job with
      // an offer to reinstall a machine that already matches.
      let asked = false;
      await boot({
        install: async () => ({ kind: "already-installed", version: "9.9.9", identity: IDENTITY }),
        upgrade: async () => {
          asked = true;
          return { kind: "no-build" };
        },
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(asked).toBe(false);
      expect(t.deps.machines.job()?.result).toMatchObject({
        ok: true,
        installed: "already-installed",
      });
      expect(t.deps.machines.job()?.log.join(" ")).toContain("Nothing pushed here");
    });

    it("a build the machine took but could not write down is not recorded as installed", async () => {
      // `persisted: false` is the machine's own word that the swap is live and will revert at
      // its next restart. Recording the version would be true until then and false after.
      await boot({
        resolvePlan: () => PUSHED_PLAN,
        install: async () => ({ kind: "state-only", identity: IDENTITY }),
        upgrade: async () => ({ kind: "upgraded", detail: "", persisted: false }),
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toMatchObject({
        ok: false,
        step: "hand over the pushed build",
        canReplaceProgram: true,
      });
      expect((t.deps.machines.job()?.result as { message: string }).message).toContain("revert");
      expect(machinesRepo.get("ssh:nas")?.version ?? null).toBeNull();
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

    it("a port another program holds over there ends the job saying so, with no install offered", async () => {
      await boot({
        probe: async () => ({ state: { kind: "stopped" }, machineId: null }),
        startServer: async () => ({
          ok: false,
          portTaken: true,
          detail:
            "Port 7364 on that machine is taken by another program, so its server could not start there.",
        }),
      });
      machinesRepo.patch("ssh:nas", { version: "9.9.9", installedAt: "2026-08-01T00:00:00.000Z" });
      await admin.post("/api/projects/default_project/machines/ssh:nas/connect");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toMatchObject({
        ok: false,
        step: "start its server",
        canReplaceProgram: false,
      });
    });

    it("a restart that fails is the job's outcome, not a line in its log", async () => {
      // The files landed — the record says so — but the old process is still serving, and
      // an API reporting a clean install over that is exactly the disagreement every guard on
      // this path exists to prevent.
      await boot({
        probe: async () => ({ state: { kind: "running", port: 7364, pid: 99 }, machineId: null }),
        startServer: async () => ({ ok: false, detail: "port 7364 already in use" }),
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toMatchObject({
        ok: false,
        step: "restart its server",
      });
      expect((t.deps.machines.job()?.result as { message: string }).message).toContain(
        "did not come back up",
      );
      // On disk it IS this version; the record says what is there, the job says what runs.
      expect(machinesRepo.get("ssh:nas")?.version).toBe("9.9.9");
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

    it("a remembered port that does not take is the failure, not a cue to try another", async () => {
      // The row's port is the only one tried: this side does not guess at numbers on a
      // machine other people use, and the far side's own words are what a person reads.
      const starts: number[] = [];
      await boot({
        probe: async () => ({ state: { kind: "stopped" as const }, machineId: null }),
        startServer: async (_t, port) => {
          starts.push(port);
          return { ok: false, detail: "EADDRINUSE" };
        },
      });
      installed("9.9.9");
      machinesRepo.patch("ssh:nas", { remotePort: 7376 });
      await admin.post("/api/projects/default_project/machines/ssh:nas/connect");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toMatchObject({
        ok: false,
        step: "start its server",
        message: "EADDRINUSE",
      });
      expect(starts).toEqual([7376]);
      expect(machinesRepo.get("ssh:nas")?.remotePort).toBe(7376);
    });

    it("a machine never reached before starts on the profile's own default port", async () => {
      // The dev profile's layout, with its port replaced by one of this host's own: the case is
      // about the port coming from the layout rather than from a guess, and on a shared default
      // an unrelated server may be listening — one a connect now asks its identity.
      const starts: number[] = [];
      let up = false;
      const layout = { ...remoteLayoutFor("dev"), defaultPort: await quietPort() };
      await boot(
        {
          probe: async () =>
            up
              ? {
                  state: { kind: "running" as const, port: layout.defaultPort, pid: 4242 },
                  machineId: null,
                }
              : { state: { kind: "stopped" as const }, machineId: null },
          startServer: async (_t, port) => {
            starts.push(port);
            up = true;
            return { ok: true };
          },
        },
        layout,
      );
      installed("9.9.9");
      await admin.post("/api/projects/default_project/machines/ssh:nas/connect");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toEqual({ ok: true, connected: true });
      expect(starts).toEqual([layout.defaultPort]);
      expect(machinesRepo.get("ssh:nas")?.remotePort).toBe(layout.defaultPort);
    });

    it("remembers the port the machine says it serves on, not the one that was asked for", async () => {
      // The data root admits one server, so the server that answers after a start can be an
      // earlier one on another port. The connection has to go where it actually listens.
      let up = false;
      await boot({
        probe: async () =>
          up
            ? { state: { kind: "running" as const, port: 7376, pid: 4242 }, machineId: null }
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
      expect(machinesRepo.get("ssh:nas")?.remotePort).toBe(7376);
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

    it("the App's boot re-holds what the record says was held, without being asked", async () => {
      // What a hot push or a restart finds: a record written by the generation before. Nobody
      // calls start() here — the Startup component does, as the App comes up.
      const heldNow: string[] = [];
      await boot({
        hold: async (target) => {
          heldNow.push(target.alias);
          connected.add(`ssh:${target.alias}`);
          return { ok: true, session: { pid: process.pid, socksPort: 1 } };
        },
      });
      machinesRepo.patch("ssh:nas", {
        version: "9.9.9",
        installedAt: "2026-08-01T00:00:00.000Z",
        sessionPid: 424242,
        remotePort: 7364,
      });
      // An App of its own, booted over that record: its boot is the behaviour.
      const booted = await createTestApp({ machines: service });
      try {
        await waitFor(() => heldNow.length > 0);
        expect(heldNow).toEqual(["nas"]);
        expect(machinesRepo.get("ssh:nas")?.sessionPid).toBe(process.pid);
      } finally {
        await booted.cleanup();
      }
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

  describe("handing over only to the build installed there", () => {
    /** This server's image: a pushed platform, named by its content sha as a real one is. */
    const IMAGE: PushPlan = {
      baseVersion: "9.9.9",
      harness: '{"platform":{"bundle":"store/platform/cafe0123456789ab.mjs"}}',
      hmrDir: "/nonexistent",
      version: "9.9.9+hmr.cafe01234567",
    };
    type Runs = "the release" | "the image" | "an older image";
    /**
     * What a machine's server says of itself (its GET /api/version): the code answering, and the
     * pushed build its disk holds — the image, whatever the process runs.
     */
    const versionReport = (runs: Runs) => ({
      version: "9.9.9",
      channel: runs === "the release" ? "release" : "source",
      harness: {
        bundles: {
          platform:
            runs === "an older image"
              ? "store/platform/0123456789abcdef.mjs"
              : "store/platform/cafe0123456789ab.mjs",
        },
      },
    });
    /**
     * A machine's server: says what runs there, and keeps the Model config it is handed.
     *
     * `runs` is what its disk holds (GET /api/version); `processRuns` is the build the process
     * loaded at its start (GET /api/handshake), this hub's image unless a case says a hot update
     * moved the disk and not the process — these cases are about the version gate below the
     * handshake, and a machine the handshake already judges in line is what leaves it to decide.
     */
    const machineServer = async (initially: Runs, processRuns: Runs = "the image") => {
      const state = { runs: initially, process: processRuns, puts: [] as ModelsUpdateRequest[] };
      const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
        req.on("end", () => {
          if (req.method === "PUT" && req.url?.endsWith("/models")) {
            state.puts.push(JSON.parse(body) as ModelsUpdateRequest);
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            req.url === "/api/handshake"
              ? JSON.stringify({ identity: versionReport(state.process) })
              : req.url === "/api/version"
                ? JSON.stringify(versionReport(state.runs))
                : req.url === "/api/projects"
                  ? JSON.stringify({ projects: [{ projectId: PROJECT }] })
                  : JSON.stringify({ models: [] }),
          );
        });
      });
      const port = await new Promise<number>((resolve) =>
        server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
      );
      return { state, port, close: () => server.close() };
    };
    /** A connect from the Machines page (Start), followed to its end. */
    const connect = async () => {
      await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/connect`);
      await waitFor(() => t.deps.machines.job()?.running === false);
      return t.deps.machines.job()!;
    };
    const bootOn = async (
      remote: Awaited<ReturnType<typeof machineServer>>,
      over: Partial<MachinesEffects> = {},
    ) => {
      await boot({
        resolvePlan: () => IMAGE,
        loadConfig: async () =>
          ({
            models: [
              {
                provider: "deepseek",
                model_id: "deepseek-v4-pro",
                client_type: "deepseek-official",
                api_key: "sk-x",
              },
            ],
          }) as never,
        probe: async () => ({
          state: { kind: "running" as const, port: remote.port, pid: 4242 },
          machineId: null,
        }),
        ...over,
      });
      machinesRepo.patch("ssh:nas", {
        version: IMAGE.version,
        installedAt: "2026-08-01T00:00:00.000Z",
        remotePort: remote.port,
      });
      machinesRepo.setMembers(PROJECT, ["ssh:nas"]);
    };

    it("a release's own server answering on that root is restarted onto the installed build before the Model config is handed over", async () => {
      // The user's report: "Its server is already up", the config handed over in MMSP names, and
      // every Session there failing because a 0.2.13 runtime read them.
      const remote = await machineServer("the release");
      const restarts: string[] = [];
      try {
        await bootOn(remote, {
          stopServer: async () => {
            restarts.push("stop");
            return { ok: true as const };
          },
          startServer: async () => {
            restarts.push("start");
            remote.state.runs = "the image";
            return { ok: true };
          },
        });

        const job = await connect();

        expect(job.result).toEqual({ ok: true, connected: true });
        expect(restarts).toEqual(["stop", "start"]);
        expect(job.log.join("\n")).toContain(
          "Its server runs 9.9.9, not the build installed there; restarting it onto that build…",
        );
        // Handed over once, and only to the build installed there.
        expect(remote.state.puts).toHaveLength(1);
        expect(remote.state.puts[0]!.models.map((m) => m.clientType)).toEqual([
          "deepseek-official",
        ]);
      } finally {
        remote.close();
      }
    });

    it("a server on another build is given this server's image first, then the Model config", async () => {
      const remote = await machineServer("an older image");
      const upgraded: string[] = [];
      try {
        await bootOn(remote, {
          upgrade: async () => {
            upgraded.push("ssh:nas");
            remote.state.runs = "the image";
            return { kind: "upgraded", detail: "Update accepted.", persisted: true };
          },
        });
        machinesRepo.patch("ssh:nas", { version: "9.9.9+hmr.0123456789ab" });

        const job = await connect();

        expect(job.result).toEqual({ ok: true, connected: true });
        expect(upgraded).toEqual(["ssh:nas"]);
        expect(job.log.join("\n")).toContain(
          "It runs 9.9.9+hmr.0123456789ab; bringing it to 9.9.9+hmr.cafe01234567 first…",
        );
        expect(machinesRepo.get("ssh:nas")?.version).toBe(IMAGE.version);
        expect(remote.state.puts).toHaveLength(1);
      } finally {
        remote.close();
      }
    });

    it("a server that cannot be brought in line stops the connect with a plain sentence, and is handed nothing", async () => {
      const remote = await machineServer("an older image");
      try {
        await bootOn(remote, {
          upgrade: async () => ({
            kind: "refused",
            detail: "this runtime publishes no business capabilities this platform can claim",
          }),
        });

        const job = await connect();

        expect(job.result).toEqual({
          ok: false,
          step: "sync",
          message:
            "That machine runs 9.9.9+hmr.0123456789ab; it must be updated to 9.9.9+hmr.cafe01234567 before it can use this server's models. It did not take this build: this runtime publishes no business capabilities this platform can claim",
          // Installing anyway replicates the image and restarts the server onto it: the way out.
          canReplaceProgram: true,
        });
        expect(remote.state.puts).toEqual([]);
        expect(connected.has("ssh:nas")).toBe(false);
      } finally {
        remote.close();
      }
    });

    it("a release's own server that will not stop stops the connect, and is handed nothing", async () => {
      const remote = await machineServer("the release");
      try {
        await bootOn(remote, {
          stopServer: async () => ({ ok: false as const, detail: "permission denied" }),
        });

        const job = await connect();

        expect(job.result).toMatchObject({ ok: false, step: "sync" });
        expect((job.result as { message: string }).message).toBe(
          "That machine runs 9.9.9; it must be updated before it can use this server's models. Its restart failed: it would not stop — permission denied",
        );
        expect(remote.state.puts).toEqual([]);
      } finally {
        remote.close();
      }
    });

    it("a server on this server's image is handed the Model config with nothing done to it", async () => {
      const remote = await machineServer("the image");
      const touched: string[] = [];
      try {
        await bootOn(remote, {
          stopServer: async () => {
            touched.push("stop");
            return { ok: true as const };
          },
          upgrade: async () => {
            touched.push("upgrade");
            return { kind: "upgraded", detail: "", persisted: true };
          },
        });

        const job = await connect();

        expect(job.result).toEqual({ ok: true, connected: true });
        expect(touched).toEqual([]);
        expect(remote.state.puts).toHaveLength(1);
      } finally {
        remote.close();
      }
    });

    it("a machine whose process is behind its disk is installed on and restarted once, then handed the config", async () => {
      // The report's machine: a hot update moved the disk to this hub's image, the process went
      // on serving the one before it, and every stream over there fails with nothing saying why.
      const remote = await machineServer("the image", "an older image");
      const done: string[] = [];
      try {
        await bootOn(remote, {
          install: async (opts) => {
            done.push(`install(force: ${String(opts.forceInstaller)})`);
            return { kind: "installed", output: "done", identity: IDENTITY };
          },
          stopServer: async () => {
            done.push("stop");
            return { ok: true as const };
          },
          startServer: async () => {
            done.push("start");
            // What comes back is the build the install left on the disk.
            remote.state.process = "the image";
            return { ok: true };
          },
        });

        const job = await connect();

        expect(job.result).toEqual({ ok: true, connected: true });
        expect(done).toEqual(["install(force: true)", "stop", "start"]);
        expect(job.log.join("\n")).toContain(
          "It answers 9.9.9+hmr.0123456789ab, not 9.9.9+hmr.cafe01234567; installing 9.9.9+hmr.cafe01234567 there…",
        );
        expect(machinesRepo.get("ssh:nas")?.version).toBe(IMAGE.version);
        // Handed over once, and only to the build it now serves.
        expect(remote.state.puts).toHaveLength(1);
      } finally {
        remote.close();
      }
    });

    it("a model edit is not handed to a connected machine left on another build", async () => {
      const remote = await machineServer("an older image");
      try {
        await bootOn(remote);
        machinesRepo.patch("ssh:nas", { version: "9.9.9+hmr.0123456789ab" });
        connected.add("ssh:nas");

        await t.deps.machines.syncConfigEverywhere(PROJECT);

        expect(remote.state.puts).toEqual([]);
      } finally {
        remote.close();
      }
    });
  });

  describe("syncing models outward", () => {
    /** A machine's server: counts what it is asked, keeps what it is sent, and can be made slow. */
    const machineServer = async (opts: { delayMs: number }) => {
      const asked: string[] = [];
      const puts: ModelsUpdateRequest[] = [];
      const server = http.createServer((req, res) => {
        asked.push(`${req.method} ${req.url}`);
        let body = "";
        req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
        req.on("end", () => {
          if (req.method === "PUT" && req.url?.endsWith("/models")) {
            puts.push(JSON.parse(body) as ModelsUpdateRequest);
          }
        });
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
      return { asked, puts, port, close: () => server.close() };
    };

    it("what travels is every group connection and every row, a bare preset included", async () => {
      const remote = await machineServer({ delayMs: 0 });
      try {
        await boot({
          loadConfig: async () =>
            ({
              providers: { tokendance: { api_key: "td-group-key-0123456789" } },
              models: [
                // A bare preset: it runs on its group's table, which travels beside it, and the
                // machine's own copy may be another release's or edited since.
                { provider: "tokendance", model_id: "glm-5.3" },
                // A model the user added, bare: it follows its group over there too.
                { provider: "openrouter", model_id: "acme/hand-added" },
                // A preset with a protocol of its own.
                { provider: "deepseek", model_id: "deepseek-flash", client_type: "openai-chat" },
              ],
            }) as never,
        });
        machinesRepo.patch("ssh:nas", {
          version: "9.9.9",
          installedAt: "2026-08-01T00:00:00.000Z",
          remotePort: remote.port,
        });
        machinesRepo.setMembers(PROJECT, ["ssh:nas"]);
        connected.add("ssh:nas");

        await t.deps.machines.syncConfigEverywhere(PROJECT);
        await waitFor(() => remote.puts.length >= 1);
        const sent = remote.puts[0]!;
        expect(sent.providers).toEqual({ tokendance: { apiKey: "td-group-key-0123456789" } });
        expect(sent.models.map((m) => [m.provider, m.modelId])).toEqual([
          ["tokendance", "glm-5.3"],
          ["openrouter", "acme/hand-added"],
          ["deepseek", "deepseek-flash"],
        ]);
      } finally {
        remote.close();
      }
    });

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
        const first = t.deps.machines.syncConfigEverywhere(PROJECT);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const second = t.deps.machines.syncConfigEverywhere(PROJECT);
        const third = t.deps.machines.syncConfigEverywhere(PROJECT);
        await Promise.all([first, second, third]);
        // Give the trailing run its own round trips.
        const modelPuts = () =>
          remote.asked.filter((a) => a === `PUT /api/projects/${PROJECT}/models`);
        await waitFor(() => modelPuts().length >= 2);

        const puts = modelPuts();
        // Exactly two writes: the one in flight, and ONE trailing run for everything that
        // arrived during it — the config is read fresh then, so the last edit is what lands.
        expect(puts).toHaveLength(2);
      } finally {
        remote.close();
      }
    });
  });

  describe("syncing the Project config", () => {
    /**
     * A machine's server on this server's build (or `runs`, another one): it records every write
     * it is sent, answers with its own new-chat defaults, and refuses what `refuse` names.
     */
    const machineServer = async (
      opts: {
        runs?: string;
        refuse?: (method: string, url: string, body: unknown) => unknown;
      } = {},
    ) => {
      const writes: Array<{ method: string; url: string; body: unknown }> = [];
      const server = http.createServer((req, res) => {
        let text = "";
        req.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
        req.on("end", () => {
          const url = req.url ?? "";
          const method = req.method ?? "GET";
          const body: unknown = text === "" ? undefined : JSON.parse(text);
          if (method !== "GET") writes.push({ method, url, body });
          const refused = opts.refuse?.(method, url, body);
          res.writeHead(refused === undefined ? 200 : 400, { "content-type": "application/json" });
          res.end(
            JSON.stringify(
              refused !== undefined
                ? refused
                : url === "/api/version"
                  ? { version: opts.runs ?? "9.9.9" }
                  : url === "/api/projects"
                    ? { projects: [{ projectId: PROJECT }] }
                    : url.endsWith("/chat-defaults")
                      ? { agentId: "their-agent", workspace: "/srv/theirs" }
                      : url.endsWith("/plugins/installed")
                        ? { plugins: [], shipped: [] }
                        : { models: [] },
            ),
          );
        });
      });
      const port = await new Promise<number>((resolve) =>
        server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
      );
      return { writes, port, close: () => server.close() };
    };
    /** This server's Project: a model keyed from its environment, a policy and new-chat defaults of its own. */
    const bootOn = async (remote: Awaited<ReturnType<typeof machineServer>>) => {
      await boot({
        loadConfig: async () =>
          ({
            models: [
              { provider: "deepseek", model_id: "deepseek-v4-flash", api_key: "sk-x" },
              { provider: "openai", model_id: "gpt-5" },
            ],
            command_policy: { enabled: false, rules: [{ name: "no-rm", pattern: "rm -rf" }] },
            default_chat: { agent_id: "ours", workspace: "/home/me/here", thinking_level: "high" },
          }) as never,
        env: () => ({ OPENAI_API_KEY: "sk-env-0123456789" }),
        probe: async () => ({
          state: { kind: "running" as const, port: remote.port, pid: 4242 },
          machineId: null,
        }),
      });
      machinesRepo.patch("ssh:nas", {
        version: "9.9.9",
        installedAt: "2026-08-01T00:00:00.000Z",
        remotePort: remote.port,
      });
      machinesRepo.setMembers(PROJECT, ["ssh:nas"]);
      connected.add("ssh:nas");
    };
    const nas = () => t.deps.machines.list(PROJECT).find((m) => m.id === "ssh:nas")!;
    /** The Machines page's Sync config, followed to its end. */
    const syncNow = async () => {
      const res = await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/sync`);
      expect(res.status).toBe(202);
      await waitFor(() => t.deps.machines.job()?.running === false);
      return t.deps.machines.job()!;
    };

    it("carries the command policy and the new-chat defaults, keeping the machine's own workspace and, when it lacks ours, its default Agent", async () => {
      const remote = await machineServer({
        refuse: (method, url, body) =>
          method === "PUT" &&
          url.endsWith("/chat-defaults") &&
          (body as { agentId?: string }).agentId === "ours"
            ? { error: { code: "unknown_agent", message: "no such Agent" } }
            : undefined,
      });
      try {
        await bootOn(remote);

        await t.deps.machines.syncConfigEverywhere(PROJECT);

        const base = `/api/projects/${PROJECT}`;
        expect(remote.writes.filter((w) => w.url !== `${base}/models`)).toEqual([
          {
            method: "PUT",
            url: `${base}/command-policy`,
            body: { enabled: false, rules: [{ name: "no-rm", pattern: "rm -rf", enabled: true }] },
          },
          {
            method: "PUT",
            url: `${base}/chat-defaults`,
            body: { agentId: "ours", thinkingLevel: "high", workspace: "/srv/theirs" },
          },
          {
            method: "PUT",
            url: `${base}/chat-defaults`,
            body: { thinkingLevel: "high", workspace: "/srv/theirs", agentId: "their-agent" },
          },
        ]);
        // A default Agent the machine lacks is not a failed sync; a key from this server's
        // environment is what the sync says it could not carry.
        expect(nas().configSync).toMatchObject({
          ok: true,
          envOnly: [
            {
              projectId: PROJECT,
              provider: "openai",
              modelId: "gpt-5",
              variable: "OPENAI_API_KEY",
            },
          ],
          skipped: [],
        });
      } finally {
        remote.close();
      }
    });

    it("Sync config checks the build, then syncs; a part the machine refuses is said, and the rest still lands", async () => {
      const remote = await machineServer({
        refuse: (method, url) =>
          method === "PUT" && url.endsWith("/command-policy")
            ? { error: { code: "invalid_rules", message: "rules exceeds 64 entries." } }
            : undefined,
      });
      try {
        await bootOn(remote);

        const job = await syncNow();

        expect(job.kind).toBe("sync");
        expect(job.steps).toEqual(["check", "sync"]);
        expect(job.result).toMatchObject({ ok: false, step: "sync", canReplaceProgram: false });
        const refusal = `The command policy of ${PROJECT} not synced — it answered 400`;
        expect((job.result as { message: string }).message).toContain(refusal);
        expect(job.log.join("\n")).toContain(`Models synced: ${PROJECT}.`);
        expect(job.log.join("\n")).toContain(
          "Not carried — these authenticate from this server's environment: openai/gpt-5 (OPENAI_API_KEY)",
        );
        expect(remote.writes.map((w) => w.url)).toEqual([
          `/api/projects/${PROJECT}/models`,
          `/api/projects/${PROJECT}/command-policy`,
          `/api/projects/${PROJECT}/chat-defaults`,
        ]);
        expect(nas().configSync).toMatchObject({
          ok: false,
          detail: expect.stringContaining(refusal),
        });
      } finally {
        remote.close();
      }
    });

    it("Sync config refuses a machine on another build at its first step, writing nothing, and one not connected up front", async () => {
      const remote = await machineServer({ runs: "9.9.8" });
      try {
        await bootOn(remote);

        const job = await syncNow();

        expect(job.result).toEqual({
          ok: false,
          step: "check",
          message:
            "That machine runs 9.9.8; it must be updated to 9.9.9 before it can use this server's models.",
          canReplaceProgram: false,
        });
        expect(remote.writes).toEqual([]);

        connected.delete("ssh:nas");
        const res = await admin.post(`/api/projects/${PROJECT}/machines/ssh:nas/sync`);
        expect(res.status).toBe(409);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
          "not_connected",
        );
      } finally {
        remote.close();
      }
    });

    it("a command policy saved here reaches the Project's machines", async () => {
      await boot();
      const synced = vi.spyOn(service, "syncConfigEverywhere").mockResolvedValue();
      const res = await admin.put(`/api/projects/${PROJECT}/command-policy`, { rules: [] });
      expect(res.status).toBe(200);
      expect(synced).toHaveBeenCalledWith(PROJECT);
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

    it("403s a directory the machine has but refuses to list, with its own code", async () => {
      await boot({
        runOn: async (_t, command) =>
          command.includes("---penguin-dirs---")
            ? { code: 4, stdout: "", stderr: "", timedOut: false }
            : { code: 0, stdout: "", stderr: "", timedOut: false },
      });
      connectedMachine();
      const res = await admin.get(`/api/projects/${PROJECT}/machines/${ID}/dirs?path=/root`);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "dir_permission_denied",
      );
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

    it("adopts a machine when it first records it, not when its id is heard, and a repointed alias adopts the newcomer", async () => {
      let id: string | null = null;
      let now = "2026-08-24T12:00:00.000Z";
      await boot({
        now: () => new Date(now),
        probe: async () => ({ state: { kind: "running", port: 7364, pid: 1 }, machineId: id }),
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(machinesRepo.get("ssh:nas")?.adoptedAt).toBe("2026-08-24T12:00:00.000Z");

      // The machine saying who it is later is the same machine this server took up already:
      // what was created on it through this server since must not start reading as its own.
      now = "2026-08-25T12:00:00.000Z";
      id = ID;
      await admin.post("/api/projects/default_project/machines/probe");
      expect((await byId("ssh:nas"))?.machineId).toBe(ID);
      expect(machinesRepo.get("ssh:nas")?.adoptedAt).toBe("2026-08-24T12:00:00.000Z");

      now = "2026-08-26T12:00:00.000Z";
      id = "PO_VCwpQrw1hQLV-";
      await admin.post("/api/projects/default_project/machines/probe");
      expect(machinesRepo.get("ssh:nas")?.adoptedAt).toBe("2026-08-26T12:00:00.000Z");
    });

    it.each([
      ["whose id it had heard", ID],
      ["whose id it had not heard yet", null],
    ])(
      "never gives a machine adopted before adoption times were kept one, %s: not on a probe, not on a connect",
      async (_, known) => {
        // The user's decision (2026-10-15): the Sessions on such a machine stay as they are.
        await boot({
          probe: async () => ({ state: { kind: "running", port: 7364, pid: 1 }, machineId: ID }),
        });
        machinesRepo.patch("ssh:nas", {
          ...(known === null ? {} : { machineId: known }),
          version: "9.9.9",
          installedAt: "2026-08-01T00:00:00.000Z",
        });
        machinesRepo.setMembers("default_project", ["ssh:nas"]);
        await admin.post("/api/projects/default_project/machines/probe");
        expect((await byId("ssh:nas"))?.machineId).toBe(ID);
        expect(machinesRepo.get("ssh:nas")?.adoptedAt).toBeNull();

        await admin.post("/api/projects/default_project/machines/ssh:nas/connect");
        await waitFor(() => t.deps.machines.job()?.running === false);
        expect(machinesRepo.get("ssh:nas")?.adoptedAt).toBeNull();
      },
    );

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

  describe("using machines", () => {
    const useBody = (machines: string[], replaceProgram = false) =>
      admin.post("/api/projects/default_project/machines/use", {
        machines,
        ...(replaceProgram ? { replaceProgram } : {}),
      });
    const jobsOf = () => t.deps.machines.jobs();
    const settled = () => jobsOf().every((job) => !job.queued && !job.running);

    it("a batch works its machines side by side, and each ends connected", async () => {
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const installs: string[] = [];
      await boot({
        install: async (opts) => {
          installs.push(opts.target.alias);
          if (installs.length === 1) await held;
          return { kind: "installed", output: "done", identity: IDENTITY };
        },
      });
      const started = await useBody(["ssh:build-box", "ssh:nas"]);
      expect(started.status).toBe(202);
      const body = (await started.json()) as MachinesUseResponse;
      expect(body.refused).toEqual([]);
      // Two hosts, two jobs at once: the second does not wait for the first's held install.
      expect(body.jobs.map((job) => [job.machineId, job.queued, job.running])).toEqual([
        ["ssh:build-box", false, true],
        ["ssh:nas", false, true],
      ]);
      await waitFor(() => jobsOf().some((job) => job.machineId === "ssh:nas" && !job.running));
      expect(jobsOf().find((job) => job.machineId === "ssh:build-box")?.running).toBe(true);

      release();
      await waitFor(settled);
      expect([...installs].sort()).toEqual(["build-box", "nas"]);
      for (const job of jobsOf()) {
        expect(job.kind).toBe("use");
        expect(job.result).toEqual({ ok: true, connected: true });
      }
      expect(connected).toEqual(new Set(["ssh:build-box", "ssh:nas"]));
      expect(Object.keys(recordsInStore()).sort()).toEqual(["ssh:build-box", "ssh:nas"]);
    });

    it("a machine already on this build is not reinstalled: use goes straight to connecting", async () => {
      let installs = 0;
      await boot({
        install: async () => {
          installs += 1;
          return { kind: "installed", output: "done", identity: IDENTITY };
        },
      });
      machinesRepo.patch("ssh:nas", { version: "9.9.9", installedAt: "2026-08-01T00:00:00.000Z" });
      machinesRepo.setMembers("default_project", ["ssh:nas"]);
      await useBody(["ssh:nas"]);
      await waitFor(settled);
      expect(installs).toBe(0);
      expect(jobsOf()[0]?.log[0]).toBe("Already on 9.9.9.");
      expect(jobsOf()[0]?.result).toEqual({ ok: true, connected: true });
    });

    it("a machine behind this build is brought forward first, then connected", async () => {
      let installs = 0;
      await boot({
        install: async () => {
          installs += 1;
          return { kind: "installed", output: "done", identity: IDENTITY };
        },
      });
      machinesRepo.patch("ssh:nas", { version: "9.9.8", installedAt: "2026-08-01T00:00:00.000Z" });
      machinesRepo.setMembers("default_project", ["ssh:nas"]);
      await useBody(["ssh:nas"]);
      await waitFor(settled);
      expect(installs).toBe(1);
      expect(jobsOf()[0]?.result).toEqual({ ok: true, connected: true });
      expect(recordsInStore()["ssh:nas"]?.version).toBe("9.9.9");
    });

    it("an install that fails stops that machine's job there, with the forced install on offer, and the next machine still runs", async () => {
      await boot({
        install: async (opts) =>
          opts.target.alias === "build-box"
            ? { kind: "failed", step: "install", detail: "error: checksum mismatch for Bundle." }
            : { kind: "installed", output: "done", identity: IDENTITY },
      });
      await useBody(["ssh:build-box", "ssh:nas"]);
      await waitFor(settled);
      const [box, nas] = jobsOf();
      expect(box?.result).toEqual({
        ok: false,
        step: "install",
        message: "error: checksum mismatch for Bundle.",
        canReplaceProgram: true,
      });
      expect(nas?.result).toEqual({ ok: true, connected: true });
      expect(connected).toEqual(new Set(["ssh:nas"]));
    });

    it("a failure ssh itself caused does not offer installing anyway, which would stop at the same door", async () => {
      await boot({
        install: async () => ({
          kind: "failed",
          step: "connect",
          detail:
            "nas did not accept any key this computer offered. (ssh: Permission denied (publickey).)",
        }),
      });
      await useBody(["ssh:nas"]);
      await waitFor(settled);
      expect(jobsOf()[0]?.result).toMatchObject({
        ok: false,
        step: "connect",
        canReplaceProgram: false,
        sshReason: "auth",
      });
    });

    it("a machine on this image's version whose web, CLI or assets differ is handed the build, not skipped", async () => {
      let installs = 0;
      await boot({
        resolvePlan: () => PUSHED_PLAN,
        install: async () => {
          installs += 1;
          return { kind: "already-installed", version: PUSHED_PLAN.version, identity: IDENTITY };
        },
        runOn: async (_target, command) => ({
          code: 0,
          // The machine's probe: same release, a harness naming another CLI bundle.
          stdout: command.includes("uname -s -m")
            ? 'Linux x86_64\n---penguin---\n{"version":"9.9.9"}\n---penguin---\n{"platform":{"bundle":"store/platform/cafe.mjs"},"cli":{"bundle":"store/cli/beef.mjs"}}\n'
            : "---penguin-auth-token---\nremote-token\n",
          stderr: "",
          timedOut: false,
        }),
      });
      machinesRepo.patch("ssh:nas", {
        version: PUSHED_PLAN.version,
        installedAt: "2026-08-01T00:00:00.000Z",
      });
      machinesRepo.setMembers("default_project", ["ssh:nas"]);
      await useBody(["ssh:nas"]);
      await waitFor(settled);
      expect(installs).toBe(1);
      expect(jobsOf()[0]?.log).not.toContain(`Already on ${PUSHED_PLAN.version}.`);
    });

    it("refusals that need no ssh come back by id, and the rest of the batch is still queued", async () => {
      await boot();
      const body = (await (
        await useBody(["ssh:nope", "local", "ssh:nas"])
      ).json()) as MachinesUseResponse;
      expect(body.refused).toEqual([
        { machineId: "ssh:nope", why: "unknown-machine" },
        { machineId: "local", why: "self" },
      ]);
      expect(body.jobs.map((job) => job.machineId)).toEqual(["ssh:nas"]);
      await waitFor(settled);
    });

    it("an empty batch is a bad request", async () => {
      await boot();
      expect((await useBody([])).status).toBe(400);
    });

    it("adding puts machines on this Project's list without reaching them, and stop using takes them off", async () => {
      let reached = 0;
      await boot({
        install: async () => {
          reached += 1;
          return { kind: "installed", output: "done", identity: IDENTITY };
        },
        runOn: async () => {
          reached += 1;
          return { code: 0, stdout: "", stderr: "", timedOut: false };
        },
      });
      const added = await admin.post("/api/projects/default_project/machines/add", {
        machines: ["ssh:nas", "local", "ssh:nope"],
      });
      expect(added.status).toBe(200);
      const body = (await added.json()) as MachinesUseResponse;
      expect(body.refused).toEqual([
        { machineId: "local", why: "self" },
        { machineId: "ssh:nope", why: "unknown-machine" },
      ]);
      const nas = body.machines.find((machine) => machine.id === "ssh:nas");
      expect(nas).toMatchObject({ member: true, installed: null });
      expect(body.jobs).toEqual([]);
      expect(reached).toBe(0);

      await admin.post("/api/projects/default_project/machines/stop-using", {
        machines: ["ssh:nas"],
      });
      const after = (await (
        await admin.get("/api/projects/default_project/machines")
      ).json()) as MachinesResponse;
      expect(after.machines.find((machine) => machine.id === "ssh:nas")?.member).toBeUndefined();
    });

    it("a machine asked for is on the list at once, and stays there with its failed first enable until stop using lets both go", async () => {
      await boot({
        install: async () => ({ kind: "failed", step: "install", detail: "error: no space left" }),
      });
      const started = (await (await useBody(["ssh:nas"])).json()) as MachinesUseResponse;
      expect(started.machines.find((machine) => machine.id === "ssh:nas")?.member).toBe(true);
      await waitFor(settled);
      expect(jobsOf().map((job) => job.machineId)).toEqual(["ssh:nas"]);
      const failed = (await (
        await admin.get("/api/projects/default_project/machines")
      ).json()) as MachinesResponse;
      expect(failed.machines.find((machine) => machine.id === "ssh:nas")).toMatchObject({
        member: true,
        installed: null,
      });
      await admin.post("/api/projects/default_project/machines/stop-using", {
        machines: ["ssh:nas"],
      });
      expect(jobsOf()).toEqual([]);
    });

    it("stop using drops the connection and the membership, and keeps the install", async () => {
      await boot();
      await useBody(["ssh:nas"]);
      await waitFor(settled);
      expect(connected.has("ssh:nas")).toBe(true);
      const stopped = await admin.post("/api/projects/default_project/machines/stop-using", {
        machines: ["ssh:nas"],
      });
      expect(stopped.status).toBe(200);
      const body = (await stopped.json()) as MachinesResponse;
      const nas = body.machines.find((machine) => machine.id === "ssh:nas");
      // Released from the Project, the install itself remembered as somebody else's.
      expect(nas?.installed).toBeNull();
      expect(nas?.elsewhere?.version).toBe("9.9.9");
      // Nothing re-holds a machine nobody uses: the held mark is gone from the record. (The
      // fake transport's own registry is not the record's; the real one closes with the ssh.)
      expect(machinesRepo.get("ssh:nas")?.sessionPid ?? null).toBeNull();
    });

    it("a machine whose re-hold failed waits out a backoff before the next try", async () => {
      // A host that is down costs one ssh per try; without a backoff the standing intent
      // would knock on it every few seconds forever.
      let holds = 0;
      let clock = new Date("2026-08-24T12:00:00.000Z");
      await boot({
        now: () => clock,
        hold: async () => {
          holds += 1;
          return { ok: false, detail: "Connection refused" };
        },
      });
      machinesRepo.patch("ssh:nas", {
        version: "9.9.9",
        installedAt: "2026-08-01T00:00:00.000Z",
        sessionPid: 4242,
      });
      machinesRepo.setMembers("default_project", ["ssh:nas"]);
      await t.deps.machines.autoConnect();
      expect(holds).toBe(1);
      const reconnect = () =>
        t.deps.machines.list(PROJECT).find((m) => m.id === "ssh:nas")?.reconnect;
      expect(reconnect()).toMatchObject({
        since: "2026-08-24T12:00:00.000Z",
        attempts: 1,
        nextAt: "2026-08-24T12:00:30.000Z",
        lastError: "Connection refused",
      });
      // Within thirty seconds after the first failure: not tried again.
      clock = new Date(clock.getTime() + 29_000);
      await t.deps.machines.autoConnect();
      expect(holds).toBe(1);
      // Once the wait has passed, it is.
      clock = new Date(clock.getTime() + 2_000);
      await t.deps.machines.autoConnect();
      expect(holds).toBe(2);
      // The second failure doubles the wait: a minute now, so forty-five seconds later is too soon.
      clock = new Date(clock.getTime() + 45_000);
      await t.deps.machines.autoConnect();
      expect(holds).toBe(2);
      expect(Date.parse(reconnect()!.nextAt!) - clock.getTime()).toBe(15_000);
    });
  });

  describe("a job's steps", () => {
    const use = (machines: string[]) =>
      admin.post("/api/projects/default_project/machines/use", { machines });
    const settled = () => t.deps.machines.jobs().every((job) => !job.queued && !job.running);
    const jobOf = (id: string) => t.deps.machines.jobs().find((job) => job.machineId === id);

    it("names its own steps, and moves through them forward only", async () => {
      // Where the job stood when each piece of work ran: an install, the server started after
      // it, the connection held. A connect behind an install is already connecting — the
      // stepper never goes back to "check" to ask what runs there.
      const at: Record<string, string | null> = {};
      await boot({
        install: async () => {
          at.install = jobOf("ssh:nas")?.phase ?? null;
          return { kind: "installed", output: "", identity: IDENTITY };
        },
        probe: async () => ({ state: { kind: "stopped" }, machineId: null }),
        startServer: async () => {
          at.start = jobOf("ssh:nas")?.phase ?? null;
          return { ok: true };
        },
        hold: async (target) => {
          at.hold = jobOf("ssh:nas")?.phase ?? null;
          connected.add(`ssh:${target.alias}`);
          return { ok: true, session: { pid: process.pid, socksPort: 1 } };
        },
      });
      await use(["ssh:nas"]);
      await waitFor(settled);
      expect(jobOf("ssh:nas")?.steps).toEqual([
        "check",
        "install",
        "handover",
        "restart",
        "connect",
        "sync",
      ]);
      expect(at).toEqual({ install: "install", start: "connect", hold: "connect" });
      expect(jobOf("ssh:nas")?.phase).toBe("sync");
    });

    it("a stop and an uninstall have steps of their own", async () => {
      await boot();
      machinesRepo.patch("ssh:nas", { version: "9.9.9", installedAt: "2026-08-01T00:00:00Z" });
      machinesRepo.patch("ssh:build-box", {
        version: "9.9.9",
        installedAt: "2026-08-01T00:00:00Z",
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/stop");
      await admin.post("/api/projects/default_project/machines/ssh:build-box/uninstall", {});
      await waitFor(settled);
      expect(jobOf("ssh:nas")?.steps).toEqual(["check", "stop"]);
      expect(jobOf("ssh:build-box")?.steps).toEqual(["check", "stop", "remove"]);
    });

    it("tells the page of every change, a burst of lines as a few", async () => {
      let told = 0;
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await boot({
        announce: () => {
          told += 1;
        },
        install: async (opts) => {
          // A chatty installer: fifty lines at once.
          for (let i = 0; i < 50; i++) opts.onProgress?.(`line ${i}`);
          await held;
          return { kind: "installed", output: "", identity: IDENTITY };
        },
      });
      await use(["ssh:nas"]);
      await waitFor(() => jobOf("ssh:nas")?.log.includes("line 49") === true);
      // The first change goes out at once; the burst after it is folded into one more.
      expect(told).toBeGreaterThan(0);
      expect(told).toBeLessThanOrEqual(3);
      const before = told;
      release();
      await waitFor(settled);
      // The end of the job is told as well — after the window, if one was open.
      await waitFor(() => told > before);
    });
  });

  describe("keeping machines connected", () => {
    /** The listener the service gave the transport, to tell it of a drop by hand. */
    let tell: ((address: string, up: boolean) => void) | null = null;
    const watch = (listener: (address: string, up: boolean) => void) => {
      tell = listener;
      return () => {
        tell = null;
      };
    };
    const kept = () => {
      machinesRepo.patch("ssh:nas", {
        version: "9.9.9",
        installedAt: "2026-08-01T00:00:00.000Z",
        sessionPid: 4242,
        remotePort: 7364,
        machineId: "NASmachineID0000",
      });
      machinesRepo.setMembers("default_project", ["ssh:nas"]);
    };
    const nas = () => t.deps.machines.list(PROJECT).find((m) => m.id === "ssh:nas");

    it("a connection that drops is brought back on its own", async () => {
      let holds = 0;
      let clock = new Date("2026-08-24T12:00:00.000Z");
      await boot({
        now: () => clock,
        watchSessions: watch,
        hold: async (target) => {
          holds += 1;
          connected.add(`ssh:${target.alias}`);
          return { ok: true, session: { pid: process.pid, socksPort: 1 } };
        },
      });
      kept();
      await t.deps.machines.autoConnect();
      expect(holds).toBe(1);
      expect(nas()?.keepConnected).toBe(true);
      expect(nas()?.reconnect).toBeUndefined();

      // The ssh session dies under it.
      connected.delete("ssh:nas");
      tell!("ssh:nas", false);
      expect(nas()?.reconnect).toMatchObject({
        since: "2026-08-24T12:00:00.000Z",
        attempts: 0,
        // Its first try is a while out, so a server restarting itself is back by then.
        nextAt: "2026-08-24T12:00:15.000Z",
        lastError: null,
        diagnosis: null,
      });
      await t.deps.machines.autoConnect();
      expect(holds).toBe(1);
      clock = new Date(clock.getTime() + 15_000);
      await t.deps.machines.autoConnect();
      expect(holds).toBe(2);
      expect(nas()?.reconnect).toBeUndefined();
      expect(nas()?.connection).not.toBeNull();
    });

    it("three failures in a row run the connection check, and its answer is the explanation", async () => {
      let clock = new Date("2026-08-24T12:00:00.000Z");
      await boot({
        now: () => clock,
        hold: async () => ({
          ok: false,
          detail: "ssh: connect to host nas port 22: Connection refused",
        }),
        probe: async () => ({
          state: {
            kind: "unreachable",
            detail: "ssh: connect to host nas port 22: Connection refused",
          },
          machineId: null,
        }),
        runOn: async () => ({
          code: 255,
          stdout: "ssh: connect to host nas port 22: Connection refused",
          stderr: "",
          timedOut: false,
        }),
      });
      kept();
      for (let i = 0; i < 3; i++) {
        await t.deps.machines.autoConnect();
        expect(nas()?.reconnect?.attempts).toBe(i + 1);
        if (i < 2) expect(nas()?.reconnect?.diagnosis).toBeNull();
        clock = new Date(clock.getTime() + 5 * 60_000);
      }
      const reconnect = nas()?.reconnect;
      expect(reconnect?.sshReason).toBe("refused");
      expect(reconnect?.diagnosis?.checks[0]).toMatchObject({
        id: "ssh",
        state: "fail",
        reason: "refused",
      });
    });

    it("a stopped machine stays stopped: no retries, and no reconnect after a restart", async () => {
      let holds = 0;
      let stops = 0;
      let running = true;
      await boot({
        watchSessions: watch,
        hold: async (target) => {
          holds += 1;
          connected.add(`ssh:${target.alias}`);
          return { ok: true, session: { pid: process.pid, socksPort: 1 } };
        },
        probe: async () =>
          running
            ? { state: { kind: "running", port: 7364, pid: 4242 }, machineId: "NASmachineID0000" }
            : { state: { kind: "stopped" }, machineId: "NASmachineID0000" },
        stopServer: async () => {
          stops += 1;
          running = false;
          return { ok: true as const };
        },
      });
      kept();
      await t.deps.machines.autoConnect();
      expect(holds).toBe(1);
      const res = await admin.post("/api/projects/default_project/machines/ssh:nas/stop");
      expect(res.status).toBe(202);
      await waitFor(() => t.deps.machines.jobs().every((job) => !job.running && !job.queued));
      expect(t.deps.machines.jobs()[0]?.result).toEqual({ ok: true, stopped: true });
      expect(stops).toBe(1);
      // The held mark is gone from the record; the connection closed with it (the real
      // transport's registry, which this suite's fake stands beside, is told by the service).
      expect(machinesRepo.get("ssh:nas")?.sessionPid).toBeNull();
      connected.delete("ssh:nas");
      expect(nas()?.keepConnected).toBeUndefined();
      // Its events stopping is the stop's own doing; nothing brings it back, now or at a boot.
      tell?.("ssh:nas", false);
      expect(nas()?.reconnect).toBeUndefined();
      await t.deps.machines.start();
      expect(holds).toBe(1);
      // Started again, it is kept connected again.
      await admin.post("/api/projects/default_project/machines/ssh:nas/connect");
      await waitFor(() => t.deps.machines.jobs().every((job) => !job.running && !job.queued));
      expect(holds).toBe(2);
      expect(nas()?.keepConnected).toBe(true);
    });

    it("a stop while the boot is still bringing machines back leaves nothing behind it", async () => {
      let release!: () => void;
      const answered = new Promise<void>((resolve) => {
        release = resolve;
      });
      let holds = 0;
      await boot({
        watchSessions: watch,
        hold: async (target) => {
          holds += 1;
          await answered;
          connected.add(`ssh:${target.alias}`);
          return { ok: true, session: { pid: process.pid, socksPort: 1 } };
        },
      });
      kept();
      const booting = t.deps.machines.start();
      await waitFor(() => holds === 1);
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      try {
        // The App goes away — a hot push, a shutdown — while the machine is still on its way back.
        t.deps.machines.stop();
        release();
        await booting;
        // A boot that finishes arms a look-over that reads the list every minute. This one was
        // cut short: a look-over armed now would read a store its App has closed.
        expect(vi.getTimerCount()).toBe(0);
        await t.deps.machines.autoConnect();
        expect(holds).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("a refused password stops the retries until a password is saved for the machine again", async () => {
      let clock = new Date("2026-08-24T12:00:00.000Z");
      const refusal =
        "nas rejected the password saved for it. Enter it again in this machine's SSH settings. " +
        "(ssh: deploy@nas: Permission denied (publickey,password).)";
      let probes = 0;
      let signedInWithPassword = false;
      let accepts = false;
      await boot({
        now: () => clock,
        passwordSignIn: async () => ({ ok: true, detached: false }),
        readConfig: () =>
          "# Added by PenguinHarness on 2026-08-01T00:00:00.000Z\nHost nas\n  HostName 10.0.0.2\n",
        writeConfig: () => {},
        probe: async (target) => {
          probes += 1;
          signedInWithPassword = target.password !== undefined;
          return accepts
            ? { state: { kind: "running", port: 7364, pid: 4242 }, machineId: null }
            : { state: { kind: "unreachable", detail: refusal }, machineId: null };
        },
      });
      kept();
      const host = "/api/projects/default_project/machines/ssh-hosts/nas";
      expect((await admin.put(host, { hostName: "10.0.0.2", password: "old" })).status).toBe(200);
      await t.deps.machines.autoConnect();
      expect(probes).toBe(1);
      expect(signedInWithPassword).toBe(true);
      expect(nas()?.reconnect).toMatchObject({
        attempts: 1,
        nextAt: null,
        sshReason: "password-rejected",
        waitsForPassword: true,
        diagnosis: null,
      });
      // However long it waits, nothing tries the account again — a person's Retry included, which
      // is told what to do instead.
      clock = new Date(clock.getTime() + 60 * 60_000);
      await t.deps.machines.autoConnect();
      const retried = await admin.post("/api/projects/default_project/machines/ssh:nas/reconnect");
      expect(retried.status).toBe(409);
      expect(((await retried.json()) as { error: { code: string } }).error.code).toBe(
        "password_refused",
      );
      expect(probes).toBe(1);

      // A password saved for it: tried once, at once, and connected.
      accepts = true;
      expect((await admin.put(host, { hostName: "10.0.0.2", password: "new" })).status).toBe(200);
      await waitFor(() => nas()?.reconnect === undefined);
      expect(probes).toBeGreaterThan(1);
      expect(nas()?.connection).not.toBeNull();
    });

    /** ssh's words when nothing listens on the port: a failure another try may well mend. */
    const REFUSED = "ssh: connect to host nas port 22: Connection refused";
    const RECONNECT = "/api/projects/default_project/machines/ssh:nas/reconnect";
    const at = (ms: number) => new Date(ms).toISOString();
    /**
     * A service keeping nas connected, whose host answers each probe with ssh's `said` — null for
     * up and running — after `hold` settles when one is set. `probes` counts the probes, one per
     * attempt or connect; the connection check asks through `runOn`, never the probe. A probe
     * whose work is cut answers at once, as the transport's own cut does.
     */
    const host = async (now: () => Date) => {
      const far = { said: REFUSED as string | null, probes: 0, hold: null as Promise<void> | null };
      await boot({
        now,
        probe: async (target) => {
          far.probes += 1;
          const cut = new Promise<void>((resolve) =>
            target.signal?.addEventListener("abort", () => resolve(), { once: true }),
          );
          if (far.hold !== null) await Promise.race([far.hold, cut]);
          if (target.signal?.aborted === true) {
            return { state: { kind: "unreachable", detail: "stopped" }, machineId: null };
          }
          return far.said === null
            ? { state: { kind: "running", port: 7364, pid: 4242 }, machineId: null }
            : { state: { kind: "unreachable", detail: far.said }, machineId: null };
        },
        runOn: async () =>
          far.said === null
            ? {
                code: 0,
                stdout: "---penguin-auth-token---\nremote-token\n",
                stderr: "",
                timedOut: false,
              }
            : { code: 255, stdout: far.said, stderr: "", timedOut: false },
      });
      kept();
      return far;
    };
    /** The look-over, once per step of the clock, `times` times — every attempt due by then runs. */
    const lookOver = async (clock: { now: Date }, times: number, stepMs = 5 * 60_000) => {
      for (let i = 0; i < times; i++) {
        if (i > 0) clock.now = new Date(clock.now.getTime() + stepMs);
        await t.deps.machines.autoConnect();
      }
    };

    it("five failures in a row stop the automatic attempts, and the look-over tries nothing after", async () => {
      const clock = { now: new Date("2026-08-24T12:00:00.000Z") };
      const far = await host(() => clock.now);
      await lookOver(clock, 5);
      expect(far.probes).toBe(5);
      expect(nas()?.reconnect).toMatchObject({
        attempts: 5,
        maxAttempts: 5,
        gaveUp: "attempts",
        nextAt: null,
        sshReason: "refused",
      });
      // An hour of look-overs later: not one more try, and still saying it stopped.
      await lookOver(clock, 13);
      expect(far.probes).toBe(5);
      expect(nas()?.reconnect).toMatchObject({ attempts: 5, gaveUp: "attempts" });
    });

    it("Retry after the stop runs one attempt at once and counts from the first again; a second press meanwhile starts nothing", async () => {
      const clock = { now: new Date("2026-08-24T12:00:00.000Z") };
      const far = await host(() => clock.now);
      await lookOver(clock, 5);
      expect(nas()?.reconnect?.gaveUp).toBe("attempts");
      let release!: () => void;
      far.hold = new Promise((resolve) => {
        release = resolve;
      });
      const pressed = await admin.post(RECONNECT);
      expect(pressed.status).toBe(200);
      // The answer already says an attempt is under way, in a streak begun now.
      const answered = ((await pressed.json()) as MachinesResponse).machines.find(
        (m) => m.id === "ssh:nas",
      )?.reconnect;
      expect(answered).toMatchObject({ since: at(clock.now.getTime()), attempts: 0, nextAt: null });
      expect(answered?.gaveUp).toBeUndefined();
      await waitFor(() => far.probes === 6);
      expect((await admin.post(RECONNECT)).status).toBe(200);
      release();
      await waitFor(() => typeof nas()?.reconnect?.nextAt === "string");
      expect(far.probes).toBe(6);
      // It failed again: the first of a new streak, waiting the first doubled wait.
      expect(nas()?.reconnect).toMatchObject({
        attempts: 1,
        nextAt: at(clock.now.getTime() + 30_000),
      });
      expect(nas()?.reconnect?.gaveUp).toBeUndefined();
    });

    it("Retry while a streak waits out its backoff runs the attempt now, and the count goes on", async () => {
      const clock = { now: new Date("2026-08-24T12:00:00.000Z") };
      const far = await host(() => clock.now);
      await lookOver(clock, 3);
      expect(nas()?.reconnect).toMatchObject({
        attempts: 3,
        nextAt: at(clock.now.getTime() + 120_000),
      });
      expect((await admin.post(RECONNECT)).status).toBe(200);
      await waitFor(() => far.probes === 4 && typeof nas()?.reconnect?.nextAt === "string");
      expect(nas()?.reconnect).toMatchObject({
        attempts: 4,
        nextAt: at(clock.now.getTime() + 240_000),
      });
    });

    const STOP = "/api/projects/default_project/machines/ssh:nas/stop-reconnecting";

    it("Stop retrying while a streak waits stops it at once: nothing runs after it until a Retry, which counts from the first again", async () => {
      const clock = { now: new Date("2026-08-24T12:00:00.000Z") };
      const far = await host(() => clock.now);
      await lookOver(clock, 2);
      expect(nas()?.reconnect).toMatchObject({
        attempts: 2,
        nextAt: at(clock.now.getTime() + 60_000),
      });
      const stopped = await admin.post(STOP);
      expect(stopped.status).toBe(200);
      const answered = ((await stopped.json()) as MachinesResponse).machines.find(
        (m) => m.id === "ssh:nas",
      )?.reconnect;
      expect(answered).toMatchObject({ attempts: 2, gaveUp: "cancelled", nextAt: null });
      // An hour of look-overs: not one more try, and a second press changes nothing.
      await lookOver(clock, 13);
      expect((await admin.post(STOP)).status).toBe(200);
      expect(far.probes).toBe(2);
      expect(nas()?.reconnect).toMatchObject({ attempts: 2, gaveUp: "cancelled" });
      expect((await admin.post(RECONNECT)).status).toBe(200);
      await waitFor(() => far.probes === 3 && typeof nas()?.reconnect?.nextAt === "string");
      expect(nas()?.reconnect).toMatchObject({
        attempts: 1,
        nextAt: at(clock.now.getTime() + 30_000),
      });
      expect(nas()?.reconnect?.gaveUp).toBeUndefined();
    });

    it("Stop retrying during an attempt ends it at once: Update starts straight away, and the cut attempt is not counted", async () => {
      const clock = { now: new Date("2026-08-24T12:00:00.000Z") };
      const far = await host(() => clock.now);
      await lookOver(clock, 1);
      let release!: () => void;
      far.hold = new Promise((resolve) => {
        release = resolve;
      });
      clock.now = new Date(clock.now.getTime() + 60_000);
      const running = t.deps.machines.autoConnect();
      await waitFor(() => far.probes === 2);
      expect((await admin.post(STOP)).status).toBe(200);
      // The machine is free at once: the job runs now, it does not wait behind the attempt.
      const used = await admin.post("/api/projects/default_project/machines/use", {
        machines: ["ssh:nas"],
      });
      expect(used.status).toBe(202);
      const job = ((await used.json()) as MachinesUseResponse).jobs.find(
        (entry) => entry.machineId === "ssh:nas",
      );
      expect(job).toMatchObject({ queued: false, running: true });
      release();
      await running;
      await waitFor(() => t.deps.machines.jobs().every((entry) => !entry.running && !entry.queued));
      // The cut attempt is neither counted nor said, and nothing is scheduled after it.
      expect(nas()?.reconnect).toMatchObject({
        attempts: 1,
        gaveUp: "cancelled",
        nextAt: null,
        lastError: REFUSED,
      });
      await lookOver(clock, 13);
      expect(far.probes).toBe(2);
    });

    it("a job pressed during an attempt starts at once; the attempt is not counted, and the streak looks again once the job is done", async () => {
      const clock = { now: new Date("2026-08-24T12:00:00.000Z") };
      const far = await host(() => clock.now);
      await lookOver(clock, 1);
      let release!: () => void;
      far.hold = new Promise((resolve) => {
        release = resolve;
      });
      clock.now = new Date(clock.now.getTime() + 60_000);
      const running = t.deps.machines.autoConnect();
      await waitFor(() => far.probes === 2);
      const restarted = await admin.post("/api/projects/default_project/machines/ssh:nas/restart");
      expect(restarted.status).toBe(202);
      const job = ((await restarted.json()) as MachinesResponse).jobs.find(
        (entry) => entry.machineId === "ssh:nas",
      );
      expect(job).toMatchObject({ kind: "restart", queued: false, running: true });
      await running;
      expect(nas()?.reconnect).toMatchObject({
        attempts: 1,
        lastError: REFUSED,
        nextAt: at(clock.now.getTime() + 5_000),
      });
      expect(nas()?.reconnect?.gaveUp).toBeUndefined();
      // The host answers again, and the restart goes through.
      far.said = null;
      release();
      await waitFor(() => t.deps.machines.jobs().every((entry) => !entry.running && !entry.queued));
      expect(t.deps.machines.jobs().find((entry) => entry.machineId === "ssh:nas")?.result).toEqual(
        { ok: true, connected: true },
      );
      clock.now = new Date(clock.now.getTime() + 5_000);
      await t.deps.machines.autoConnect();
      expect(nas()?.reconnect).toBeUndefined();
      expect(nas()?.connection).not.toBeNull();
    });

    it("Retry after stopping an attempt runs a new one at once, the first of a new round", async () => {
      const clock = { now: new Date("2026-08-24T12:00:00.000Z") };
      const far = await host(() => clock.now);
      await lookOver(clock, 3);
      let release!: () => void;
      far.hold = new Promise((resolve) => {
        release = resolve;
      });
      clock.now = new Date(clock.now.getTime() + 5 * 60_000);
      const running = t.deps.machines.autoConnect();
      await waitFor(() => far.probes === 4);
      expect((await admin.post(STOP)).status).toBe(200);
      far.hold = null;
      const retried = await admin.post(RECONNECT);
      const answered = ((await retried.json()) as MachinesResponse).machines.find(
        (m) => m.id === "ssh:nas",
      )?.reconnect;
      expect(answered).toMatchObject({ attempts: 0, nextAt: null });
      expect(answered?.gaveUp).toBeUndefined();
      await waitFor(() => far.probes === 5 && typeof nas()?.reconnect?.nextAt === "string");
      expect(nas()?.reconnect).toMatchObject({
        attempts: 1,
        nextAt: at(clock.now.getTime() + 30_000),
      });
      release();
      await running;
      expect(far.probes).toBe(5);
      expect(nas()?.reconnect?.attempts).toBe(1);
    });

    it("Retry brings back a machine whose host answers again: the streak ends, and it is connected", async () => {
      const clock = { now: new Date("2026-08-24T12:00:00.000Z") };
      const far = await host(() => clock.now);
      await lookOver(clock, 1);
      expect(nas()?.reconnect?.attempts).toBe(1);
      far.said = null;
      expect((await admin.post(RECONNECT)).status).toBe(200);
      await waitFor(() => nas()?.reconnect === undefined);
      expect(far.probes).toBe(2);
      expect(nas()?.connection).not.toBeNull();
    });

    it("an ssh refusal no retry mends stops the streak at its first failure, with no check, and Retry still tries once", async () => {
      const clock = { now: new Date("2026-08-24T12:00:00.000Z") };
      const far = await host(() => clock.now);
      far.said =
        "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n" +
        "@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n" +
        "Host key verification failed.";
      await lookOver(clock, 1);
      expect(nas()?.reconnect).toMatchObject({
        attempts: 1,
        gaveUp: "ssh",
        nextAt: null,
        sshReason: "host-key-changed",
        diagnosis: null,
      });
      await lookOver(clock, 13);
      expect(far.probes).toBe(1);
      expect((await admin.post(RECONNECT)).status).toBe(200);
      await waitFor(() => far.probes === 2 && nas()?.reconnect?.gaveUp === "ssh");
      expect(nas()?.reconnect).toMatchObject({ attempts: 1, nextAt: null });
    });

    it("Retry refuses, before anything runs, what it cannot bring back, and leaves a connected machine alone", async () => {
      const clock = { now: new Date("2026-08-24T12:00:00.000Z") };
      const far = await host(() => clock.now);
      const code = async (path: string) => {
        const res = await admin.post(path);
        return res.status === 200
          ? 200
          : ((await res.json()) as { error: { code: string } }).error.code;
      };
      const machines = "/api/projects/default_project/machines";
      expect(await code(`${machines}/ssh:not-in-config/reconnect`)).toBe("unknown_machine");
      // Installed, never kept connected: Start is the verb for it.
      machinesRepo.patch("ssh:build-box", {
        version: "9.9.9",
        installedAt: "2026-08-01T00:00:00.000Z",
      });
      expect(await code(`${machines}/ssh:build-box/reconnect`)).toBe("not_kept_connected");
      // A job on the machine decides how it ends.
      let release!: () => void;
      far.hold = new Promise((resolve) => {
        release = resolve;
      });
      far.said = null;
      expect((await admin.post(`${machines}/ssh:nas/connect`)).status).toBe(202);
      await waitFor(() => far.probes === 1);
      expect(await code(RECONNECT)).toBe("job_running");
      release();
      await waitFor(() => t.deps.machines.jobs().every((job) => !job.running && !job.queued));
      expect(nas()?.connection).not.toBeNull();
      // Connected: nothing to retry, and nothing is tried.
      expect(await code(RECONNECT)).toBe(200);
      expect(far.probes).toBe(1);
      expect(nas()?.reconnect).toBeUndefined();
    });

    it("a deleted machine is let go: no retries", async () => {
      await boot({ watchSessions: watch });
      kept();
      connected.add("ssh:nas");
      await admin.post("/api/projects/default_project/machines/stop-using", {
        machines: ["ssh:nas"],
      });
      tell?.("ssh:nas", false);
      expect(nas()?.reconnect).toBeUndefined();
      expect(nas()?.keepConnected).toBeUndefined();
    });
  });

  describe("stopping and uninstalling", () => {
    const settled = () => t.deps.machines.jobs().every((job) => !job.queued && !job.running);
    const jobOf = (id: string) => t.deps.machines.jobs().find((job) => job.machineId === id);
    const installedNas = () => {
      machinesRepo.patch("ssh:nas", {
        version: "9.9.9",
        installedAt: "2026-08-01T00:00:00.000Z",
        sessionPid: 4242,
        remotePort: 7364,
        machineId: "NASmachineID0000",
      });
      machinesRepo.setMembers("default_project", ["ssh:nas"]);
    };

    it("a machine it cannot reach is refused at its first step, with nothing changed", async () => {
      let stops = 0;
      await boot({
        probe: async () => ({
          state: {
            kind: "unreachable",
            detail: "ssh: connect to host nas port 22: Connection timed out",
          },
          machineId: null,
        }),
        stopServer: async () => {
          stops += 1;
          return { ok: true as const };
        },
      });
      installedNas();
      await admin.post("/api/projects/default_project/machines/ssh:nas/stop");
      await waitFor(settled);
      expect(jobOf("ssh:nas")?.result).toMatchObject({
        ok: false,
        step: "check",
        sshReason: "timeout",
        canReplaceProgram: false,
      });
      expect((jobOf("ssh:nas")?.result as { message: string }).message).toMatch(
        /^could not reach that machine, so nothing was stopped: /,
      );
      expect(stops).toBe(0);
      // Still kept connected: the stop did not happen.
      expect(machinesRepo.get("ssh:nas")?.sessionPid).toBe(4242);
    });

    it("an uninstall stops the server, removes the program and keeps the data unless asked", async () => {
      const commands: string[] = [];
      let running = true;
      await boot({
        probe: async () =>
          running
            ? { state: { kind: "running", port: 7364, pid: 4242 }, machineId: "NASmachineID0000" }
            : { state: { kind: "stopped" }, machineId: "NASmachineID0000" },
        stopServer: async () => {
          running = false;
          return { ok: true as const };
        },
        runOn: async (_target, command) => {
          commands.push(command);
          return {
            code: 0,
            stdout: "removed $dir/bin, lib, web and node",
            stderr: "",
            timedOut: false,
          };
        },
      });
      installedNas();
      const res = await admin.post("/api/projects/default_project/machines/ssh:nas/uninstall", {});
      expect(res.status).toBe(202);
      await waitFor(settled);
      expect(jobOf("ssh:nas")?.result).toEqual({ ok: true, uninstalled: true, dataRemoved: false });
      const removal = commands.find((c) => c.includes("rm -rf"));
      expect(removal).toContain('"$dir/bin" "$dir/lib" "$dir/web" "$dir/node"');
      expect(removal).not.toContain('"$dir/data"');
      const nas = t.deps.machines.list(PROJECT).find((m) => m.id === "ssh:nas");
      // Still on the Project's list, as not installed; its id kept with its data.
      expect(nas).toMatchObject({ member: true, installed: null, machineId: "NASmachineID0000" });
      expect(nas?.keepConnected).toBeUndefined();

      // Again, with the data: the id goes with it.
      installedNas();
      running = true;
      commands.length = 0;
      await admin.post("/api/projects/default_project/machines/ssh:nas/uninstall", {
        removeData: true,
      });
      await waitFor(settled);
      expect(jobOf("ssh:nas")?.result).toEqual({ ok: true, uninstalled: true, dataRemoved: true });
      expect(commands.find((c) => c.includes("rm -rf"))).toContain('rm -rf "$dir/data"');
      expect(t.deps.machines.list(PROJECT).find((m) => m.id === "ssh:nas")?.machineId).toBeNull();
    });

    it("refuses what it cannot do before any ssh runs", async () => {
      await boot();
      const code = async (path: string) =>
        (
          (await (
            await admin.post(`/api/projects/default_project/machines/${path}`, {})
          ).json()) as {
            error: { code: string };
          }
        ).error.code;
      expect(await code("ssh:nas/stop")).toBe("not_installed");
      expect(await code("ssh:nas/uninstall")).toBe("not_installed");
      machinesRepo.patch("ssh:nas", { version: "9.9.9", platform: "win32" });
      expect(await code("ssh:nas/stop")).toBe("connect_unsupported");
      expect(await code("ssh:not-in-config/uninstall")).toBe("unknown_machine");
      expect(t.deps.machines.jobs()).toEqual([]);
    });
  });

  describe("adding a host to the ssh config", () => {
    it("lists every host with what its own block says, for the add dialog's rows", async () => {
      await boot({
        listHosts: () => [
          { alias: "build-box", hostName: "box.example.net", user: "deploy", port: 2222 },
          { alias: "nas" },
        ],
      });
      const res = await admin.get("/api/projects/default_project/machines/ssh-hosts");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        hosts: [
          { alias: "build-box", hostName: "box.example.net", user: "deploy", port: 2222 },
          { alias: "nas" },
        ],
      });
    });

    const HOSTS = "/api/projects/default_project/machines/ssh-hosts";
    const post = (body: Record<string, unknown>) => admin.post(HOSTS, body);

    it("appends the block, and the list names the new host at once", async () => {
      const written: string[] = [];
      const aliases = ["build-box", "nas"];
      await boot({
        listAliases: () => aliases,
        appendHost: (block) => {
          written.push(block);
          aliases.push("orchid-2");
        },
      });
      const res = await post({ alias: "orchid-2", hostName: "10.0.0.9", user: "k", port: "2222" });
      expect(res.status).toBe(201);
      expect(written).toEqual([
        [
          "# Added by PenguinHarness on 2026-08-24T12:00:00.000Z",
          "Host orchid-2",
          "  HostName 10.0.0.9",
          "  User k",
          "  Port 2222",
          "  StrictHostKeyChecking accept-new",
          "",
        ].join("\n"),
      ]);
      const body = (await res.json()) as MachinesResponse;
      expect(body.machines.some((m) => m.id === "ssh:orchid-2")).toBe(true);
    });

    it("refuses an alias the config already declares, writing nothing", async () => {
      const written: string[] = [];
      await boot({ appendHost: (block) => void written.push(block) });
      const res = await post({ alias: "nas", hostName: "10.0.0.9" });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "ssh_host_exists",
      );
      expect(written).toEqual([]);
    });

    const CONFIG = [
      "# Added by PenguinHarness on 2026-08-01T00:00:00.000Z",
      "Host nas",
      "  HostName 10.0.0.2",
      "",
      "Host build-box",
      "  HostName box.example.net",
      "  ProxyJump bastion",
    ].join("\n");

    it("reads a block back, saying whether this app wrote it", async () => {
      await boot({ readConfig: () => CONFIG });
      const ours = await admin.get("/api/projects/default_project/machines/ssh-hosts/nas");
      expect(ours.status).toBe(200);
      expect(await ours.json()).toEqual({ alias: "nas", hostName: "10.0.0.2", editable: true });
      const theirs = await admin.get("/api/projects/default_project/machines/ssh-hosts/build-box");
      expect(((await theirs.json()) as { editable: boolean }).editable).toBe(false);
      const none = await admin.get("/api/projects/default_project/machines/ssh-hosts/nope");
      expect(none.status).toBe(404);
    });

    it("rewrites a block this app wrote in place, and refuses one written by hand", async () => {
      const written: string[] = [];
      await boot({ readConfig: () => CONFIG, writeConfig: (text) => void written.push(text) });
      const ok = await admin.put("/api/projects/default_project/machines/ssh-hosts/nas", {
        hostName: "10.0.0.3",
        user: "deploy",
      });
      expect(ok.status).toBe(200);
      expect(written).toHaveLength(1);
      expect(written[0]!.split("\n").slice(0, 6)).toEqual([
        "# Added by PenguinHarness on 2026-08-24T12:00:00.000Z",
        "Host nas",
        "  HostName 10.0.0.3",
        "  User deploy",
        "  StrictHostKeyChecking accept-new",
        "",
      ]);
      expect(written[0]!.endsWith("  ProxyJump bastion")).toBe(true);

      const foreign = await admin.put(
        "/api/projects/default_project/machines/ssh-hosts/build-box",
        { hostName: "x" },
      );
      expect(foreign.status).toBe(409);
      expect(((await foreign.json()) as { error: { code: string } }).error.code).toBe(
        "ssh_host_foreign",
      );
      expect(written).toHaveLength(1);
    });

    it("keeps a host's password beside the config, never in it, says only that one is saved, and deletes it", async () => {
      const written: string[] = [];
      const aliases = ["build-box", "nas"];
      let config = CONFIG;
      let plan: Awaited<ReturnType<MachinesEffects["passwordSignIn"]>> = {
        ok: true,
        detached: false,
      };
      await boot({
        listAliases: () => aliases,
        readConfig: () => config,
        appendHost: (block) => {
          written.push(block);
          aliases.push("orchid-2");
          config += `\n${block}`;
        },
        writeConfig: (text) => {
          written.push(text);
          config = text;
        },
        passwordSignIn: async () => plan,
      });
      const stored = (alias: string) =>
        path.join(machinesRoot, "machines", "ssh-passwords", Buffer.from(alias).toString("hex"));
      const created = await post({ alias: "orchid-2", hostName: "10.0.0.9", password: "hunter2" });
      expect(created.status).toBe(201);
      expect(written.join("\n")).not.toContain("hunter2");
      expect(fs.readFileSync(stored("orchid-2"), "utf8")).toBe("hunter2");
      const listed = (await created.json()) as MachinesResponse;
      expect(listed.machines.find((m) => m.alias === "orchid-2")?.passwordSaved).toBe(true);
      const read = await (await admin.get(`${HOSTS}/orchid-2`)).text();
      expect(read).not.toContain("hunter2");
      expect(JSON.parse(read)).toMatchObject({ alias: "orchid-2", passwordSaved: true });

      // A block written by hand keeps its lines; its password alone may still be set.
      const theirs = await admin.put(`${HOSTS}/build-box`, {
        hostName: "box.example.net",
        password: "pw",
      });
      expect(theirs.status).toBe(200);
      expect(written).toHaveLength(1);
      expect(fs.existsSync(stored("build-box"))).toBe(true);

      // Key sign-in deletes the password; so does deleting the machine from its last Project.
      expect(
        (await admin.put(`${HOSTS}/orchid-2`, { hostName: "10.0.0.9", password: null })).status,
      ).toBe(200);
      expect(fs.existsSync(stored("orchid-2"))).toBe(false);
      await admin.post("/api/projects/default_project/machines/stop-using", {
        machines: ["ssh:build-box"],
      });
      expect(fs.existsSync(stored("build-box"))).toBe(false);

      // An ssh here that cannot be handed a password: refused by name, nothing stored.
      plan = { ok: false, detail: "needs OpenSSH 8.4", ssh: "OpenSSH_for_Windows_8.1p1" };
      const old = await admin.put(`${HOSTS}/nas`, { hostName: "10.0.0.2", password: "pw" });
      expect(old.status).toBe(409);
      expect(await old.json()).toMatchObject({
        error: { code: "ssh_password_unsupported", details: { ssh: "OpenSSH_for_Windows_8.1p1" } },
      });
      expect(fs.existsSync(stored("nas"))).toBe(false);
    });

    it("names the field that would not survive as one config line", async () => {
      const written: string[] = [];
      await boot({ appendHost: (block) => void written.push(block) });
      const res = await post({ alias: "new box", hostName: "h" });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("ssh_host_invalid");
      expect(body.error.message).toContain("alias");
      expect(written).toEqual([]);
    });
  });

  describe("a source checkout's install image", () => {
    /**
     * The packer's stand-in, the one boundary these scenarios fake: it leaves a build the way
     * `deploy.mjs --out` does — a gzipped upgrade body — and says what it is doing. Laying the
     * image down, naming it and reading it back are the real thing.
     */
    const packs: string[] = [];
    /**
     * Packs `trees` in turn, one per build and the last one again once they run out: the
     * checkout as each build finds it.
     */
    const packing = (...trees: PushedBuild[]): CheckoutPacker => {
      const builds = trees.length === 0 ? [CHECKOUT_BUILD] : trees;
      let asked = 0;
      return async (outFile, onLine) => {
        const build = builds[Math.min(asked, builds.length - 1)]!;
        asked += 1;
        packs.push(outFile);
        onLine("building the web dist…");
        fs.writeFileSync(outFile, zlib.gzipSync(Buffer.from(JSON.stringify(build))));
        return { ok: true };
      };
    };
    /** A server running from a checkout: no installed release, and a packer to build with. */
    const checkout = (over: Partial<MachinesEffects> = {}) =>
      boot({ resolvePlan: () => null, packCheckout: packing(), ...over });
    const listed = async () =>
      (await (
        await admin.get("/api/projects/default_project/machines")
      ).json()) as MachinesResponse;
    const useBody = (machines: string[]) =>
      admin.post("/api/projects/default_project/machines/use", { machines });
    const jobsOf = () => t.deps.machines.jobs();
    const settled = () => jobsOf().every((job) => !job.queued && !job.running);
    beforeEach(() => {
      packs.length = 0;
    });

    it("before its first build it is told to the page as built on demand, and nothing is refused", async () => {
      await checkout();
      const body = await listed();
      expect(body.imageVersion).toBeNull();
      expect(body.checkoutImage).toEqual({ state: "unbuilt" });
      // Listing builds nothing; only an install or a use does.
      expect(packs).toEqual([]);

      const used = (await (await useBody(["ssh:nas"])).json()) as MachinesUseResponse;
      expect(used.refused).toEqual([]);
      await waitFor(settled);
      expect(jobsOf()[0]?.result).toEqual({ ok: true, connected: true });
    });

    it("the first install builds the image, installs it, and records its version — the server's own store untouched", async () => {
      const plans: PushPlan[] = [];
      const installers: (string | null)[] = [];
      await checkout({
        install: async (opts) => {
          plans.push(opts.plan);
          installers.push(opts.assets?.() ?? null);
          return { kind: "installed", output: "done", identity: IDENTITY };
        },
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);

      const job = t.deps.machines.job()!;
      expect(job.result).toMatchObject({ ok: true, installed: "installed" });
      // The packer's own narration is the job's while it builds.
      expect(job.log).toContain("building the web dist…");
      const version = (job.result as { version: string }).version;
      // The checkout's release, plus the build it carries: the form a hot-pushed server reports.
      expect(version.startsWith(`${VERSION}+hmr.`)).toBe(true);
      expect(plans).toHaveLength(1);
      expect(plans[0]).toMatchObject({ baseVersion: VERSION, version });
      // What is replicated is the image's own store, a whole build — never the server's live
      // `<root>/hmr`, which a dev server would restore in place of its source.
      const image = path.dirname(plans[0]!.hmrDir!);
      expect(image.startsWith(path.join(machinesRoot, "machines", "checkout-image"))).toBe(true);
      expect(readPushedBuild(image)).not.toBeNull();
      expect(fs.existsSync(path.join(machinesRoot, "hmr"))).toBe(false);
      // The installer the far side runs is the one packed into this image: a checkout run
      // under tsx has no built copy of its own.
      expect(installers[0]?.startsWith(image)).toBe(true);
      expect(fs.readFileSync(path.join(installers[0]!, "install.sh"), "utf8")).toContain("install");

      expect(recordsInStore()["ssh:nas"]?.version).toBe(version);
      const body = await listed();
      expect(body.imageVersion).toBe(version);
      expect(body.checkoutImage).toEqual({ state: "built" });
    });

    it("a machine whose ssh refuses this computer fails at once, at the first step, and no image is built for it", async () => {
      await checkout({
        runOn: async () => ({
          code: 255,
          stdout:
            "This computer has never connected to nas, and connections here cannot answer ssh's question about a new host key. (ssh: Host key verification failed.)",
          stderr: "",
          timedOut: false,
        }),
      });
      await useBody(["ssh:nas"]);
      await waitFor(settled);
      expect(jobsOf()[0]?.result).toMatchObject({
        ok: false,
        step: "check",
        canReplaceProgram: false,
        sshReason: "host-key-unknown",
      });
      expect((jobsOf()[0]?.result as { message: string }).message).toContain("ssh nas");
      expect(packs).toEqual([]);
    });

    it("a batch builds once, and every machine in it gets that image", async () => {
      await checkout();
      await useBody(["ssh:build-box", "ssh:nas"]);
      await waitFor(settled);
      expect(packs).toHaveLength(1);
      const versions = Object.values(recordsInStore()).map((record) => record.version);
      expect(versions).toHaveLength(2);
      expect(new Set(versions).size).toBe(1);
    });

    it("a build that fails ends the job in its own words, installs nothing, and the page says the same until a build succeeds", async () => {
      let installs = 0;
      const said = "vite: build failed in src/app.tsx (3:7): Unexpected token";
      // The tree breaks, then is mended: the first build fails, the next one packs.
      let broken = true;
      const mended = packing();
      await checkout({
        packCheckout: async (outFile, onLine) =>
          broken ? { ok: false, detail: said } : mended(outFile, onLine),
        install: async () => {
          installs += 1;
          return { kind: "installed", output: "done", identity: IDENTITY };
        },
      });
      await useBody(["ssh:nas"]);
      await waitFor(settled);
      // No forced install on offer: reinstalling would send nothing this server lacks.
      expect(jobsOf()[0]?.result).toEqual({
        ok: false,
        step: "build the install image",
        message: said,
        canReplaceProgram: false,
      });
      expect(installs).toBe(0);
      expect(recordsInStore()).toEqual({});
      expect((await listed()).checkoutImage).toEqual({ state: "failed", detail: said });

      broken = false;
      await useBody(["ssh:nas"]);
      await waitFor(settled);
      expect(jobsOf()[0]?.result).toEqual({ ok: true, connected: true });
      expect(installs).toBe(1);
      expect((await listed()).checkoutImage).toEqual({ state: "built" });
    });

    it("an image a job is still installing outlives the builds that land meanwhile, and goes at the next build after", async () => {
      // The far side downloads its release before the image is copied over: minutes in which
      // other machines get enabled, each building from the tree as it is by then.
      let release = () => {};
      const downloading = new Promise<void>((resolve) => {
        release = resolve;
      });
      let nasImage: string | null = null;
      let copied: Buffer | null = null;
      // A web-only edit after the first build: the dev server keeps running, and the image moves on.
      const edited: PushedBuild = {
        ...CHECKOUT_BUILD,
        web: {
          files: {
            "index.html": Buffer.from("<!doctype html><title>edited</title>").toString("base64"),
          },
        },
      };
      await checkout({
        packCheckout: packing(CHECKOUT_BUILD, edited),
        install: async (opts) => {
          if (opts.target.alias === "nas") {
            nasImage = path.dirname(opts.plan.hmrDir!);
            await downloading;
            // What the copy reads, once the release is down.
            copied = readPushedBuild(nasImage);
          }
          return { kind: "installed", output: "done", identity: IDENTITY };
        },
      });
      const doneOn = (machineId: string) =>
        jobsOf().some((job) => job.machineId === machineId && !job.queued && !job.running);

      await useBody(["ssh:nas"]);
      await waitFor(() => nasImage !== null);
      // Two more enables while nas downloads: the first builds the edited tree, the second
      // lands on that same image again.
      await useBody(["ssh:build-box"]);
      await waitFor(() => doneOn("ssh:build-box"));
      await useBody(["ssh:build-box"]);
      await waitFor(() => doneOn("ssh:build-box"));
      expect(packs).toHaveLength(3);

      release();
      await waitFor(settled);
      expect(copied).not.toBeNull();
      expect(jobsOf().find((job) => job.machineId === "ssh:nas")?.result).toEqual({
        ok: true,
        connected: true,
      });
      // Nothing holds it any more: the next build sweeps it, and keeps the image in use.
      await useBody(["ssh:build-box"]);
      await waitFor(settled);
      expect(fs.existsSync(nasImage!)).toBe(false);
      expect((await listed()).checkoutImage).toEqual({ state: "built" });
    });

    it("rebuilding an unchanged checkout lands on the image already there: the machine on it gets nothing new", async () => {
      let installs = 0;
      await checkout({
        install: async () => {
          installs += 1;
          return { kind: "installed", output: "done", identity: IDENTITY };
        },
      });
      await useBody(["ssh:nas"]);
      await waitFor(settled);
      const first = (await listed()).imageVersion;

      await useBody(["ssh:nas"]);
      await waitFor(settled);
      // Each ask builds from the checkout as it is then; the same tree is the same image.
      expect(packs).toHaveLength(2);
      expect(installs).toBe(1);
      expect((await listed()).imageVersion).toBe(first);
      expect(jobsOf()[0]?.log).toContain(`Already on ${first}.`);
    });

    it("a changed checkout is a new version, and the machine on the old one reads as behind it", async () => {
      await checkout();
      await useBody(["ssh:nas"]);
      await waitFor(settled);
      const first = (await listed()).imageVersion;

      // The same server after an edit to the platform: its next build is another image.
      service = new MachinesService(
        machinesRoot,
        LOCAL_ID,
        machinesRepo,
        effects({
          resolvePlan: () => null,
          packCheckout: packing({
            ...CHECKOUT_BUILD,
            platform: `${CHECKOUT_BUILD.platform}// edited\n`,
          }),
        }),
      );
      await useBody(["ssh:build-box"]);
      await waitFor(settled);

      const body = await listed();
      expect(body.imageVersion).not.toBe(first);
      expect(body.imageVersion?.startsWith(`${VERSION}+hmr.`)).toBe(true);
      // What the page compares to raise "update": the record against the image, both true.
      expect(recordsInStore()["ssh:nas"]?.version).toBe(first);
      expect(recordsInStore()["ssh:build-box"]?.version).toBe(body.imageVersion);
    });

    it("outlives a restart: a fresh service over the same root names the image it built, without building", async () => {
      await checkout();
      await useBody(["ssh:nas"]);
      await waitFor(settled);
      const version = (await listed()).imageVersion;

      const reborn = new MachinesService(
        machinesRoot,
        LOCAL_ID,
        machinesRepo,
        effects({ resolvePlan: () => null, packCheckout: packing() }),
      );
      expect(reborn.imageVersion()).toBe(version);
      expect(reborn.checkoutImage()).toEqual({ state: "built" });
      expect(packs).toHaveLength(1);
    });

    it("a machine carrying the release but not this image is handed the image through its update channel", async () => {
      let handed: PushedBuild | null = null;
      await checkout({
        install: async () => ({ kind: "state-only", identity: IDENTITY }),
        upgrade: async (opts) => {
          const body = readPushedBuild(opts.dataRoot);
          handed =
            body === null ? null : (JSON.parse(zlib.gunzipSync(body).toString()) as PushedBuild);
          return { kind: "upgraded", detail: "", persisted: true };
        },
      });
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toMatchObject({ ok: true });
      expect(handed).toMatchObject({
        platform: CHECKOUT_BUILD.platform,
        cli: CHECKOUT_BUILD.cli,
        web: CHECKOUT_BUILD.web,
      });
    });

    it("an installed server's own image wins: the checkout is neither built nor mentioned", async () => {
      await boot({ packCheckout: packing() });
      const body = await listed();
      expect(body.imageVersion).toBe("9.9.9");
      expect(body.checkoutImage).toBeUndefined();
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toMatchObject({ ok: true, version: "9.9.9" });
      expect(packs).toEqual([]);
    });
  });

  describe("a release's shipped install image", () => {
    /** Release programs written by this describe's cases, removed after each. */
    const programs: string[] = [];
    afterEach(() => {
      for (const dir of programs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
    });
    /** A release's program, shipping `build` as its install image (what deploy.mjs --out writes). */
    const shipping = (build: PushedBuild) => {
      const program = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-release-program-"));
      programs.push(program);
      fs.mkdirSync(path.join(program, "dist"));
      const body = path.join(program, "dist", "install-image.gz");
      fs.writeFileSync(body, zlib.gzipSync(Buffer.from(JSON.stringify(build))));
      return { baseVersion: "9.9.9", body };
    };
    /** An installed release nothing was pushed to: no pushed state, and the image it ships. */
    const release = async (over: Partial<MachinesEffects> = {}) => {
      const shippedImage = shipping(CHECKOUT_BUILD);
      await boot({ resolvePlan: () => null, shippedImage, ...over });
      return shippedImage;
    };
    const listed = async () =>
      (await (
        await admin.get("/api/projects/default_project/machines")
      ).json()) as MachinesResponse;
    const installNas = async () => {
      await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      return t.deps.machines.job()!;
    };
    const imageRoot = () => path.join(machinesRoot, "machines", "release-image");

    it("an install puts the image the release ships: a whole store with a CLI, under the release and the image's suffix", async () => {
      const plans: PushPlan[] = [];
      await release({
        install: async (opts) => {
          plans.push(opts.plan);
          return { kind: "installed", output: "done", identity: IDENTITY };
        },
      });
      const job = await installNas();
      expect(job.result).toMatchObject({ ok: true, installed: "installed" });
      const version = (job.result as { version: string }).version;
      expect(version.startsWith("9.9.9+hmr.")).toBe(true);
      expect(plans[0]).toMatchObject({ baseVersion: "9.9.9", version });
      // The store an install replicates: the shipped build, in the layout a push leaves, whose
      // CLI is what the machine's `penguin-hmr` runs every command this server sends through.
      const image = path.dirname(plans[0]!.hmrDir!);
      expect(image.startsWith(imageRoot())).toBe(true);
      expect(JSON.parse(zlib.gunzipSync(readPushedBuild(image)!).toString())).toMatchObject({
        platform: CHECKOUT_BUILD.platform,
        cli: CHECKOUT_BUILD.cli,
        web: CHECKOUT_BUILD.web,
      });
      const cli = await readPushedCli(image);
      expect(cli.kind).toBe("bundle");
      expect(fs.readFileSync((cli as { file: string }).file, "utf8")).toBe(CHECKOUT_BUILD.cli);
      expect(fs.existsSync(path.join(machinesRoot, "hmr"))).toBe(false);

      expect(recordsInStore()["ssh:nas"]?.version).toBe(version);
      expect((await listed()).imageVersion).toBe(version);
    });

    it("is laid down once: a restart names it at once, and an upgrade's image replaces it", async () => {
      const shippedImage = await release();
      await installNas();
      const version = (await listed()).imageVersion!;
      const laid = fs.readdirSync(imageRoot());
      expect(laid).toHaveLength(1);

      const reborn = new MachinesService(
        machinesRoot,
        LOCAL_ID,
        machinesRepo,
        effects({ resolvePlan: () => null, shippedImage }),
      );
      expect(reborn.imageVersion()).toBe(version);

      const upgraded = new MachinesService(
        machinesRoot,
        LOCAL_ID,
        machinesRepo,
        effects({
          resolvePlan: () => null,
          shippedImage: shipping({
            ...CHECKOUT_BUILD,
            cli: "export async function cli() { return 1; }\n",
          }),
        }),
      );
      // Nothing on disk names the older release's image: before the new one is laid down there
      // is no version to name, rather than the old one.
      expect(upgraded.imageVersion()).toBeNull();
      await upgraded.syncOutOfDate();
      const next = upgraded.imageVersion();
      expect(next).not.toBeNull();
      expect(next).not.toBe(version);
      expect(fs.readdirSync(imageRoot())).toHaveLength(1);
      expect(fs.readdirSync(imageRoot())).not.toEqual(laid);
      for (const svc of [reborn, upgraded]) svc.stop();
    });

    it("an image that cannot be read ends the install before anything is installed, in words, offering nothing", async () => {
      const shippedImage = shipping(CHECKOUT_BUILD);
      fs.writeFileSync(shippedImage.body, "not a gzip");
      let installs = 0;
      await boot({
        resolvePlan: () => null,
        shippedImage,
        install: async () => {
          installs += 1;
          return { kind: "installed", output: "done", identity: IDENTITY };
        },
      });
      const job = await installNas();
      expect(job.result).toMatchObject({
        ok: false,
        step: "prepare the install image",
        message: expect.stringContaining("not readable"),
        canReplaceProgram: false,
      });
      expect(installs).toBe(0);
      expect((await listed()).imageVersion).toBeNull();
    });

    it("a pushed server's own state wins over the image its release ships", async () => {
      const plans: PushPlan[] = [];
      await boot({
        resolvePlan: () => PUSHED_PLAN,
        shippedImage: shipping(CHECKOUT_BUILD),
        install: async (opts) => {
          plans.push(opts.plan);
          return { kind: "installed", output: "done", identity: IDENTITY };
        },
      });
      expect((await listed()).imageVersion).toBe(PUSHED_PLAN.version);
      await installNas();
      expect(plans).toEqual([PUSHED_PLAN]);
      expect(fs.existsSync(imageRoot())).toBe(false);
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

    it("409s a second install on a machine that has one running, and lets another machine's start", async () => {
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
      const again = await admin.post("/api/projects/default_project/machines/ssh:nas/install");
      expect(again.status).toBe(409);
      expect(((await again.json()) as { error: { code: string } }).error.code).toBe(
        "install_running",
      );
      // Another host is not held up by it: its job runs beside the first.
      const other = await admin.post(
        "/api/projects/default_project/machines/ssh:build-box/install",
      );
      expect(other.status).toBe(202);
      release();
      await waitFor(() => t.deps.machines.jobs().every((job) => !job.running && !job.queued));
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

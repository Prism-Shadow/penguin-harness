/**
 * The runtime handshake (machines/handshake.ts, http/routes/handshake.ts) and the one action it
 * decides (machines/service.ts's `#settleBuild`), against a scripted machine.
 *
 * The answer is read off the wire and compared with the plan through the readers the version
 * door already has; a machine that predates the route answers 404, which is an unknown build
 * rather than a failure; and the identity is taken when the process starts, so a hot update that
 * moves the disk does not move it. The action is the card's table: in line, nothing is touched;
 * otherwise exactly one forced install and one stop/start, and one more question; a second
 * disagreement records `incompatible` and is not walked again on its own; two askers share one
 * run; and the install gives up in time.
 */
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VERSION } from "@prismshadow/penguin-core";
import type { DatabaseSync } from "node:sqlite";
import { HotResources } from "@prismshadow/penguin-hmr";
import { openDatabase } from "../src/db/database.js";
import { MachinesRepo } from "../src/db/repos/machines.js";
import { MachinesService } from "../src/machines/service.js";
import type { MachinesEffects, SettleTimeouts } from "../src/machines/service.js";
import { runningBuild } from "../src/machines/install-server.js";
import type { PushPlan, RemoteInstallOutcome } from "../src/machines/install-server.js";
import type { RemoteIdentity } from "../src/machines/detect.js";
import { MachineSockets } from "../src/machines/machine-sockets.js";
import type { StreamSettle } from "../src/machines/machine-sockets.js";
import { MachineSocketRelay } from "../src/machines/socket-relay.js";
import { HANDSHAKE_PATH, judgeHandshake, readHandshakeAnswer } from "../src/machines/handshake.js";
import type { HandshakeAnswer } from "../src/machines/handshake.js";
import { bootIdentity, handshakeRoutes } from "../src/http/routes/handshake.js";
import { versionReport } from "../src/version-report.js";
import { makeTempRoot, waitFor } from "./helpers.js";

/** The seeded Project every server has, and this machine's fixed id. */
const PROJECT = "default_project";
const LOCAL_ID = "TESTlocalID00000";
const IDENTITY: RemoteIdentity = {
  platform: "linux",
  arch: "x64",
  installedVersion: null,
  harness: null,
};

/** This hub's build, and one before it: pushed platforms, named by shas as the store names them. */
const OURS = "cafe0123456789ab";
const THEIRS = "0123456789abcdef";
/** A platform's sha as a plan spells it: the first twelve of it. */
const versionOf = (platform: string) => `9.9.9+hmr.${platform.slice(0, 12)}`;
const OURS_VERSION = versionOf(OURS);
const PLAN: PushPlan = {
  baseVersion: "9.9.9",
  harness: JSON.stringify({ platform: { bundle: `store/platform/${OURS}.mjs` } }),
  hmrDir: "/nonexistent",
  version: OURS_VERSION,
};

/** What a process answers: the build it loaded, in the shape the version door answers. */
const identityOf = (platform: string) => ({
  version: "9.9.9",
  channel: "source",
  harness: { bundles: { platform: `store/platform/${platform}.mjs` } },
});
const OURS_IDENTITY = identityOf(OURS);
const THEIRS_IDENTITY = identityOf(THEIRS);

describe("reading the handshake answer", () => {
  it("reads 404 as a build it does not know, never as a failure of the machine", () => {
    expect(readHandshakeAnswer(404, "")).toEqual({
      kind: "unknown",
      detail: "it has no handshake door (404), so its build is unknown",
    });
  });

  it("reads a report naming a version as the build that process runs", () => {
    const reading = readHandshakeAnswer(200, JSON.stringify({ identity: OURS_IDENTITY }));
    expect(reading.kind).toBe("answered");
    expect(reading.kind === "answered" && runningBuild(reading.identity)?.version).toBe(
      OURS_VERSION,
    );
  });

  it.each([
    ["a status that is neither 200 nor 404", 500, "{}"],
    ["a body that is not JSON", 200, "not json"],
    ["a body that names no identity", 200, JSON.stringify({ models: [] })],
    ["an identity that names no version", 200, JSON.stringify({ identity: { channel: "source" } })],
  ])("reads %s as a failure, not as a build", (_what, status, text) => {
    expect(readHandshakeAnswer(status, text).kind).toBe("failed");
  });
});

describe("the handshake route", () => {
  it("answers one typed thing — the identity — with no protocol number and no capability list", async () => {
    const identity = OURS_IDENTITY as unknown as HandshakeAnswer["identity"];
    const response = await handshakeRoutes({ identity: async () => ({ identity }) }).request("/");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["identity"]);
    expect(body).not.toHaveProperty("protocol");
    expect(body).not.toHaveProperty("capabilities");
    expect(body.identity).toEqual(identity);
    // The type carries nothing else either: a protocol number does not even compile.
    // @ts-expect-error — `HandshakeAnswer` is the identity and nothing more.
    const withProtocol: HandshakeAnswer = { identity, protocol: 1 };
    expect(withProtocol).toBeDefined();
  });
});

describe("the identity a process answers", () => {
  /** A data root whose hmr store commits `platform` as its pushed build. */
  const pushTo = async (root: string, platform: string) => {
    await fs.mkdir(path.join(root, "hmr"), { recursive: true });
    await fs.writeFile(
      path.join(root, "hmr", "harness.json"),
      JSON.stringify({ platform: { bundle: `store/platform/${platform}.mjs` } }),
    );
  };

  it("is the build the process loaded at its start: a hot update moves the disk, not the answer", async () => {
    const root = await makeTempRoot();
    await pushTo(root, OURS);
    // One process: the registry a hot update's generations read back outlives them.
    const resources = new HotResources();
    const booted = await bootIdentity(resources, root);
    expect(runningBuild(booted.identity)?.version).toBe(`${VERSION}+hmr.${OURS.slice(0, 12)}`);

    // The hot update: the store now names another build, and the version door says so.
    await pushTo(root, THEIRS);
    expect(runningBuild(await versionReport(root))?.version).toBe(
      `${VERSION}+hmr.${THEIRS.slice(0, 12)}`,
    );

    // The same process, asked again: it still serves what it started with.
    const again = await bootIdentity(resources, root);
    expect(runningBuild(again.identity)?.version).toBe(`${VERSION}+hmr.${OURS.slice(0, 12)}`);
    // A process that starts now loads the build the disk holds.
    const restarted = await bootIdentity(new HotResources(), root);
    expect(runningBuild(restarted.identity)?.version).toBe(`${VERSION}+hmr.${THEIRS.slice(0, 12)}`);
    // The release half is this process's own, whatever the disk says.
    expect((await versionReport(root)).version).toBe(VERSION);
  });
});

describe("what an answer means for the plan", () => {
  it("compares the build the answer names with the plan, and nothing else", () => {
    expect(judgeHandshake({ kind: "answered", identity: OURS_IDENTITY as never }, PLAN)).toEqual({
      inLine: true,
      build: expect.objectContaining({ version: OURS_VERSION }),
    });
    const other = judgeHandshake({ kind: "answered", identity: THEIRS_IDENTITY as never }, PLAN);
    expect(other).toMatchObject({ inLine: false, version: versionOf(THEIRS) });
    expect(judgeHandshake({ kind: "unknown", detail: "404" }, PLAN)).toMatchObject({
      inLine: false,
      build: null,
      version: null,
    });
  });
});

describe("a stream that found no socket", () => {
  /** A port with nothing on it: every dial fails, and the settle hook is what answers. */
  const quiet = async () => {
    const server = http.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port;
  };
  const answer = async (settle: StreamSettle) => {
    const sockets = new MachineSockets(() => undefined, { settle: () => settle });
    const relay = new MachineSocketRelay(() => undefined, { sockets });
    const target = { agent: new http.Agent(), port: await quiet(), cookie: "", session: 1 };
    const response = await relay.stream("m1", target, { path: "/api/events", lastEventId: null });
    const body = (await response.json()) as { error: { code: string; message: string } };
    return { status: response.status, ...body.error };
  };

  it("is told the machine is being upgraded, not given the same 502", async () => {
    const answered = await answer({ kind: "upgrading", detail: "it is being brought onto 9.9.9" });
    expect(answered.status).toBe(503);
    expect(answered.code).toBe("machine_upgrading");
    expect(answered.message).toContain("being brought onto 9.9.9");
  });

  it("is told the verdict when the pair could not be brought together", async () => {
    const answered = await answer({
      kind: "incompatible",
      detail: "ssh:nas runs 9.9.9+hmr.0123456789ab where this hub serves 9.9.9+hmr.cafe01234567",
    });
    expect(answered.status).toBe(502);
    expect(answered.code).toBe("machine_incompatible");
  });
});

describe("the one action a handshake decides", () => {
  let service: MachinesService | null = null;
  let store: DatabaseSync | null = null;
  const closers: Array<() => Promise<void>> = [];
  /** The plan this hub serves; a test moves it to stand for a new build landing here. */
  let plan: PushPlan = PLAN;

  afterEach(async () => {
    service?.stop();
    service = null;
    store?.close();
    store = null;
    plan = PLAN;
    for (const close of closers.splice(0)) await close();
  });

  /** A machine's server: answers the handshake with what `state` holds now, and 404 when told to. */
  const machine = async (identity: unknown) => {
    const state = { identity, door: true, asks: 0 };
    const server = http.createServer((req, res) => {
      if (req.url === HANDSHAKE_PATH) {
        state.asks += 1;
        if (!state.door) return void res.writeHead(404).end();
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ identity: state.identity }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ version: "9.9.9" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    return { state, port };
  };

  /** The effects a machine this service can reach needs; every one of them tells the world by hand. */
  const effects = (over: Partial<MachinesEffects>): Partial<MachinesEffects> => ({
    watchSessions: () => () => {},
    detect: async () => ({ error: "the fake machine said nothing" }),
    listAliases: () => ["nas"],
    resolvePlan: () => plan,
    now: () => new Date("2026-10-26T12:00:00.000Z"),
    startServer: async () => ({ ok: true as const }),
    stopServer: async () => ({ ok: true as const }),
    upgrade: async () => ({ kind: "upgraded", detail: "", persisted: true }),
    runOn: async () => ({
      code: 0,
      stdout: "---penguin-auth-token---\nremote-token\n",
      stderr: "",
      timedOut: false,
    }),
    hold: async () => ({ ok: true, session: { pid: process.pid, socksPort: 1 } }),
    session: () => ({ pid: process.pid, socksPort: 1 }),
    agent: () => new http.Agent(),
    install: async (): Promise<RemoteInstallOutcome> => ({
      kind: "installed",
      output: "done",
      identity: IDENTITY,
    }),
    ...over,
  });

  /** A service over a fresh root and store, reaching a machine whose server answers on `port`. */
  const boot = async (
    remote: { port: number },
    over: Partial<MachinesEffects> = {},
    timeouts: Partial<SettleTimeouts> = {},
  ) => {
    const root = await makeTempRoot();
    store = openDatabase(":memory:");
    store
      .prepare(
        "INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES (?, ?, 1, ?)",
      )
      .run("admin", "x", "2026-10-26T00:00:00.000Z");
    store
      .prepare("INSERT INTO projects (project_id, owner_user_id, created_at) VALUES (?, ?, ?)")
      .run(PROJECT, "admin", "2026-10-26T00:00:00.000Z");
    const repo = new MachinesRepo(store);
    service = new MachinesService(
      root,
      LOCAL_ID,
      repo,
      effects({
        probe: async () => ({
          state: { kind: "running" as const, port: remote.port, pid: 4242 },
          machineId: null,
        }),
        ...over,
      }),
      undefined,
      undefined,
      timeouts,
    );
    // What an install of this hub's build left there, which is where the sweep starts.
    repo.patch("ssh:nas", {
      machineId: "REMOTE",
      version: PLAN.version,
      installedAt: "2026-10-26T00:00:00.000Z",
      remotePort: remote.port,
    });
    repo.setMembers(PROJECT, ["ssh:nas"]);
    return repo;
  };

  /** Install, stop and start as they happened, in order. */
  const counted = (log: string[]): Partial<MachinesEffects> => ({
    install: async (opts: { forceInstaller?: boolean }): Promise<RemoteInstallOutcome> => {
      log.push(`install(force: ${String(opts.forceInstaller)})`);
      return { kind: "installed", output: "done", identity: IDENTITY };
    },
    stopServer: async () => {
      log.push("stop");
      return { ok: true as const };
    },
    startServer: async () => {
      log.push("start");
      return { ok: true as const };
    },
  });

  it("leaves a machine whose process answers this hub's build alone", async () => {
    const remote = await machine(OURS_IDENTITY);
    const done: string[] = [];
    const repo = await boot(remote, counted(done));

    await service!.syncOutOfDate();

    expect(done).toEqual([]);
    expect(remote.state.asks).toBe(1);
    expect(repo.get("ssh:nas")?.version).toBe(OURS_VERSION);
  });

  it("installs this hub's build once and restarts it once when the process answers another", async () => {
    const remote = await machine(THEIRS_IDENTITY);
    const done: string[] = [];
    const repo = await boot(remote, {
      ...counted(done),
      install: async (opts) => {
        done.push(`install(force: ${String(opts.forceInstaller)})`);
        // The push lands on the disk; what serves there changes only at the restart.
        remote.state.identity = OURS_IDENTITY;
        return { kind: "installed", output: "done", identity: IDENTITY };
      },
    });

    await service!.syncOutOfDate();

    expect(done).toEqual(["install(force: true)", "stop", "start"]);
    expect(remote.state.asks).toBe(2);
    expect(repo.get("ssh:nas")?.version).toBe(OURS_VERSION);
  });

  it("reads a machine without the door as an unknown build, and brings it forward all the same", async () => {
    const remote = await machine(THEIRS_IDENTITY);
    remote.state.door = false;
    const done: string[] = [];
    await boot(remote, {
      ...counted(done),
      install: async () => {
        done.push("install");
        // The build it is given has the door the old one lacked.
        remote.state.door = true;
        remote.state.identity = OURS_IDENTITY;
        return { kind: "installed", output: "done", identity: IDENTITY };
      },
    });

    await service!.syncOutOfDate();

    expect(done).toEqual(["install", "stop", "start"]);
    expect(remote.state.asks).toBe(2);
  });

  it("leaves a machine it cannot ask at all alone: nothing is installed on a server that is not up", async () => {
    const remote = await machine(THEIRS_IDENTITY);
    const done: string[] = [];
    await boot(remote, {
      ...counted(done),
      probe: async () => ({ state: { kind: "stopped" as const }, machineId: null }),
    });

    await service!.syncOutOfDate();

    expect(done).toEqual([]);
    expect(remote.state.asks).toBe(0);
  });

  it("records a pair it could not bring together, and walks it again only when a build moves", async () => {
    const remote = await machine(THEIRS_IDENTITY);
    const done: string[] = [];
    await boot(remote, counted(done));

    await service!.syncOutOfDate();
    expect(done).toEqual(["install(force: true)", "stop", "start"]);
    // The next sweep asks the same question and installs nothing: the verdict holds it back.
    await service!.syncOutOfDate();
    expect(done).toEqual(["install(force: true)", "stop", "start"]);
    expect(remote.state.asks).toBe(3);

    const held = service!.settleForStream("REMOTE");
    expect(held?.kind).toBe("incompatible");
    expect(held?.detail).toContain(versionOf(THEIRS));
    expect(held?.detail).toContain(`serves ${OURS_VERSION}`);

    // A new build here is a new pair: the action runs for it.
    plan = {
      ...PLAN,
      harness: '{"platform":{"bundle":"store/platform/deadbeefdead.mjs"}}',
      version: "9.9.9+hmr.deadbeefdead",
    };
    expect(service!.settleForStream("REMOTE")?.kind).toBe("upgrading");
    await waitFor(() => done.length === 6);
    expect(done.slice(3)).toEqual(["install(force: true)", "stop", "start"]);
  });

  it("walks one machine once however many ask meanwhile, and answers each that it is being upgraded", async () => {
    const remote = await machine(THEIRS_IDENTITY);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let installs = 0;
    await boot(remote, {
      install: async () => {
        installs += 1;
        await gate;
        return { kind: "installed", output: "done", identity: IDENTITY };
      },
    });

    const first = service!.settleForStream("REMOTE");
    const second = service!.settleForStream("REMOTE");
    expect(first?.kind).toBe("upgrading");
    expect(second?.kind).toBe("upgrading");
    await waitFor(() => installs === 1);
    release();
    await waitFor(() => remote.state.asks === 2);
    expect(installs).toBe(1);
  });

  it("gives up on an install that does not finish, and records what it could not do", async () => {
    const remote = await machine(THEIRS_IDENTITY);
    await boot(
      remote,
      { install: () => new Promise<RemoteInstallOutcome>(() => {}) },
      { install: 20 },
    );

    const started = Date.now();
    await service!.syncOutOfDate();
    expect(Date.now() - started).toBeLessThan(5_000);

    const held = service!.settleForStream("REMOTE");
    expect(held?.kind).toBe("incompatible");
    expect(held?.detail).toContain("could not be installed again");
    expect(held?.detail).toContain("did not finish within");
  });
});

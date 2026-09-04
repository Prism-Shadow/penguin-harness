/**
 * The machines service: this server's own `~/.ssh/config` as a list of targets, and putting
 * this build on one of them, reaching it, and keeping it configured.
 *
 * ONE JOB at a time — an install or a connect — started by POST and polled by the Web App
 * for its progress lines. The job lives in this App's memory; what it achieved is in web.db
 * (MachinesRepo): which machines carry this program, the session held to each, and which
 * Project uses which. Every word to a machine leaves through its MachineConnection
 * (transport/connection.ts) — ONE ssh session per machine, carrying commands on its stdin
 * and every TCP connection as a channel through its SOCKS port — and every request to a
 * machine's API is made as its admin, with a session this server mints over the ssh access
 * that installed it.
 *
 * The JOB is not persisted. It lives in this App's memory and dies with it (see the park
 * list in ../hmr/platform.ts — it is on the SUSPENDED side): a hot push during an install
 * loses the progress log, and the recovery is to run it again, which is safe because every
 * step is idempotent — the far side's installer stages, smoke-tests and swaps, and an
 * unchanged version is a no-op.
 *
 * A machine BELONGS TO A PROJECT. The host is shared — one program, one ssh config entry —
 * but which Projects use it is this server's own bookkeeping, because a Project's machines
 * are where that Project's work runs. A host installed for another Project is reported as
 * `elsewhere` rather than hidden: adopting it costs a row, while re-installing costs a
 * 30 MB transfer to reach the same place.
 */
import fs from "node:fs";
import os from "node:os";
import {
  DEFAULT_PROJECT_ID,
  DEFAULT_SERVER_PORT,
  VERSION,
  loadProjectConfig,
} from "@prismshadow/penguin-core";
import type { ProjectConfig } from "@prismshadow/penguin-core";
import type { MachineInfo, MachineJob, MachineServerStatus } from "../api/types.js";
import { readServerLock } from "../lock.js";
import { SESSION_COOKIE } from "../auth/middleware.js";
import http from "node:http";
import {
  closeAllConnections,
  closeConnectionTo,
  connectionTo,
  listHostAliases,
  sessionOf,
} from "./transport/index.js";
import type { ExecResult, MachineConnection, ShellSession } from "./transport/index.js";
import { machineIdentity } from "./ssh-config.js";
import { DIR_LIST_MARK, listDirsCommand } from "./commands.js";
import type { RemoteTarget } from "./commands.js";
import { installOnRemote, resolvePushPlan } from "./install-server.js";
import { probeServerState } from "./server-state.js";
import { upgradeRemote } from "./upgrade.js";
import type { UpgradeOutcome } from "./upgrade.js";
import { mintTokenOnRemote } from "./remote-token.js";
import { syncModelsToMachine } from "./models-sync.js";
import type { LocalModels } from "./models-sync.js";
import { machineApi } from "./machine-api.js";
import { startRemoteServer, stopRemoteServer } from "./server-control.js";
import type { MachineRow } from "../db/repos/machines.js";
import { Interface, Bind, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../auth/middleware.js";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { Config } from "../config.js";
import type { Hmr } from "../hmr/host.js";
import type { Overrides } from "../app.js";
import { RuntimeModule } from "../hmr/capabilities.js";
import { machinesRoutes } from "../http/routes/machines.js";
import { machinesProxy } from "./proxy.js";
import { HttpError } from "../http/errors.js";
import type { ProjectAccess } from "../services/project-access.js";
import { Hono } from "hono";
import { MachinesRepo } from "../db/repos/machines.js";
import type { DatabaseSync } from "node:sqlite";
import type { Db } from "../db/database.js";

/** Why an install was refused before any ssh ran. */
type InstallRefusal = "busy" | "unknown-machine" | "no-image" | "self";
/** Why a connect was refused before any ssh ran. */
type ConnectRefusal = "busy" | "unknown-machine" | "not-installed" | "self" | "unsupported";

/**
 * What this service does to the world, injectable as a set. Production passes none of them;
 * tests fake the reaching-out, because the real ones read the developer's own ~/.ssh/config
 * and spawn ssh against whatever it names. The push path itself is covered where it belongs
 * — machines-push.test.ts drives the real installOnRemote against a fake ssh binary — so
 * what is faked here is only the reaching-out, never the logic under test.
 */
export interface MachinesEffects {
  listAliases: typeof listHostAliases;
  resolvePlan: typeof resolvePushPlan;
  install: typeof installOnRemote;
  probe: typeof probeServerState;
  /** One command on a machine, over its shared shell. */
  runOn: (target: RemoteTarget, command: string) => Promise<ExecResult>;
  startServer: (target: RemoteTarget, port: number) => ReturnType<typeof startRemoteServer>;
  /** Brings the one connection to a machine up and HOLDS it (transport/connection.ts). */
  hold: (target: RemoteTarget) => ReturnType<MachineConnection["hold"]>;
  /** The connection held to a machine, while it is up. */
  session: (address: string) => ShellSession | null;
  /** An http.Agent that dials that machine's server through its session. */
  agent: (target: RemoteTarget, remotePort: number) => http.Agent;
  stopServer: (target: RemoteTarget) => ReturnType<typeof stopRemoteServer>;
  upgrade: typeof upgradeRemote;
  /** This server's own Project config, credentials in plaintext — the source of a model sync. */
  loadConfig: (projectId: string) => Promise<ProjectConfig>;
  /** Injected so a test can pin the recorded timestamp instead of asserting around the clock. */
  now: () => Date;
}

/** The id of the entry standing for the machine this server runs on. */
const LOCAL_MACHINE_ID = "local";

/** How many machines are worked on at once by the automatic sweeps and the probe. */
const CONCURRENCY = 5;

/** A minted session is used for this long before a fresh one is asked for (its TTL is an hour). */
const SESSION_REUSE_MS = 50 * 60_000;

export class MachinesService {
  #job: MachineJob | null = null;
  /** Last probe per address. In memory on purpose: a status is only true for the moment it was taken. */
  readonly #statuses = new Map<string, MachineServerStatus>();
  /**
   * The probe round in flight per Project. Concurrent askers — every open tab schedules its
   * own — share the round rather than each starting five workers: the answer is the same,
   * and five was meant as a bound, not as a unit of multiplication.
   */
  readonly #probing = new Map<string, Promise<void>>();
  /**
   * Machines with a heavy operation in flight — an install, or the automatic sweep. Two
   * transfers racing for one host is how a 30-second command times out with nothing to say.
   */
  readonly #busy = new Set<string>();
  /** Sessions minted on machines, by address, reused until near their TTL. */
  readonly #sessions = new Map<string, { cookie: string; at: number }>();
  /**
   * Machines with a model sync in flight, and whether another was asked for meanwhile. An
   * edit that arrives while a sync is running is not dropped and not queued behind it one
   * by one: ONE trailing sync runs when the current one ends, reading the config as it is
   * then — which is what every edit in between wanted written.
   */
  readonly #syncing = new Map<string, { again: boolean }>();
  /**
   * What the proxy's traffic last learned of each machine's API, by address. In memory
   * like #statuses: a sighting is only true for the moment it was taken.
   */
  readonly #apiSeen = new Map<
    string,
    { answeredAt: string } | { failedAt: string; detail: string }
  >();
  readonly #effects: MachinesEffects;
  readonly #assets: () => string | null;
  readonly #machineId: string;

  constructor(
    private readonly dataRoot: string,
    machineId: string,
    private readonly repo: MachinesRepo,
    effects: Partial<MachinesEffects> = {},
    assets: () => string | null = () => null,
  ) {
    this.#assets = assets;
    this.#machineId = machineId;
    this.#effects = {
      listAliases: listHostAliases,
      resolvePlan: resolvePushPlan,
      install: installOnRemote,
      probe: probeServerState,
      runOn: (target, command) => connectionTo(target).exec(command),
      startServer: (target, port) => startRemoteServer(target, port, this.#effects.runOn),
      hold: (target) => connectionTo(target).hold(),
      session: (address) => sessionOf(address),
      agent: (target, remotePort) => connectionTo(target).agent(remotePort),
      stopServer: (target) => stopRemoteServer(target, this.#effects.runOn),
      upgrade: upgradeRemote,
      loadConfig: (projectId) => loadProjectConfig(dataRoot, projectId),
      now: () => new Date(),
      ...effects,
    };
  }

  // --- what is known -----------------------------------------------------------------------

  /**
   * A machine's ssh target is its alias and nothing else. What the alias means — user, host,
   * port, key, jump host — is ssh's to resolve, from its own config, every time it is handed
   * the alias; asking ssh for that answer first (`ssh -G`) only to hand it back was a process
   * per probe that could go stale against a file a person edits, for no fact we used.
   */
  #targetOf(alias: string): RemoteTarget {
    return { alias, user: "" };
  }

  /**
   * The addresses a Project uses: exactly its own list, empty until an install gives it one.
   *
   * Nothing is inherited, the default Project included. The store starts empty (the JSON
   * file it replaces is not read), so there is nothing for a first Project to inherit — and
   * an inheritance that materialised on the Project's first write made the answer depend on
   * whether that write had happened yet. A machine belongs to the Project that installed it
   * or adopted it, and to no other; one released by every Project reads as `elsewhere` for
   * all of them, which is what makes it adoptable again.
   */
  #members(projectId: string): string[] {
    return this.repo.members(projectId) ?? [];
  }

  #setMember(projectId: string, address: string, member: boolean): void {
    const current = this.#members(projectId);
    this.repo.setMembers(
      projectId,
      member ? [...new Set([...current, address])] : current.filter((entry) => entry !== address),
    );
  }

  /**
   * The connection held to a machine, or null. This generation's own: a hot-swapped platform
   * starts with none — the generation before closed what it opened on its way out (stop) —
   * and re-holds every machine the record says was held (start).
   */
  #liveSession(address: string): ShellSession | null {
    return this.#effects.session(address);
  }

  /**
   * Holds the connection to a machine — brought up if it is not, promoted if a passing probe
   * already opened it — and records that it is held. The transport keeps it from here: no
   * idle timer, reopened on its own when it drops, until disconnect().
   */
  async #connection(
    address: string,
    target: RemoteTarget,
  ): Promise<{ ok: true; session: ShellSession } | { ok: false; detail: string }> {
    const held = await this.#effects.hold(target);
    if (!held.ok) return held;
    if (this.repo.get(address)?.sessionPid !== held.session.pid) {
      this.repo.patch(address, { sessionPid: held.session.pid });
    }
    return held;
  }

  /**
   * The row to speak to a machine through, by its OWN id. Two aliases for one host are two
   * rows with one id: the one with a live session is the one to use, and failing that the
   * repo's own order (newest install first), so the choice is the same on every call rather
   * than whichever row SQLite happened to return.
   */
  #rowFor(machineId: string): MachineRow | null {
    const rows = this.repo.byMachineId(machineId);
    return rows.find((row) => this.#liveSession(row.address) !== null) ?? rows[0] ?? null;
  }

  /**
   * A session on a machine, as its own cookie — minted by its CLI over the shared shell
   * (remote-token.ts) and reused until near its TTL. Or why there is none.
   */
  async #sessionOn(target: RemoteTarget): Promise<{ cookie: string } | { detail: string }> {
    const address = `ssh:${target.alias}`;
    const held = this.#sessions.get(address);
    if (held !== undefined && Date.now() - held.at < SESSION_REUSE_MS) return held;
    const minted = await mintTokenOnRemote(target, this.#effects.runOn);
    if (minted.kind !== "minted") return { detail: minted.detail };
    const session = { cookie: `${SESSION_COOKIE}=${minted.token}`, at: Date.now() };
    this.#sessions.set(address, session);
    return session;
  }

  /** This machine: always installed, always up, never a target. */
  #localMachine(): MachineInfo {
    const lock = readServerLock(this.dataRoot);
    return {
      id: LOCAL_MACHINE_ID,
      alias: os.hostname(),
      machineId: this.#machineId,
      installed: { version: VERSION, at: lock?.startedAt ?? this.#effects.now().toISOString() },
      local: true,
      connection: null,
      api: null,
      status: {
        state: "running",
        checkedAt: this.#effects.now().toISOString(),
        ...(lock === null ? {} : { port: lock.port }),
      },
    };
  }

  /** This machine, then the ssh config's host aliases with what is known about each. */
  #allMachines(): MachineInfo[] {
    const remotes = this.#effects.listAliases().map((alias): MachineInfo => {
      const id = `ssh:${alias}`;
      const row = this.repo.get(id);
      const session = this.#liveSession(id);
      return {
        id,
        alias,
        machineId: row?.machineId ?? null,
        installed:
          row?.version == null ? null : { version: row.version, at: row.installedAt ?? "" },
        local: false,
        connection: session === null ? null : { pid: session.pid },
        api: this.#apiSeen.get(id) ?? null,
        status: this.#statuses.get(id) ?? null,
      };
    });
    return [this.#localMachine(), ...remotes];
  }

  /**
   * The machines this server knows, answered for one Project: `installed` means installed
   * FOR THIS PROJECT; a host installed for another one is reported through `elsewhere`, so
   * the page offers an adoption (one row) rather than an install (30 MB over ssh).
   */
  list(projectId: string): MachineInfo[] {
    const members = new Set(this.#members(projectId));
    return this.#allMachines().map((machine) => {
      if (machine.local) return machine;
      const mine = members.has(machine.id);
      return {
        ...machine,
        installed: mine ? machine.installed : null,
        ...(!mine && machine.installed !== null ? { elsewhere: machine.installed } : {}),
      };
    });
  }

  /** Drops a machine from a Project. The program stays installed; only the membership goes. */
  release(projectId: string, address: string): void {
    this.#setMember(projectId, address, false);
  }

  /** Every Project on this server that uses a given machine — who its credentials belong to. */
  #projectsUsing(address: string): string[] {
    let dirs: string[] = [];
    try {
      dirs = fs
        .readdirSync(this.dataRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      dirs = [];
    }
    // The default Project is always a candidate: every server seeds it, so it may be using
    // a machine before its directory has been created on this root.
    const candidates = dirs.includes(DEFAULT_PROJECT_ID) ? dirs : [...dirs, DEFAULT_PROJECT_ID];
    return candidates.filter((projectId) => this.#members(projectId).includes(address));
  }

  /**
   * The version this server would install, or null when it has no image to push — a dev
   * checkout that has never been pushed to is the one shape with none. The page asks for it
   * so it can say so up front, rather than letting every install fail at the same step.
   */
  imageVersion(): string | null {
    return this.#effects.resolvePlan(this.dataRoot)?.version ?? null;
  }

  /** The running or last job; null before the first one. */
  job(): MachineJob | null {
    return this.#job;
  }

  /**
   * Stamps what a forwarded request just learned (proxy.ts's ProxyReport): the machine's
   * API answered, or the connection had nowhere to deliver. Passive on purpose — the proxy
   * carries every request the app makes to a machine, so the fact rides traffic that flows
   * anyway, and a machine nobody asks about is simply not measured.
   */
  noteApiSeen(machineId: string, outcome: { ok: true } | { ok: false; detail: string }): void {
    const address = this.#rowFor(machineId)?.address;
    if (address === undefined) return;
    const at = this.#effects.now().toISOString();
    this.#apiSeen.set(
      address,
      outcome.ok ? { answeredAt: at } : { failedAt: at, detail: outcome.detail },
    );
  }

  /**
   * What the proxy needs to forward a request to a machine addressed by its OWN id: a dial
   * through the connection, the port its server is on over there, and a session there. Null
   * when the machine is not connected.
   */
  async proxyTarget(
    machineId: string,
  ): Promise<{ agent: http.Agent; port: number; cookie: string } | null> {
    const row = this.#rowFor(machineId);
    if (row === null || row.remotePort === null || this.#liveSession(row.address) === null) {
      return null;
    }
    const target = this.#targetOf(row.address.slice("ssh:".length));
    const session = await this.#sessionOn(target);
    if (!("cookie" in session)) return null;
    return {
      agent: this.#effects.agent(target, row.remotePort),
      port: row.remotePort,
      cookie: session.cookie,
    };
  }

  /**
   * The subdirectories of `dir` on a machine, over the HELD connection — so picking a
   * workspace on it costs one command and no round trip to its API. Null when the machine is
   * not connected: a read must not open ssh on its own, or a disconnected machine would be
   * reconnected by whoever browsed it.
   */
  async listDirs(
    machineId: string,
    dir: string,
  ): Promise<{
    path: string;
    parent: string | null;
    entries: { name: string; path: string }[];
  } | null> {
    const row = this.#rowFor(machineId);
    if (row === null || this.#liveSession(row.address) === null) return null;
    const target = this.#targetOf(row.address.slice("ssh:".length));
    const result = await this.#effects.runOn(target, listDirsCommand(dir));
    if (result.code !== 0) return null;
    const [head, rest] = result.stdout.split(DIR_LIST_MARK);
    const path = (head ?? "").trim().split("\n").pop()?.trim() ?? "";
    if (path === "") return null;
    const names = (rest ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    const join = (name: string) => (path.endsWith("/") ? `${path}${name}` : `${path}/${name}`);
    return {
      path,
      parent: path === "/" ? null : path.slice(0, path.lastIndexOf("/")) || "/",
      entries: names.sort((a, b) => a.localeCompare(b)).map((name) => ({ name, path: join(name) })),
    };
  }

  /**
   * Probes the machines this server has installed on, refreshing their statuses. Only those:
   * the ssh config can declare hundreds of hosts, and a host nothing was installed on has no
   * server to ask about. Failures are states, not errors (server-state.ts).
   */
  async probeInstalled(projectId: string): Promise<void> {
    const inFlight = this.#probing.get(projectId);
    if (inFlight !== undefined) return inFlight;
    const round = this.#probeRound(projectId).finally(() => this.#probing.delete(projectId));
    this.#probing.set(projectId, round);
    return round;
  }

  async #probeRound(projectId: string): Promise<void> {
    const queue = this.list(projectId).filter((m) => !m.local && m.installed !== null);
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let machine = queue.shift(); machine !== undefined; machine = queue.shift()) {
        await this.#refreshStatus(machine.id, this.#targetOf(machine.alias));
      }
    });
    await Promise.all(workers);
  }

  /**
   * Writes down what a probe just said — the status, and the id if it gave one. EVERY probe
   * goes through here, the scheduled round and a connect's own alike: a connect that started
   * a server and heard it answer is the freshest fact there is about that machine, and a page
   * that still showed it stopped until the next scheduled round would be reporting an older
   * answer over a newer one.
   */
  #recordProbe(address: string, probe: Awaited<ReturnType<MachinesEffects["probe"]>>): void {
    const state = probe.state;
    this.#statuses.set(address, {
      state: state.kind,
      checkedAt: this.#effects.now().toISOString(),
      ...(state.kind === "running" ? { port: state.port } : {}),
      ...(state.kind === "unreachable" ? { detail: state.detail } : {}),
    });
    this.#rememberMachineId(address, probe.machineId);
  }

  /**
   * Records an id a probe just heard. An id NEVER changes for a machine, so a probe that
   * answers a different one means the alias was repointed — the newer answer is the true one.
   *
   * And a different machine is not covered by what this row remembers. Everything the row
   * holds about the far side — what this server installed there and when, what platform the
   * install found, the port its server was last bound to — was learned from the machine that
   * is no longer at this address. Kept, it would report the newcomer as already provisioned
   * at a build it has never run, and the install that would have corrected that is exactly
   * what an "already installed" record suppresses. The first id a machine ever gives keeps
   * the record: null to minted is one machine finally saying who it is, not a substitution.
   *
   * `sessionPid` deliberately survives: it names the ssh child THIS server holds, which is
   * the one that just answered, and forgetting it would leave a process nothing can close.
   */
  #rememberMachineId(address: string, machineId: string | null): void {
    if (machineId === null) return;
    const known = this.repo.get(address)?.machineId ?? null;
    if (known === machineId) return;
    if (known === null) {
      this.repo.patch(address, { machineId });
      return;
    }
    this.repo.patch(address, {
      machineId,
      version: null,
      installedAt: null,
      remotePort: null,
      platform: null,
    });
  }

  /**
   * Asks a machine what it is now and writes down both halves of the answer.
   *
   * Called after anything that CHANGES what is running there. A machine mints its id when its
   * server starts, so the first start of a build that mints one is the moment its identity
   * comes into existence — and until this side has heard it, the machine is addressable by
   * nothing: the proxy cannot route to it and the workspace picker will not offer it. Leaving
   * that to the next scheduled probe means an operation that succeeded still reads as not
   * having worked.
   */
  async #refreshStatus(address: string, target: RemoteTarget): Promise<void> {
    this.#recordProbe(address, await this.#probe(address, target));
  }

  /** One probe of a machine, in the dialect its install found it to speak. */
  #probe(address: string, target: RemoteTarget): ReturnType<MachinesEffects["probe"]> {
    return this.#effects.probe(
      target,
      this.#effects.runOn,
      this.repo.get(address)?.platform ?? null,
    );
  }

  // --- jobs ---------------------------------------------------------------------------------

  #startJob(
    kind: MachineJob["kind"],
    machine: MachineInfo,
    work: (say: (line: string) => void) => Promise<MachineJob["result"]>,
  ): void {
    const job: MachineJob = {
      kind,
      machineId: machine.id,
      alias: machine.alias,
      running: true,
      log: [],
      result: null,
    };
    this.#job = job;
    const say = (line: string) => {
      job.log.push(line);
    };
    // Not awaited: the caller is an HTTP handler answering 202. Failures land in the job.
    void (async () => {
      try {
        this.#busy.add(machine.id);
        job.result = await work(say);
      } catch (err) {
        job.result = {
          ok: false,
          step: kind,
          message: err instanceof Error ? err.message : String(err),
        };
      } finally {
        this.#busy.delete(machine.id);
        job.running = false;
      }
    })();
  }

  /**
   * Starts an install, refusing rather than queueing. The refusals decidable here are
   * answered synchronously, so the page distinguishes "did not start" from "started and
   * failed" without reading the log.
   */
  async startInstall(
    projectId: string,
    address: string,
    /**
     * Install the program even when its version already matches, and restart it. Answers the
     * one failure that needs it (see the job's `canReplaceProgram`); never inferred, because
     * it stops a server other people may be using.
     */
    replaceProgram = false,
  ): Promise<{ ok: true } | { ok: false; why: InstallRefusal }> {
    if (this.#job?.running === true) return { ok: false, why: "busy" };
    const machine = this.#allMachines().find((entry) => entry.id === address);
    if (machine === undefined) return { ok: false, why: "unknown-machine" };
    // Never this machine: a server does not push this build over its own program directory
    // while running from it. The synthetic row is the obvious case; an alias that points
    // back home — `Host localhost`, a second name for this host — is the same machine at
    // another address, and the id a probe once heard from it says so without any ssh. An
    // alias never probed is asked inside the job, before anything is written.
    if (machine.local || (machine.machineId !== null && machine.machineId === this.#machineId)) {
      return { ok: false, why: "self" };
    }
    const plan = this.#effects.resolvePlan(this.dataRoot);
    if (plan === null) return { ok: false, why: "no-image" };
    const target = this.#targetOf(machine.alias);

    this.#startJob("install", machine, async (say) => {
      say(`Installing ${plan.version} on ${machineIdentity(target.alias, target.user)}…`);
      // Only the machine can say whether this alias is this host under another name.
      // Unreachable is not a refusal — a host with nothing installed yet answers exactly
      // that — this server's own id is.
      const heard = await this.#effects.probe(target, this.#effects.runOn, null);
      this.#rememberMachineId(address, heard.machineId);
      if (heard.machineId !== null && heard.machineId === this.#machineId) {
        return {
          ok: false,
          step: "connect",
          message:
            "That alias reaches this very machine — it answered with this server's own id. A server does not push this build over the program directory it is running from.",
        };
      }
      const outcome = await this.#effects.install({
        target,
        plan,
        onProgress: say,
        assets: this.#assets,
        ...(replaceProgram ? { forceInstaller: true } : {}),
      });
      if (outcome.kind === "failed") {
        return { ok: false, step: outcome.step, message: outcome.detail };
      }
      // What the machine is, before anything below asks it again: the hand-over and the
      // restart both probe, and they should already speak its dialect.
      this.repo.patch(address, { platform: outcome.identity.platform });
      // A server that carries no pushed state of its own — a packaged install, a release
      // from a tarball — has nothing to hand over: what is on that machine is what this
      // server would have sent. The hand-over is for the machine whose PROCESS may be
      // behind its files, and that can only be so when there is a pushed build to be behind.
      if (outcome.kind !== "installed" && plan.harness === null) {
        say("Nothing pushed here to hand over; the machine already carries this release.");
      } else if (outcome.kind !== "installed") {
        // The PROGRAM over there is already this release — either with our pushed state
        // (`already-installed`) or without it (`state-only`). Either way what may still be
        // wrong is the PROCESS: a server runs the code it loaded at start, so a machine whose
        // files were brought forward while it ran goes on serving the older ones, reporting a
        // version it is not running. The update channel is what makes the two agree, and it
        // asks the machine itself, so a runtime that cannot claim this platform refuses in
        // words rather than restarting into a silent fallback.
        say("Handing this build to its own update channel…");
        const pushed = await this.#handOverBuild(address, target, say);
        if (pushed.kind === "no-server") {
          say("Its server is not running; this build will be used when it next starts.");
        } else if (pushed.kind !== "upgraded") {
          return {
            ok: false,
            step: "hand over the pushed build",
            message:
              pushed.kind === "no-build"
                ? "this server stands on no build to hand over."
                : pushed.kind === "refused"
                  ? `that machine refused this build — ${pushed.detail}`
                  : pushed.detail,
            // Every failure on THIS path leaves the same next step: the release over there
            // matches, so the installer is skipped, and the only thing that can still change
            // the machine is installing it anyway — which replicates the store the update
            // channel needs. Not offered for `no-build`, which is this server's own lack.
            ...(pushed.kind !== "no-build" && !replaceProgram
              ? { canReplaceProgram: true as const }
              : {}),
          };
        } else if (!pushed.persisted) {
          // Live over there, and gone at its next restart: the machine could not write the
          // version to its disk. Not recorded as this version — the record would be true
          // until the first restart and false ever after — and the same next step as a
          // refusal, since installing anyway is what rewrites the store on its disk.
          return {
            ok: false,
            step: "hand over the pushed build",
            message:
              "that machine is running this build but could not write it to its disk — it will revert at its next restart. Check its disk and permissions.",
            ...(replaceProgram ? {} : { canReplaceProgram: true as const }),
          };
        } else {
          say(pushed.detail === "" ? "Update accepted." : pushed.detail);
        }
      }
      const version = outcome.kind === "already-installed" ? outcome.version : plan.version;
      // Installing replaced the program ON DISK; a server that was up is restarted onto it,
      // or it would report the new version and behave like the old one.
      const restarted =
        outcome.kind === "installed"
          ? await this.#restartAfterInstall(address, target, say)
          : { ok: true as const };
      // The files landed whatever the restart did: the record says what is on its disk, and
      // membership says whose machine it is. A restart that failed is the job's outcome, not
      // a footnote in its log — the page shows it, with Restart as the next step.
      this.repo.patch(address, { version, installedAt: this.#effects.now().toISOString() });
      // The Project that asked for the install is the Project that gets the machine.
      this.#setMember(projectId, address, true);
      if (!restarted.ok) {
        return {
          ok: false,
          step: "restart its server",
          message: `installed, but ${restarted.detail} The old process is still serving; restart it.`,
        };
      }
      return {
        ok: true,
        installed: outcome.kind === "state-only" ? "installed" : outcome.kind,
        version,
      };
    });
    return { ok: true };
  }

  /**
   * Brings a machine's server up and holds the connection to it, as a job — a start plus a
   * readiness wait is minutes in the bad case. Every step is idempotent, so a repeat is safe.
   */
  async startConnect(address: string): Promise<{ ok: true } | { ok: false; why: ConnectRefusal }> {
    if (this.#job?.running === true) return { ok: false, why: "busy" };
    const machine = this.#allMachines().find((entry) => entry.id === address);
    if (machine === undefined) return { ok: false, why: "unknown-machine" };
    // The machine's own id is what settles "that is here": the alias may point back home.
    if (machine.local || (machine.machineId !== null && machine.machineId === this.#machineId)) {
      return { ok: false, why: "self" };
    }
    if (machine.installed === null) return { ok: false, why: "not-installed" };
    // A Windows remote has no `sh` to hold a session on (transport/connection.ts), so there
    // is no connection to hold, no SOCKS port to dial its API through, and no shell to browse
    // it with. Said here, in one sentence, rather than discovered as a POSIX command failing
    // under cmd.exe in the job's log.
    if (this.repo.get(address)?.platform === "win32") return { ok: false, why: "unsupported" };
    this.#startJob("connect", machine, (say) => this.#connect(machine, say));
    return { ok: true };
  }

  async #connect(machine: MachineInfo, say: (line: string) => void): Promise<MachineJob["result"]> {
    const address = machine.id;
    const target = this.#targetOf(machine.alias);

    // Asked even when the connection is already up: it is an ssh process on THIS side,
    // and it outlives the far server. Taking it as the answer reported "connected" over a
    // dead server — and every caller that then found the machine silent asked for another
    // connect, which said "already connected" again, forever. Reconnecting (to retry a sync
    // that failed, or pick up a new key) now costs one probe and stays honest.
    say("Asking what is running there…");
    const probed = await this.#probe(address, target);
    this.#recordProbe(address, probed);
    if (probed.state.kind === "unreachable") {
      // The same dead end an install reaches, and the same way out: the machine cannot
      // answer because the CLI in its store is not one this server can talk to, and the
      // installer is what replaces it. Offered here too — a connect that only reports
      // OpenSSH's or commander's words leaves a person with nothing to do next.
      return {
        ok: false,
        step: "connect",
        message: probed.state.detail,
        canReplaceProgram: true,
      };
    }
    // The refusal startConnect made from the record, made again from what was just heard: an
    // alias never probed before, or one repointed here since, answers this server's own id
    // only now — and a connection "to" it would be a tunnel from this server back to itself.
    if (probed.machineId !== null && probed.machineId === this.#machineId) {
      return {
        ok: false,
        step: "connect",
        message:
          "That alias reaches this very machine — it answered with this server's own id. There is nothing to connect to.",
      };
    }
    let remotePort: number;
    if (probed.state.kind === "running") {
      remotePort = probed.state.port;
      say(`Its server is already up on port ${remotePort}.`);
    } else {
      remotePort = this.repo.get(address)?.remotePort ?? DEFAULT_SERVER_PORT;
      say(`Starting its server on port ${remotePort}…`);
      const started = await this.#effects.startServer(target, remotePort);
      if (!started.ok) return { ok: false, step: "start its server", message: started.detail };
      // A machine mints its id when its server starts, so one that was down had none — and
      // its port and pid are now the freshest fact about it.
      this.#recordProbe(address, await this.#probe(address, target));
    }

    say("Opening the connection…");
    const connection = await this.#connection(address, target);
    if (!connection.ok) return { ok: false, step: "connect", message: connection.detail };
    this.repo.patch(address, { remotePort });
    say(`Connected; its server is on port ${remotePort} over there.`);
    // An Agent started over there resolves its model against THAT machine's config, so a
    // machine without our credentials is connected and unusable.
    await this.#syncModels(address, target, remotePort, say, this.#projectsUsing(address));
    return { ok: true, connected: true };
  }

  /**
   * Drops the connection to a machine. The remote server is left RUNNING: it is that
   * machine's own server, and other people may be on it.
   */
  disconnect(address: string): void {
    closeConnectionTo(address);
    this.#sessions.delete(address);
    if (this.repo.get(address) !== null) {
      this.repo.patch(address, { sessionPid: null });
    }
  }

  // --- the generation's lifetime: what an App does at boot and on its way out ------------------

  /**
   * Re-holds every connection the record says was held — a restart or a hot push in between
   * notwithstanding — five machines at a time, starting a server that is down on the way.
   * Only those: an explicit disconnect cleared its record, and a machine merely installed on
   * was never asked for. Called by the platform at boot and not awaited there: a host that is
   * slow to answer must not hold up the App that serves everything else.
   */
  async start(): Promise<void> {
    // The build first, the connections second: a machine behind this build is brought
    // forward over a transient session and its server restarted, and only then re-held —
    // so the connection that stays is to the server that will keep running, and the Model
    // config handed over as it connects lands on the build that will read it.
    await this.syncOutOfDate();
    await this.autoConnect();
  }

  /**
   * Closes every connection THIS generation opened — the platform's dispose effect on a hot
   * push. The record of which were held stays, so the successor's start() brings each back.
   * Nothing here closes by a remembered pid: the child handles are this generation's own.
   */
  stop(): void {
    closeAllConnections();
  }

  // --- work on a machine ---------------------------------------------------------------------

  /** Hands a machine the Model credentials an Agent over there needs. Failure is reported, never fatal. */
  async #syncModels(
    address: string,
    target: RemoteTarget,
    port: number,
    say: (line: string) => void,
    projects: string[],
  ): Promise<void> {
    if (projects.length === 0) {
      say("No models synced — no Project on this server uses that machine.");
      return;
    }
    const session = await this.#sessionOn(target);
    if (!("cookie" in session)) {
      say(`Models not synced — ${session.detail}`);
      return;
    }
    const outcome = await syncModelsToMachine({
      api: machineApi(this.#effects.agent(target, port), port, session.cookie),
      loadLocal: (projectId) => this.#localModels(projectId),
      projects,
    });
    if (outcome.kind === "failed") {
      say(`Models not synced — ${outcome.detail}`);
      return;
    }
    if (outcome.created.length > 0) say(`Created there: ${outcome.created.join(", ")}.`);
    if (outcome.projects.length > 0) say(`Models synced: ${outcome.projects.join(", ")}.`);
    for (const { projectId, detail } of outcome.refused) {
      say(`Models of ${projectId} not synced — ${detail}`);
    }
    void address;
  }

  /**
   * A sync of the given Projects to a machine, coalesced: while one runs, a second ask marks
   * it to run once more when it ends. The trailing run reads the config fresh, so however
   * many edits arrived during the first, the machine ends on the last of them. Nothing is
   * dropped, and a burst of edits costs two round trips rather than one per edit.
   */
  async #syncCoalesced(
    address: string,
    target: RemoteTarget,
    port: number,
    projects: () => string[],
  ): Promise<void> {
    const running = this.#syncing.get(address);
    if (running !== undefined) {
      running.again = true;
      return;
    }
    const slot = { again: false };
    this.#syncing.set(address, slot);
    try {
      do {
        slot.again = false;
        await this.#syncModels(address, target, port, () => {}, projects());
      } while (slot.again);
    } finally {
      this.#syncing.delete(address);
    }
  }

  /**
   * This side's model table for a Project, narrowed to the entries worth carrying: an entry
   * with an inline key or its own base URL is something the machine cannot already have.
   * Bare catalog entries are skipped — every server seeds the same presets.
   */
  async #localModels(projectId: string): Promise<LocalModels | null> {
    let config: ProjectConfig;
    try {
      config = await this.#effects.loadConfig(projectId);
    } catch {
      return null;
    }
    const models = config.models.filter(
      (entry) => (entry.api_key ?? "") !== "" || (entry.base_url ?? "") !== "",
    );
    return {
      models,
      ...(config.default_model !== undefined ? { defaultModel: config.default_model } : {}),
      ...(config.vision_model !== undefined ? { visionModel: config.vision_model } : {}),
      ...(config.name !== undefined ? { name: config.name } : {}),
    };
  }

  /** Hands a machine this server's pushed build, through the connection held to it. */
  async #handOverBuild(
    address: string,
    target: RemoteTarget,
    say: (line: string) => void,
  ): Promise<UpgradeOutcome> {
    const probed = await this.#effects.probe(
      target,
      this.#effects.runOn,
      this.repo.get(address)?.platform ?? null,
    );
    if (probed.state.kind === "unreachable") {
      return { kind: "failed", step: "reach", detail: probed.state.detail };
    }
    // A hot swap replaces the code a RUNNING server is serving; with none there is nothing
    // to swap, and nothing wrong either — its disk already holds what it will next load.
    if (probed.state.kind !== "running") return { kind: "no-server" };
    // A dial, not a hold: the agent below opens the session transiently if it is not up,
    // and a machine that was merely installed on is not made a held one by being brought
    // forward at boot — only a connect asks for that.
    const port = probed.state.port;
    this.repo.patch(address, { remotePort: port });
    const session = await this.#sessionOn(target);
    if (!("cookie" in session)) return { kind: "failed", step: "sign in", detail: session.detail };
    return this.#effects.upgrade({
      agent: this.#effects.agent(target, port),
      port,
      cookie: session.cookie,
      dataRoot: this.dataRoot,
      onProgress: say,
    });
  }

  /**
   * Stops a machine's server and starts it again on the same port, so what runs there is
   * what is on its disk.
   *
   * The stop is CHECKED. A start after a stop that did not happen finds the port still held
   * by the process that never died, and the readiness probe — which only asks whether a
   * server answers — reads that as success: the machine then reports a version it is not
   * running, which is the one outcome every guard on this path exists to prevent.
   */
  async #restartServer(
    address: string,
    target: RemoteTarget,
    say: (line: string) => void,
  ): Promise<{ ok: true; port: number } | { ok: false; detail: string }> {
    const before = await this.#effects.probe(
      target,
      this.#effects.runOn,
      this.repo.get(address)?.platform ?? null,
    );
    if (before.state.kind === "unreachable") return { ok: false, detail: before.state.detail };
    if (before.state.kind !== "running") {
      return { ok: false, detail: "no server is running on that machine." };
    }
    const port = before.state.port;
    say(`Stopping its server on port ${port}…`);
    const stopped = await this.#effects.stopServer(target);
    if (!stopped.ok) return { ok: false, detail: `it would not stop — ${stopped.detail}` };
    // Its sessions died with it. The connection did not: it is an ssh session to the HOST,
    // and the server coming back on the same port is reachable through it as before.
    this.#sessions.delete(address);
    say(`Starting it again on port ${port}…`);
    const started = await this.#effects.startServer(target, port);
    if (!started.ok) {
      return { ok: false, detail: `its server did not come back up: ${started.detail}` };
    }
    // It is a different process now, and possibly one with an identity it did not have a
    // moment ago: a machine mints its id when a server that mints one starts there.
    await this.#refreshStatus(address, target);
    this.repo.patch(address, { remotePort: port });
    return { ok: true, port };
  }

  /**
   * Restarts a machine's server as a job — the same shape as an install or a connect, and
   * for the same reason: a stop plus a readiness wait is tens of seconds.
   */
  async startRestart(address: string): Promise<{ ok: true } | { ok: false; why: ConnectRefusal }> {
    if (this.#job?.running === true) return { ok: false, why: "busy" };
    const machine = this.#allMachines().find((entry) => entry.id === address);
    if (machine === undefined) return { ok: false, why: "unknown-machine" };
    if (machine.local) return { ok: false, why: "self" };
    if (machine.installed === null) return { ok: false, why: "not-installed" };
    this.#startJob("restart", machine, async (say) => {
      const target = this.#targetOf(machine.alias);
      const done = await this.#restartServer(address, target, say);
      if (!done.ok) return { ok: false, step: "restart", message: done.detail };
      say(`Restarted on port ${done.port}.`);
      return { ok: true, connected: true };
    });
    return { ok: true };
  }

  /**
   * Puts a freshly installed build into service. Only for a machine whose server was already
   * running: one that was down is left down — installing software is not a decision that the
   * machine should be serving.
   */
  async #restartAfterInstall(
    address: string,
    target: RemoteTarget,
    say: (line: string) => void,
  ): Promise<{ ok: true } | { ok: false; detail: string }> {
    const before = await this.#effects.probe(
      target,
      this.#effects.runOn,
      this.repo.get(address)?.platform ?? null,
    );
    if (before.state.kind !== "running") {
      say("Its server was not running; the new build will be used when it next starts.");
      return { ok: true };
    }
    const done = await this.#restartServer(address, target, say);
    if (done.ok) {
      say(`Restarted on port ${done.port}.`);
      return { ok: true };
    }
    return { ok: false, detail: done.detail };
  }

  // --- the automatic sweeps, run when an App boots ----------------------------------------------

  /** Runs `work` with this machine's slot held, or returns null when it is already busy. */
  async #withMachine<T>(address: string, work: () => Promise<T>): Promise<T | null> {
    if (this.#busy.has(address)) return null;
    this.#busy.add(address);
    try {
      return await work();
    } finally {
      this.#busy.delete(address);
    }
  }

  async #sweep(
    addresses: string[],
    work: (address: string, target: RemoteTarget) => Promise<void>,
  ): Promise<void> {
    const queue = [...addresses];
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let address = queue.shift(); address !== undefined; address = queue.shift()) {
        const target = this.#targetOf(address.slice("ssh:".length));
        try {
          await this.#withMachine(address, () => work(address, target));
        } catch {
          // Best effort: the page shows the machine as it is.
        }
      }
    });
    await Promise.all(workers);
  }

  /** Hands this server's build to every machine carrying a different one. */
  async syncOutOfDate(): Promise<void> {
    const plan = this.#effects.resolvePlan(this.dataRoot);
    if (plan === null) return;
    const behind = this.repo
      .all()
      .filter((row) => row.version !== null && row.version !== plan.version)
      .map((row) => row.address);
    await this.#sweep(behind, async (address, target) => {
      const outcome = await this.#handOverBuild(address, target, () => {});
      // Recorded only when the machine also wrote it down: a swap it could not persist is
      // gone at its next restart, and a record of it would outlive the thing it records.
      if (outcome.kind === "upgraded" && outcome.persisted) {
        this.repo.patch(address, {
          version: plan.version,
          installedAt: this.#effects.now().toISOString(),
        });
      }
    });
  }

  /** Re-holds every machine recorded as held that this generation does not yet hold. */
  async autoConnect(): Promise<void> {
    const unconnected = this.#allMachines().filter(
      (m) =>
        !m.local &&
        m.installed !== null &&
        m.connection === null &&
        this.repo.get(m.id)?.sessionPid != null &&
        this.repo.get(m.id)?.platform !== "win32",
    );
    await this.#sweep(
      unconnected.map((m) => m.id),
      async (address) => {
        const machine = unconnected.find((m) => m.id === address)!;
        await this.#connect(machine, () => {});
      },
    );
  }

  /** Brings every connected machine up to date with this server's Model config. */
  /**
   * Pushes a Project's models to every connected machine it uses — a key rotated here, a
   * default switched here, reaches them at once. Not through #sweep: that returns null for a
   * machine that is busy and would silently drop the edit; a sync in flight is instead told
   * to run once more (#syncCoalesced), and an install in flight on the machine is not a
   * reason to lose a credential either — the two do not contend for the shell.
   */
  async syncModelsEverywhere(projectId: string): Promise<void> {
    const connected = this.list(projectId).filter(
      (m) => !m.local && m.installed !== null && m.connection !== null,
    );
    await Promise.all(
      connected.map(async (machine) => {
        const address = machine.id;
        const port =
          this.#liveSession(address) === null ? null : (this.repo.get(address)?.remotePort ?? null);
        if (port === null) return;
        try {
          await this.#syncCoalesced(address, this.#targetOf(machine.alias), port, () => [
            projectId,
          ]);
        } catch {
          // Best effort: the connect log is where a sync's own words go; this one has none.
        }
      }),
    );
  }
}

export abstract class Machines extends Interface<
  Pick<
    MachinesService,
    "list" | "imageVersion" | "job" | "startInstall" | "start" | "syncModelsEverywhere"
  >
>() {}

@Module({
  contributes: {
    "HttpModule.routes": [
      {
        id: "MachinesModule.routes",
        prefix: "/api/projects/:projectId/machines",
        auth: "user",
        order: 50,
      },
      {
        id: "MachinesModule.server-proxy",
        // The manifest is data: the literal, not machines/proxy.ts's SERVER_PROXY_PREFIX,
        // which the generator reads statically and cannot follow.
        prefix: "/server/",
        auth: "user",
        order: 51,
      },
    ],
  },
})
export class MachinesModule {
  @Use(RuntimeModule) private readonly config!: Config;
  @Use(RuntimeModule) private readonly db!: Db;
  @Use(RuntimeModule) private readonly hmr!: Hmr;
  @Use(RuntimeModule) private readonly overrides!: Overrides;
  @Use() private readonly access!: ProjectAccess;
  @Provide() machines!: Machines;
  @Bind("MachinesModule.routes") routes!: Hono<AppEnv>;
  @Bind("MachinesModule.server-proxy") serverProxyRoutes!: Hono<AppEnv>;
  setup({ effect }: ClassCtx) {
    // This machine's own id is minted on the first boot of this data root and stable ever
    // after — every stored reference to this machine, here and on the machines it reaches,
    // points at it. A test that supplies its own service mints none.
    const machines =
      this.overrides.value().machines ??
      (() => {
        const repo = new MachinesRepo(this.db as unknown as DatabaseSync);
        return new MachinesService(this.config.root, repo.ownId(), repo, {}, () =>
          this.hmr.assetsDir(),
        );
      })();
    this.machines = machines;
    this.routes = machinesRoutes({ machines, access: this.access });
    this.serverProxyRoutes = serverProxyApp(machines);
    // Every ssh session THIS generation opened closes with it; the successor's setup
    // re-holds each one the install record says was held.
    effect(() => machines.stop());
  }
}

/**
 * `/server/<machineId>/api/…` — a connected machine's API, forwarded over the connection held
 * to it and addressed by the machine's OWN id. Admins only: the request is made over there as
 * that machine's admin, with a session this server minted over the ssh access that installed
 * it, so this server's admin session is the one credential involved.
 */
function serverProxyApp(machines: MachinesService): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const proxy = machinesProxy(
    (machineId) => machines.proxyTarget(machineId),
    (machineId, outcome) => machines.noteApiSeen(machineId, outcome),
  );
  app.all("*", async (c) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can reach a machine's API.");
    }
    const answer = await proxy(c.req.raw);
    return answer ?? c.notFound();
  });
  return app;
}

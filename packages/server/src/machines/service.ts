/**
 * The machines service: this server's own `~/.ssh/config` as a list of targets, and putting
 * this build on one of them, reaching it, and keeping it configured.
 *
 * ONE JOB at a time — an install or a connect — started by POST and polled by the Web App
 * for its progress lines. The job lives in this App's memory; what it achieved is in web.db
 * (MachinesRepo): which machines carry this program, the forward held to each, and which
 * Project uses which. Every path to a machine is a held connection — the shared shell for
 * commands, one forward per machine for HTTP — and every request to a machine's API is made
 * as its admin, with a session this server mints over the ssh access that installed it.
 */
import fs from "node:fs";
import os from "node:os";
import { DEFAULT_PROJECT_ID, VERSION, loadProjectConfig } from "@prismshadow/penguin-core";
import type { ProjectConfig } from "@prismshadow/penguin-core";
import type { MachineInfo, MachineJob, MachineServerStatus } from "../api/types.js";
import { readServerLock } from "../lock.js";
import { SESSION_COOKIE } from "../auth/middleware.js";
import { listHostAliases, resolveTarget } from "./targets.js";
import { machineIdentity } from "./ssh-config.js";
import { DIR_LIST_MARK, listDirsCommand } from "./commands.js";
import type { RemoteTarget } from "./commands.js";
import type { ExecResult } from "./exec.js";
import { installOnRemote, resolvePushPlan } from "./install-server.js";
import { probeServerState } from "./server-state.js";
import { upgradeRemote } from "./upgrade.js";
import type { UpgradeOutcome } from "./upgrade.js";
import { mintTokenOnRemote } from "./remote-token.js";
import { closeShell, runOnShell } from "./ssh-session.js";
import { closeForward, forwardTo } from "./forward.js";
import { syncModelsToMachine } from "./models-sync.js";
import type { LocalModels } from "./models-sync.js";
import { machineApi } from "./machine-api.js";
import { startRemoteServer, stopRemoteServer } from "./server-control.js";
import { currentRemoteLayout } from "./layout.js";
import type { RemoteLayout } from "./layout.js";
import type { MachinesRepo } from "../db/repos/machines.js";

/** Why an install was refused before any ssh ran. */
type InstallRefusal = "busy" | "unknown-machine" | "unresolvable" | "no-image" | "self";
/** Why a connect was refused before any ssh ran. */
type ConnectRefusal = "busy" | "unknown-machine" | "not-installed" | "self";

/**
 * What this service does to the world, injectable as a set. Production passes none of them;
 * tests fake the reaching-out, because the real ones read the developer's own ~/.ssh/config
 * and spawn ssh against whatever it names.
 */
export interface MachinesEffects {
  listAliases: typeof listHostAliases;
  resolveTarget: typeof resolveTarget;
  resolvePlan: typeof resolvePushPlan;
  install: typeof installOnRemote;
  probe: typeof probeServerState;
  /** One command on a machine, over its shared shell. */
  runOn: (target: RemoteTarget, command: string) => Promise<ExecResult>;
  startServer: (target: RemoteTarget, port: number) => ReturnType<typeof startRemoteServer>;
  stopServer: (target: RemoteTarget) => ReturnType<typeof stopRemoteServer>;
  mintToken: (
    target: RemoteTarget,
    runOn: MachinesEffects["runOn"],
  ) => ReturnType<typeof mintTokenOnRemote>;
  upgrade: typeof upgradeRemote;
  /** This server's own Project config, credentials in plaintext — the source of a model sync. */
  loadConfig: (projectId: string) => Promise<ProjectConfig>;
  forward: typeof forwardTo;
  /** Injected so a test can pin the recorded timestamp instead of asserting around the clock. */
  now: () => Date;
}

/** The id of the entry standing for the machine this server runs on. */
const LOCAL_MACHINE_ID = "local";

/** True when a pid names a process this account can see (EPERM still means it is there). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** How many machines are worked on at once by the automatic sweeps and the probe. */
const CONCURRENCY = 5;

/** A minted session is used for this long before a fresh one is asked for (its TTL is an hour). */
const SESSION_REUSE_MS = 50 * 60_000;

export class MachinesService {
  #job: MachineJob | null = null;
  /** Last probe per address. In memory on purpose: a status is only true for the moment it was taken. */
  readonly #statuses = new Map<string, MachineServerStatus>();
  /**
   * Machines with a heavy operation in flight — an install, or the automatic sweep. Two
   * transfers racing for one host is how a 30-second command times out with nothing to say.
   */
  readonly #busy = new Set<string>();
  /** Sessions minted on machines, by address, reused until near their TTL. */
  readonly #sessions = new Map<string, { cookie: string; at: number }>();
  readonly #effects: MachinesEffects;
  readonly #assets: () => string | null;
  readonly #machineId: string;
  /** Which installation on each machine this instance reaches — its profile's (layout.ts). */
  readonly #layout: RemoteLayout;

  constructor(
    private readonly dataRoot: string,
    machineId: string,
    private readonly repo: MachinesRepo,
    effects: Partial<MachinesEffects> = {},
    assets: () => string | null = () => null,
    layout: RemoteLayout = currentRemoteLayout(),
  ) {
    this.#assets = assets;
    this.#machineId = machineId;
    this.#layout = layout;
    this.#effects = {
      listAliases: listHostAliases,
      resolveTarget,
      resolvePlan: resolvePushPlan,
      install: installOnRemote,
      probe: probeServerState,
      runOn: async (target, command) => {
        const result = await runOnShell(`ssh:${target.alias}`, target, command);
        return { code: result.code, stdout: result.output, stderr: "", timedOut: false };
      },
      startServer: (target, port) => startRemoteServer(target, port, layout, this.#effects.runOn),
      stopServer: (target) => stopRemoteServer(target, layout, this.#effects.runOn),
      mintToken: (target, runOn) => mintTokenOnRemote(target, layout, runOn),
      upgrade: upgradeRemote,
      loadConfig: (projectId) => loadProjectConfig(dataRoot, projectId),
      forward: forwardTo,
      now: () => new Date(),
      ...effects,
    };
  }

  // --- what is known -----------------------------------------------------------------------

  /** That machine's ssh target, or null when ssh cannot name the host any more. */
  async #targetOf(alias: string): Promise<RemoteTarget | null> {
    const resolved = await this.#effects.resolveTarget(alias);
    return resolved === null ? null : { alias, user: resolved.settings.user };
  }

  /** Addresses this server has installed on. */
  #installed(): string[] {
    return this.repo
      .all()
      .filter((row) => row.version !== null)
      .map((row) => row.address);
  }

  /**
   * The addresses a Project uses. A Project with no list yet is not one with an empty list:
   * machines were a property of the server before they were a property of a Project, so the
   * default Project's first read adopts what this server already had.
   */
  #members(projectId: string): string[] {
    const listed = this.repo.members(projectId);
    if (listed !== null) return listed;
    return projectId === DEFAULT_PROJECT_ID ? this.#installed() : [];
  }

  #setMember(projectId: string, address: string, member: boolean): void {
    const current = this.#members(projectId);
    this.repo.setMembers(
      projectId,
      member ? [...new Set([...current, address])] : current.filter((entry) => entry !== address),
    );
  }

  /**
   * The local port of a live forward to a machine, or null. "Live" is checked against the
   * PROCESS: a recorded pid that is gone is stale state. This is also how a hot-swapped or
   * restarted platform adopts a forward it never spawned.
   */
  #livePort(address: string): number | null {
    const row = this.repo.get(address);
    if (row?.forwardPid == null || row.forwardPort === null) return null;
    if (pidAlive(row.forwardPid)) return row.forwardPort;
    this.repo.patch(address, { forwardPid: null, forwardPort: null });
    return null;
  }

  /** The port a machine's API is reachable on, raising the forward when there is none live. */
  async #forward(
    address: string,
    target: RemoteTarget,
    remotePort: number,
  ): Promise<{ ok: true; port: number } | { ok: false; detail: string }> {
    const row = this.repo.get(address);
    const live = this.#livePort(address);
    if (live !== null && row?.remotePort === remotePort) return { ok: true, port: live };
    const raised = await this.#effects.forward({ address, target, remotePort });
    if (!raised.ok) return raised;
    this.repo.patch(address, { forwardPort: raised.port, forwardPid: raised.pid, remotePort });
    return { ok: true, port: raised.port };
  }

  /**
   * A session on a machine, as its own cookie — minted by its CLI over the shared shell
   * (remote-token.ts) and reused until near its TTL. Or why there is none.
   */
  async #sessionOn(target: RemoteTarget): Promise<{ cookie: string } | { detail: string }> {
    const address = `ssh:${target.alias}`;
    const held = this.#sessions.get(address);
    if (held !== undefined && Date.now() - held.at < SESSION_REUSE_MS) return held;
    const minted = await this.#effects.mintToken(target, this.#effects.runOn);
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
      connected: true,
      installed: { version: VERSION, at: lock?.startedAt ?? this.#effects.now().toISOString() },
      local: true,
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
      const port = this.#livePort(id);
      return {
        id,
        alias,
        machineId: row?.machineId ?? null,
        installed:
          row?.version == null ? null : { version: row.version, at: row.installedAt ?? "" },
        local: false,
        connected: port !== null,
        status: this.#statuses.get(id) ?? null,
      };
    });
    return [this.#localMachine(), ...remotes];
  }

  /**
   * The machines this server knows, answered for one Project: `installed` means installed
   * FOR THIS PROJECT; a host installed for another one is reported through `elsewhere`, so
   * the page offers an adoption (a line of JSON) rather than an install (30 MB over ssh).
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
    // The default Project is always a candidate: every server seeds it, and it is the one
    // that inherits this server's pre-Project machines (see #members).
    const candidates = dirs.includes(DEFAULT_PROJECT_ID) ? dirs : [...dirs, DEFAULT_PROJECT_ID];
    return candidates.filter((projectId) => this.#members(projectId).includes(address));
  }

  /** The version this server would install, or null when it has no image to push. */
  imageVersion(): string | null {
    return this.#effects.resolvePlan(this.dataRoot)?.version ?? null;
  }

  /** The running or last job; null before the first one. */
  job(): MachineJob | null {
    return this.#job;
  }

  /**
   * What the proxy needs to forward a request to a machine addressed by its OWN id: the
   * forward's port and a session there. Null when the machine is not connected.
   */
  async proxyTarget(machineId: string): Promise<{ port: number; cookie: string } | null> {
    const row = this.repo.byMachineId(machineId);
    if (row === null) return null;
    const port = this.#livePort(row.address);
    if (port === null) return null;
    const target = await this.#targetOf(row.address.slice("ssh:".length));
    if (target === null) return null;
    const session = await this.#sessionOn(target);
    return "cookie" in session ? { port, cookie: session.cookie } : null;
  }

  /**
   * The subdirectories of `dir` on a machine, over the shared shell — so picking a
   * workspace on it costs one command and no round trip to its API.
   */
  async listDirs(
    machineId: string,
    dir: string,
  ): Promise<{
    path: string;
    parent: string | null;
    entries: { name: string; path: string }[];
  } | null> {
    const row = this.repo.byMachineId(machineId);
    if (row === null) return null;
    const target = await this.#targetOf(row.address.slice("ssh:".length));
    if (target === null) return null;
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
    const queue = this.list(projectId).filter((m) => !m.local && m.installed !== null);
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let machine = queue.shift(); machine !== undefined; machine = queue.shift()) {
        const checkedAt = this.#effects.now().toISOString();
        const target = await this.#targetOf(machine.alias);
        if (target === null) {
          this.#statuses.set(machine.id, {
            state: "unreachable",
            checkedAt,
            detail: "ssh could not resolve that host.",
          });
          continue;
        }
        const probe = await this.#effects.probe(target, this.#layout, this.#effects.runOn);
        const state = probe.state;
        this.#statuses.set(machine.id, {
          state: state.kind,
          checkedAt,
          ...(state.kind === "running" ? { port: state.port } : {}),
          ...(state.kind === "unreachable" ? { detail: state.detail } : {}),
        });
        this.#rememberMachineId(machine.id, probe.machineId);
      }
    });
    await Promise.all(workers);
  }

  /**
   * Records an id a probe just heard. An id NEVER changes for a machine, so a probe that
   * answers a different one means the alias was repointed — the newer answer is the true one.
   */
  #rememberMachineId(address: string, machineId: string | null): void {
    if (machineId !== null && this.repo.get(address)?.machineId !== machineId) {
      this.repo.patch(address, { machineId });
    }
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
    const probe = await this.#effects.probe(target, this.#layout, this.#effects.runOn);
    const state = probe.state;
    this.#statuses.set(address, {
      state: state.kind,
      checkedAt: this.#effects.now().toISOString(),
      ...(state.kind === "running" ? { port: state.port } : {}),
      ...(state.kind === "unreachable" ? { detail: state.detail } : {}),
    });
    this.#rememberMachineId(address, probe.machineId);
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
    if (machine.local) return { ok: false, why: "self" };
    const plan = this.#effects.resolvePlan(this.dataRoot);
    if (plan === null) return { ok: false, why: "no-image" };
    const target = await this.#targetOf(machine.alias);
    if (target === null) return { ok: false, why: "unresolvable" };

    this.#startJob("install", machine, async (say) => {
      say(`Installing ${plan.version} on ${machineIdentity(target.alias, target.user)}…`);
      const outcome = await this.#effects.install({
        target,
        plan,
        onProgress: say,
        assets: this.#assets,
        layout: this.#layout,
        ...(replaceProgram ? { forceInstaller: true } : {}),
      });
      if (outcome.kind === "failed") {
        return { ok: false, step: outcome.step, message: outcome.detail };
      }
      if (outcome.kind !== "installed") {
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
        } else {
          say(pushed.detail === "" ? "Update accepted." : pushed.detail);
        }
      }
      const version = outcome.kind === "already-installed" ? outcome.version : plan.version;
      // Installing replaced the program ON DISK; a server that was up is restarted onto it,
      // or it would report the new version and behave like the old one.
      if (outcome.kind === "installed") await this.#restartAfterInstall(address, target, say);
      this.repo.patch(address, { version, installedAt: this.#effects.now().toISOString() });
      // The Project that asked for the install is the Project that gets the machine.
      this.#setMember(projectId, address, true);
      return {
        ok: true,
        installed: outcome.kind === "state-only" ? "installed" : outcome.kind,
        version,
      };
    });
    return { ok: true };
  }

  /**
   * Brings a machine's server up and holds a forward to it, as a job — a start plus a
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
    this.#startJob("connect", machine, (say) => this.#connect(machine, say));
    return { ok: true };
  }

  async #connect(machine: MachineInfo, say: (line: string) => void): Promise<MachineJob["result"]> {
    const address = machine.id;
    const target = await this.#targetOf(machine.alias);
    if (target === null)
      return { ok: false, step: "connect", message: "ssh could not resolve that host." };

    const live = this.#livePort(address);
    if (live !== null) {
      // Connecting again is how someone retries a sync that failed, or picks up a new key.
      say(`Already connected on port ${live}.`);
      const updated = await this.#updateOnConnect(address, target, live, say);
      if (!updated.ok) return updated.result;
      await this.#syncModels(address, target, live, say, this.#projectsUsing(address));
      return { ok: true, connected: true };
    }

    say("Asking what is running there…");
    const probed = await this.#effects.probe(target, this.#layout, this.#effects.runOn);
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
    this.#rememberMachineId(address, probed.machineId);
    let remotePort: number;
    if (probed.state.kind === "running") {
      remotePort = probed.state.port;
      say(`Its server is already up on port ${remotePort}.`);
    } else {
      remotePort = this.repo.get(address)?.remotePort ?? this.#layout.defaultPort;
      say(`Starting its server on port ${remotePort}…`);
      const started = await this.#effects.startServer(target, remotePort);
      if (!started.ok) return { ok: false, step: "start its server", message: started.detail };
      // A machine mints its id when its server starts, so one that was down had none.
      const again = await this.#effects.probe(target, this.#layout, this.#effects.runOn);
      this.#rememberMachineId(address, again.machineId);
    }

    say("Opening the forward…");
    const forward = await this.#forward(address, target, remotePort);
    if (!forward.ok) return { ok: false, step: "connect", message: forward.detail };
    say(`Connected on local port ${forward.port}.`);
    // The forward stays up whatever follows: the machine IS connected now, and a build it
    // will not take is a reason to say so, not to tear the tunnel down again.
    const updated = await this.#updateOnConnect(address, target, forward.port, say);
    if (!updated.ok) return updated.result;
    // An Agent started over there resolves its model against THAT machine's config, so a
    // machine without our credentials is connected and unusable.
    await this.#syncModels(address, target, forward.port, say, this.#projectsUsing(address));
    return { ok: true, connected: true };
  }

  /**
   * Hands a freshly connected machine this server's build when it carries a different one —
   * connecting is the moment a machine that was down at boot (and so missed the boot-time
   * sweep) becomes reachable at all. Over the forward just raised, so no second probe.
   *
   * Only the hot channel is automatic: a swap is seconds and kills nothing. A hand-over the
   * machine cannot take is reported with the one step left — reinstalling the program — and
   * that step stays a person's, because it restarts a server other people may be on.
   */
  async #updateOnConnect(
    address: string,
    target: RemoteTarget,
    port: number,
    say: (line: string) => void,
  ): Promise<{ ok: true } | { ok: false; result: MachineJob["result"] }> {
    const plan = this.#effects.resolvePlan(this.dataRoot);
    const row = this.repo.get(address);
    if (plan === null || row === null || row.version === plan.version) return { ok: true };
    say(`It carries ${row.version ?? "an unknown build"}; handing over ${plan.version}…`);
    const failed = (message: string): { ok: false; result: MachineJob["result"] } => ({
      ok: false,
      result: { ok: false, step: "update its build", message, canReplaceProgram: true },
    });
    const session = await this.#sessionOn(target);
    if (!("cookie" in session)) return failed(session.detail);
    const outcome = await this.#effects.upgrade({
      port,
      cookie: session.cookie,
      dataRoot: this.dataRoot,
      onProgress: say,
    });
    switch (outcome.kind) {
      case "upgraded":
        this.repo.patch(address, {
          version: plan.version,
          installedAt: this.#effects.now().toISOString(),
        });
        say(outcome.detail === "" ? "Update accepted." : outcome.detail);
        return { ok: true };
      case "no-server":
        // The forward answered a moment ago; treat a vanished server as the far side's word.
        return failed("its server stopped answering before the build could be handed over.");
      case "no-build":
        // The versions differ by BASE RELEASE, and a release is not something the hot
        // channel carries: only the installer can bring that machine forward.
        return failed(
          `this server has no pushed build to hand over; ${plan.version} needs installing there.`,
        );
      case "refused":
        return failed(`that machine refused this build — ${outcome.detail}`);
      case "failed":
        return failed(outcome.detail);
    }
  }

  /**
   * Drops a machine's forward and shell. The remote server is left RUNNING: it is that
   * machine's own server, and other people may be on it.
   */
  disconnect(address: string): void {
    closeShell(address);
    closeForward(address, this.repo.get(address)?.forwardPid);
    this.#sessions.delete(address);
    if (this.repo.get(address) !== null) {
      this.repo.patch(address, { forwardPid: null, forwardPort: null });
    }
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
      api: machineApi(port, session.cookie),
      loadLocal: (projectId) => this.#localModels(projectId),
      projects,
    });
    if (outcome.kind === "failed") {
      say(`Models not synced — ${outcome.detail}`);
      return;
    }
    if (outcome.created.length > 0) say(`Created there: ${outcome.created.join(", ")}.`);
    if (outcome.projects.length > 0) say(`Models synced: ${outcome.projects.join(", ")}.`);
    void address;
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

  /** Hands a machine this server's pushed build, over the forward held to it. */
  async #handOverBuild(
    address: string,
    target: RemoteTarget,
    say: (line: string) => void,
  ): Promise<UpgradeOutcome> {
    const probed = await this.#effects.probe(target, this.#layout, this.#effects.runOn);
    if (probed.state.kind === "unreachable") {
      return { kind: "failed", step: "reach", detail: probed.state.detail };
    }
    // A hot swap replaces the code a RUNNING server is serving; with none there is nothing
    // to swap, and nothing wrong either — its disk already holds what it will next load.
    if (probed.state.kind !== "running") return { kind: "no-server" };
    const forward = await this.#forward(address, target, probed.state.port);
    if (!forward.ok) return { kind: "failed", step: "reach", detail: forward.detail };
    const session = await this.#sessionOn(target);
    if (!("cookie" in session)) return { kind: "failed", step: "sign in", detail: session.detail };
    return this.#effects.upgrade({
      port: forward.port,
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
    const before = await this.#effects.probe(target, this.#layout, this.#effects.runOn);
    if (before.state.kind === "unreachable") return { ok: false, detail: before.state.detail };
    if (before.state.kind !== "running") {
      return { ok: false, detail: "no server is running on that machine." };
    }
    const port = before.state.port;
    say(`Stopping its server on port ${port}…`);
    const stopped = await this.#effects.stopServer(target);
    if (!stopped.ok) return { ok: false, detail: `it would not stop — ${stopped.detail}` };
    // Its sessions died with it, and the forward points at a port nothing holds any more.
    this.#sessions.delete(address);
    closeForward(address, this.repo.get(address)?.forwardPid);
    this.repo.patch(address, { forwardPid: null, forwardPort: null });
    say(`Starting it again on port ${port}…`);
    const started = await this.#effects.startServer(target, port);
    if (!started.ok) {
      return { ok: false, detail: `its server did not come back up: ${started.detail}` };
    }
    // It is a different process now, and possibly one with an identity it did not have a
    // moment ago: a machine mints its id when a server that mints one starts there.
    await this.#refreshStatus(address, target);
    // And it is reachable again. The forward was pointed at a process that no longer exists,
    // so stopping dropped it; raising a new one is what leaves the machine as reachable as
    // the restart found it. Without this a restart is a quiet disconnect: the proxy answers
    // 503 for every call to that machine until somebody presses Connect, and the pages that
    // merge its Sessions and Agents read that as a machine that is not there.
    const forward = await this.#forward(address, target, port);
    if (!forward.ok) {
      say(`It is up on port ${port}, but could not be reached from here: ${forward.detail}`);
    }
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
      const target = await this.#targetOf(machine.alias);
      if (target === null) {
        return { ok: false, step: "restart", message: "ssh could not resolve that host." };
      }
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
  ): Promise<void> {
    const before = await this.#effects.probe(target, this.#layout, this.#effects.runOn);
    if (before.state.kind !== "running") {
      say("Its server was not running; the new build will be used when it next starts.");
      return;
    }
    const done = await this.#restartServer(address, target, say);
    say(done.ok ? `Restarted on port ${done.port}.` : `Installed, but ${done.detail}`);
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
        const target = await this.#targetOf(address.slice("ssh:".length));
        if (target === null) continue;
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
      if (outcome.kind === "upgraded") {
        this.repo.patch(address, {
          version: plan.version,
          installedAt: this.#effects.now().toISOString(),
        });
      }
    });
  }

  /** Raises a forward to every installed machine that has none, starting its server if it is down. */
  async autoConnect(): Promise<void> {
    const unconnected = this.#allMachines().filter(
      (m) => !m.local && m.installed !== null && !m.connected,
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
  async syncConnectedModels(): Promise<void> {
    const connected = this.#allMachines().filter((m) => !m.local && m.connected);
    await this.#sweep(
      connected.map((m) => m.id),
      async (address, target) => {
        const port = this.#livePort(address);
        if (port !== null) {
          await this.#syncModels(address, target, port, () => {}, this.#projectsUsing(address));
        }
      },
    );
  }

  /** Pushes a Project's models to every connected machine it uses — a key rotated here reaches them at once. */
  async syncModelsEverywhere(projectId: string): Promise<void> {
    const connected = this.list(projectId).filter(
      (m) => !m.local && m.installed !== null && m.connected,
    );
    await this.#sweep(
      connected.map((m) => m.id),
      async (address, target) => {
        const port = this.#livePort(address);
        if (port !== null) await this.#syncModels(address, target, port, () => {}, [projectId]);
      },
    );
  }
}

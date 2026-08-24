/**
 * The machines service: this server's own `~/.ssh/config` as a list of targets, and putting
 * this build on one of them.
 *
 * An install is a JOB, not a request. It probes the far side, has it download and install
 * this server's base release, and streams the hmr state across — minutes, in the bad case —
 * so POST starts it and the Web App polls for the progress lines. One at a time: the
 * surface is a person installing on one machine.
 *
 * The JOB is not persisted. It lives in this App's memory and dies with it (see the park
 * list in ../hmr/platform.ts — it is on the SUSPENDED side): a hot push during an install
 * loses the progress log, and the recovery is to run it again, which is safe because every
 * step is idempotent — the far side's installer stages, smoke-tests and swaps, and an
 * unchanged version is a no-op.
 *
 * The RESULT is. Which machines carry this program is not a property of the last job — it
 * has to outlive the job, the process and the next install somewhere else — so a successful
 * install is written to `<data root>/machines-installs.json` (installs.ts) and read back
 * into every list(). Without it "installed" would blink out the moment anything else
 * happened, which is exactly what it did before this file wrote anything down.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_PROJECT_ID, VERSION, loadProjectConfig } from "@prismshadow/penguin-core";
import type { ProjectConfig } from "@prismshadow/penguin-core";
import type {
  MachineConnectFailure,
  MachineConnectJob,
  MachineInfo,
  MachineInstallJob,
  MachineServerStatus,
} from "../api/types.js";
import { readServerLock } from "../lock.js";
import { SESSION_COOKIE } from "../auth/middleware.js";
import { listHostAliases, resolveTarget } from "./targets.js";
import { sshArgs } from "./commands.js";
import { run } from "./exec.js";
import type { ExecResult } from "./exec.js";
import { installOnRemote, resolvePushPlan } from "./install-server.js";
import { parseInstallRecords, withInstallRecord } from "./installs.js";
import { parseMembers, withMember } from "./membership.js";
import { fingerprintLocal, parseModelSyncState, withModelSyncState } from "./models-sync-state.js";
import type { InstallRecord } from "./installs.js";
import { probeServerState } from "./server-state.js";
import { DIR_LIST_MARK, listDirsCommand } from "./commands.js";
import { upgradeRemote } from "./upgrade.js";
import { signInOnRemote } from "./signin.js";
import { mintTokenOnRemote } from "./remote-token.js";
import { closeShell, runOnShell } from "./ssh-session.js";
import { machineApi, syncModelsToMachine } from "./models-sync.js";
import type { LocalModels } from "./models-sync.js";
import { readOrCreateMachineId } from "./machine-id.js";
import { localPortBusy, openTunnel, waitForTunneledHttp } from "./tunnel.js";
import type { Tunnel } from "./tunnel.js";
import { startRemoteServer, stopRemoteServer } from "./server-control.js";
import { parseConnectState, pickTunnelPort, withConnectState } from "./connect-state.js";
import type { ConnectState } from "./connect-state.js";
import type { SignInOutcome } from "./signin.js";

/** Why a start was refused before any ssh ran. */
export type InstallRefusal = "busy" | "unknown-machine" | "unresolvable" | "no-image" | "self";

/**
 * The three things this service does to the world, injectable as a set. Production passes
 * none of them; tests pass all three, because the real ones read the developer's own
 * ~/.ssh/config and spawn ssh against whatever it names. The push path itself is covered
 * where it belongs — machines-push.test.ts drives the real installOnRemote against a fake
 * ssh binary — so what is faked here is only the reaching-out, never the logic under test.
 */
export interface MachinesEffects {
  listAliases: typeof listHostAliases;
  resolveTarget: typeof resolveTarget;
  resolvePlan: typeof resolvePushPlan;
  install: typeof installOnRemote;
  probe: typeof probeServerState;
  /** One command on a machine — the seam the directory browser and any future reader share. */
  runOn: (target: { alias: string; user: string }, command: string) => Promise<ExecResult>;
  startServer: typeof startRemoteServer;
  stopServer: typeof stopRemoteServer;
  upgrade: typeof upgradeRemote;
  signIn: typeof signInOnRemote;
  /** This server's own Project config, credentials in plaintext — the source of a model sync. */
  loadConfig: (projectId: string) => Promise<ProjectConfig>;
  openTunnel: typeof openTunnel;
  portBusy: typeof localPortBusy;
  waitForHttp: typeof waitForTunneledHttp;
  /** Injected so a test can pin the recorded timestamp instead of asserting around the clock. */
  now: () => Date;
}

/** The id of the entry standing for the machine this server runs on. */
export const LOCAL_MACHINE_ID = "local";

/** True when a pid names a process this account can see (EPERM still means it is there). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * How many machines are probed at once. A probe is an ssh child; someone with fifty
 * installed machines should not have fifty of them spawned in one breath, and the page is
 * waiting on the slowest one anyway.
 */
const PROBE_CONCURRENCY = 5;

export class MachinesService {
  #job: MachineInstallJob | null = null;
  /**
   * Last probe per machine id. In memory on purpose: a status is only true for the moment it
   * was taken, so carrying it across a restart would be reporting a fact nobody checked.
   */
  readonly #statuses = new Map<string, MachineServerStatus>();
  /**
   * Tunnels this App spawned, by machine address. The ssh CHILD is the durable thing (it
   * outlives a hot swap); this map is only the current App's grip on it, and the state file
   * is what a successor reads to find one it did not spawn.
   */
  readonly #tunnels = new Map<string, Tunnel>();
  /**
   * Machines with a heavy ssh operation in flight — an install, or the automatic sync.
   *
   * Both copy tens of megabytes over the same connection, and running them at once against
   * one host is how a 30-second command ends up timing out with nothing to say. This exists
   * because the automatic sync fires on every App boot: without it, a push landing while
   * someone was installing had two transfers racing for one machine, and the loser reported
   * a refusal it never received.
   *
   * Deliberately NOT taken by the probe or the directory browser: those are single short
   * commands, and making a picker wait behind a 30 MB transfer would be its own bug.
   */
  readonly #busy = new Set<string>();
  #connect: MachineConnectJob | null = null;
  readonly #effects: MachinesEffects;

  /**
   * `dataRoot` is the server's own data root: it holds the hmr state a push replicates, and
   * the install records below.
   */
  /** Where a pushed bundle's assets were unpacked; null in a packaged server (hmr.assetsDir). */
  readonly #assets: () => string | null;
  /**
   * This machine's id, minted when the App boots rather than when someone first asks.
   *
   * At construction on purpose, and NOT at server start: a server that is up is a machine
   * that has an identity — anything reaching it may ask before a single request has been
   * served — but "mint it at startup" would be a RUNTIME change, and a runtime change does
   * not exist for a deployment until it is rebuilt and redeployed. Every App boot runs
   * this, including a hot-pushed one, so the identity arrives with the push that needs it.
   *
   * Idempotent: an id already on disk is adopted, never replaced.
   */
  readonly #machineId: string;

  constructor(
    private readonly dataRoot: string,
    effects: Partial<MachinesEffects> = {},
    assets: () => string | null = () => null,
  ) {
    this.#assets = assets;
    this.#machineId = readOrCreateMachineId(dataRoot);
    this.#effects = {
      listAliases: listHostAliases,
      resolveTarget,
      resolvePlan: resolvePushPlan,
      install: installOnRemote,
      probe: probeServerState,
      // Over the machine's SHARED shell, not a fresh connection: a probe every few minutes
      // and a directory listing per click should not each pay for a handshake. Merged
      // streams are fine for both — their own markers delimit what matters, and failure is
      // read from the exit code (see ssh-session.ts).
      runOn: async (target, command) => {
        const result = await runOnShell(`ssh:${target.alias}`, target, command);
        return { code: result.code, stdout: result.output, stderr: "", timedOut: false };
      },
      startServer: startRemoteServer,
      stopServer: stopRemoteServer,
      upgrade: upgradeRemote,
      signIn: signInOnRemote,
      loadConfig: (projectId) => loadProjectConfig(dataRoot, projectId),
      openTunnel,
      portBusy: localPortBusy,
      waitForHttp: waitForTunneledHttp,
      now: () => new Date(),
      ...effects,
    };
  }

  /** Where the install records live — beside the other per-machine state in the data root. */
  get #recordsFile(): string {
    return path.join(this.dataRoot, "machines-installs.json");
  }

  /** The records file's text, or null when there is none yet (or it cannot be read). */
  #readRecords(): string | null {
    try {
      return fs.readFileSync(this.#recordsFile, "utf8");
    } catch {
      return null; // Never installed from this server yet, or an unreadable file: nothing remembered.
    }
  }

  /** Where a Project's machine list lives — beside that Project's own config. */
  #membersFile(projectId: string): string {
    return path.join(this.dataRoot, projectId, "machines.json");
  }

  /**
   * The addresses a Project uses.
   *
   * A file that is ABSENT is not the same as one holding an empty list. Machines were a
   * property of the server before they were a property of a Project, so the first read for
   * the default Project adopts what this server already had — the machines you installed
   * keep working, in the Project your admin account already works in. An empty file means
   * somebody emptied it, and is left exactly as they left it.
   */
  #members(projectId: string): string[] {
    let raw: string | null;
    try {
      raw = fs.readFileSync(this.#membersFile(projectId), "utf8");
    } catch {
      raw = null;
    }
    if (raw !== null) return parseMembers(raw);
    if (projectId !== DEFAULT_PROJECT_ID) return [];
    return Object.keys(parseInstallRecords(this.#readRecords()));
  }

  /** Adds or removes one address from a Project's list. */
  #setMember(projectId: string, address: string, member: boolean): void {
    const file = this.#membersFile(projectId);
    // Seeded first: writing straight to an absent file would drop the machines the default
    // Project inherits, since withMember would start from nothing.
    const current = JSON.stringify({ machines: this.#members(projectId) });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, withMember(current, address, member));
  }

  /**
   * This machine, first: always installed (it is running), always up (it is answering), and
   * never a target — a server does not push itself onto its own machine. Its version and
   * port are read directly rather than probed, since both are right here.
   */
  #localMachine(): MachineInfo {
    const lock = readServerLock(this.dataRoot);
    return {
      id: LOCAL_MACHINE_ID,
      alias: os.hostname(),
      // Our own id comes from the same file a remote's does — this server IS the server
      // that mints it here, so there is nothing to probe.
      machineId: this.#machineId,
      // No tunnel to where you already are: this server IS the origin serving the page.
      origin: null,
      installed: { version: VERSION, at: lock?.startedAt ?? this.#effects.now().toISOString() },
      local: true,
      status: {
        state: "running",
        checkedAt: this.#effects.now().toISOString(),
        ...(lock === null ? {} : { port: lock.port }),
      },
    };
  }

  /**
   * This machine, then the ssh config's host aliases, each carrying what this server last
   * installed there and the last status probed for it. An empty or missing config is not an
   * error — it just leaves the local entry alone in the list.
   */
  #allMachines(): MachineInfo[] {
    const records = parseInstallRecords(this.#readRecords());
    const remotes = this.#effects.listAliases().map((alias): MachineInfo => {
      const id = `ssh:${alias}`;
      const record = records[id] ?? null;
      const port = this.tunnelPortFor(id);
      return {
        id,
        alias,
        machineId: record?.machineId ?? null,
        installed: record,
        local: false,
        origin: port === null ? null : `http://localhost:${port}`,
        status: this.#statuses.get(id) ?? null,
      };
    });
    return [this.#localMachine(), ...remotes];
  }

  /**
   * The same machines as this server knows, answered for one Project: `installed` means
   * installed FOR THIS PROJECT.
   *
   * A host this server has installed but that this Project does not use is reported through
   * `elsewhere` rather than as a blank row. The difference is the whole reason the split
   * exists — one is a machine to install on, the other is a machine to adopt, and a page that
   * showed them identically would send someone to spend 30 MB on a line of JSON.
   */
  list(projectId: string): MachineInfo[] {
    const members = new Set(this.#members(projectId));
    return this.#allMachines().map((machine) => {
      if (machine.local) return machine;
      const mine = members.has(machine.id);
      return {
        ...machine,
        installed: mine ? machine.installed : null,
        // Absent, not null, when there is nothing to say: every row would otherwise carry a
        // field about a state it is not in.
        ...(!mine && machine.installed !== null ? { elsewhere: machine.installed } : {}),
      };
    });
  }

  /**
   * Takes a machine this server already installed into a Project, without reinstalling it.
   *
   * The program on that host is the same program: what a second Project lacks is the line
   * saying it uses it. Sending 30 MB over ssh to write that line would be a transfer that
   * changes nothing on the far side.
   */
  adopt(projectId: string, address: string): boolean {
    const record = parseInstallRecords(this.#readRecords())[address];
    if (record === undefined) return false; // Nothing installed there: this is an install, not an adoption.
    this.#setMember(projectId, address, true);
    return true;
  }

  /** Drops a machine from a Project. The program stays installed; only the membership goes. */
  release(projectId: string, address: string): void {
    this.#setMember(projectId, address, false);
  }

  /** Where the "what did we last send there" prints live, beside the other machine state. */
  get #syncStateFile(): string {
    return path.join(this.dataRoot, "machines-models-sync.json");
  }

  #readSyncState(): string | null {
    try {
      return fs.readFileSync(this.#syncStateFile, "utf8");
    } catch {
      return null;
    }
  }

  /** Writes down what a machine now has, so an unchanged config costs nothing next boot. */
  async #rememberSynced(address: string, projects: string[]): Promise<void> {
    if (projects.length === 0) return;
    const prints: Record<string, string> = {};
    for (const projectId of projects) {
      const local = await this.#localModels(projectId);
      if (local !== null) prints[projectId] = fingerprintLocal(local);
    }
    try {
      fs.writeFileSync(
        this.#syncStateFile,
        withModelSyncState(this.#readSyncState(), address, prints),
      );
    } catch {
      // Unwritable: the next boot syncs again, which is wasteful but correct. Losing the
      // ability to sync over losing the ability to remember would be the wrong trade.
    }
  }

  /**
   * Whether anything this side holds for that machine has changed since it last received it.
   *
   * Answered from local disk alone, on purpose: signing in on a machine costs a connection
   * and an scp, and a boot happens on every hot push. Spending that to discover there was
   * nothing to do is the cost this exists to avoid.
   */
  async #needsModelSync(address: string, projects: string[]): Promise<boolean> {
    const sent = parseModelSyncState(this.#readSyncState())[address] ?? {};
    for (const projectId of projects) {
      const local = await this.#localModels(projectId);
      if (local === null || local.models.length === 0) continue;
      if (sent[projectId] !== fingerprintLocal(local)) return true;
    }
    return false;
  }

  /**
   * Brings every already-connected machine up to date with this server's Model config.
   *
   * Called when an App boots, which is what a hot push produces — the same hook syncOutOfDate
   * uses, and for the same reason. Connecting is what used to carry credentials across, and a
   * tunnel deliberately outlives a push, so a machine connected before a key was added here
   * would never have received it: autoConnect skips it (it already has a tunnel), and nothing
   * else asked. That is invisible from the page, since the machine looks connected and well
   * the entire time.
   *
   * Machines whose fingerprints all match are skipped before any ssh happens.
   */
  async syncConnectedModels(): Promise<void> {
    const connected = this.#allMachines().filter(
      (machine) => !machine.local && this.tunnelPortFor(machine.id) !== null,
    );
    for (const machine of connected) {
      const port = this.tunnelPortFor(machine.id);
      if (port === null) continue; // Dropped while we were working through the list.
      const projects = this.projectsUsing(machine.id);
      if (projects.length === 0) continue;
      if (!(await this.#needsModelSync(machine.id, projects))) continue;
      const resolved = await this.#effects.resolveTarget(machine.alias);
      if (resolved === null) continue;
      // Silent: nobody asked for this, and there is no job log to write to. A failure here is
      // the same failure the next connect reports, on the row, where it can be seen.
      await this.#syncModels(
        machine.id,
        { alias: machine.alias, user: resolved.settings.user },
        port,
        () => undefined,
        projects,
      );
    }
  }

  /** Every Project on this server that uses a given machine — who its credentials belong to. */
  projectsUsing(address: string): string[] {
    let dirs: string[] = [];
    try {
      dirs = fs
        .readdirSync(this.dataRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      dirs = []; // Unreadable data root: fall through to the default Project alone.
    }
    // The default Project is always a candidate, directory or not: every server seeds it, and
    // it is the one that INHERITS this server's pre-Project machines (see #members). Deciding
    // entitlement from directories alone would miss exactly the machines that were installed
    // before machines belonged to Projects at all.
    const candidates = dirs.includes(DEFAULT_PROJECT_ID) ? dirs : [...dirs, DEFAULT_PROJECT_ID];
    return candidates.filter((projectId) => this.#members(projectId).includes(address));
  }

  /**
   * The subdirectories of `dir` on a machine, over ssh.
   *
   * Over SSH rather than through the tunnel and that machine's API, because picking a
   * workspace must not require signing in to another server. ssh is already the trust
   * relationship — this server installed the program there — and the browsing is the local
   * admin's, authenticated by the local session like the rest of this surface. Asking the
   * remote's HTTP API instead would 401 until the person logged in over there, which is a
   * second login for a directory listing.
   */
  async listDirs(
    machineId: string,
    dir: string,
  ): Promise<{
    path: string;
    parent: string | null;
    entries: { name: string; path: string }[];
  } | null> {
    const machine = this.#allMachines().find(
      (entry) => entry.machineId === machineId && !entry.local,
    );
    if (machine === undefined) return null;
    const resolved = await this.#effects.resolveTarget(machine.alias);
    if (resolved === null) return null;
    const result = await this.#effects.runOn(
      { alias: machine.alias, user: resolved.settings.user },
      listDirsCommand(dir),
    );
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
   * the ssh config can declare hundreds of hosts, and a host nothing was ever installed on
   * has no server to ask about. The local entry needs no probe — it answers by existing.
   *
   * Failures are states, not errors (see server-state.ts), so this always resolves and
   * always leaves every probed machine with an answer.
   */
  async probeInstalled(projectId: string): Promise<void> {
    const targets = this.list(projectId).filter(
      (machine) => !machine.local && machine.installed !== null,
    );
    const queue = [...targets];
    const workers = Array.from({ length: Math.min(PROBE_CONCURRENCY, queue.length) }, async () => {
      for (let machine = queue.shift(); machine !== undefined; machine = queue.shift()) {
        const resolved = await this.#effects.resolveTarget(machine.alias);
        const checkedAt = this.#effects.now().toISOString();
        if (resolved === null) {
          // ssh itself cannot name the host any more — the alias is in the config but
          // unresolvable, which is the same dead end as a refused connection.
          this.#statuses.set(machine.id, {
            state: "unreachable",
            checkedAt,
            detail: "ssh could not resolve that host.",
          });
          continue;
        }
        const probe = await this.#effects.probe(
          { alias: machine.alias, user: resolved.settings.user },
          (target, command) => this.#effects.runOn(target, command),
        );
        const state = probe.state;
        this.#statuses.set(machine.id, {
          state: state.kind,
          checkedAt,
          ...(state.kind === "running" ? { port: state.port } : {}),
          ...(state.kind === "unreachable" ? { detail: state.detail } : {}),
        });
        // A machine that just told us who it is: write it down, so the identity outlives
        // this process without another round trip. An id NEVER changes for a machine, so a
        // probe that answers a different one means a different machine behind that alias —
        // the alias was repointed — and the newer answer is the true one.
        this.#rememberMachineId(machine.id, probe.machineId);
      }
    });
    await Promise.all(workers);
  }

  /**
   * The version this server would install, or null when it has no image to push — a dev
   * checkout that has never been pushed to is the one shape with none. The page asks for it
   * so it can say so up front, rather than letting every install fail at the same step.
   */
  imageVersion(): string | null {
    return this.#effects.resolvePlan(this.dataRoot)?.version ?? null;
  }

  /** The running or last install job; null before the first one. */
  job(): MachineInstallJob | null {
    return this.#job;
  }

  /** The running or last connect; null before the first one. */
  connectJob(): MachineConnectJob | null {
    return this.#connect;
  }

  /** Where the tunnel ports and pids live — beside the install records in the data root. */
  get #connectFile(): string {
    return path.join(this.dataRoot, "machines-connect.json");
  }

  #readConnectState(): string | null {
    try {
      return fs.readFileSync(this.#connectFile, "utf8");
    } catch {
      return null;
    }
  }

  #writeConnectState(machineId: string, state: ConnectState | null): void {
    const next = withConnectState(this.#readConnectState(), machineId, state);
    const tmp = `${this.#connectFile}.tmp-${process.pid}`;
    try {
      fs.mkdirSync(path.dirname(this.#connectFile), { recursive: true });
      fs.writeFileSync(tmp, next);
      fs.renameSync(tmp, this.#connectFile);
    } catch {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* the temp file is litter at worst */
      }
    }
  }

  /**
   * The port a machine's tunnel is live on, or null. "Live" is checked against the PROCESS,
   * not the file: a recorded pid that is gone is stale state, and answering with its port
   * would send the proxy at a number nothing is forwarding.
   *
   * This is also how a hot-swapped or restarted platform adopts a tunnel it never spawned —
   * the ssh child is a separate process and kept forwarding while we were replaced.
   */
  tunnelPortFor(machineId: string): number | null {
    const entry = parseConnectState(this.#readConnectState())[machineId];
    if (entry?.tunnelPid === undefined) return null;
    if (!pidAlive(entry.tunnelPid)) {
      this.#writeConnectState(machineId, { ...entry, tunnelPid: undefined });
      return null;
    }
    return entry.port;
  }

  /**
   * Starts an install, refusing rather than queueing. The refusals that can be decided here —
   * a job already running, an alias this config does not declare, an ssh that cannot resolve
   * it, no image to send — are answered synchronously, so the page distinguishes "did not
   * start" from "started and failed" without reading the log.
   */
  async startInstall(
    projectId: string,
    machineId: string,
  ): Promise<{ ok: true } | { ok: false; why: InstallRefusal }> {
    if (this.#job?.running === true) return { ok: false, why: "busy" };

    const machine = this.#allMachines().find((entry) => entry.id === machineId);
    if (machine === undefined) return { ok: false, why: "unknown-machine" };
    // The local entry is a view of this very process, not a target: installing would push
    // this build over its own program directory while running from it.
    if (machine.local) return { ok: false, why: "self" };

    const plan = this.#effects.resolvePlan(this.dataRoot);
    if (plan === null) return { ok: false, why: "no-image" };

    const resolved = await this.#effects.resolveTarget(machine.alias);
    if (resolved === null) return { ok: false, why: "unresolvable" };

    const job: MachineInstallJob = {
      machineId,
      alias: machine.alias,
      running: true,
      log: [],
      result: null,
    };
    this.#job = job;

    const say = (line: string) => {
      job.log.push(line);
    };
    // Deliberately not awaited: the caller is an HTTP handler answering 202. Failures land
    // in the job's own result — the catch below is the last resort for a throw the install
    // path does not turn into a `failed` outcome itself.
    void (async () => {
      try {
        this.#busy.add(machineId);
        say(`Installing ${plan.version} on ${resolved.machine}…`);
        // No identity passed: installOnRemote runs the probe itself as its first step and
        // narrates it, so the page shows what the machine turned out to be.
        const outcome = await this.#effects.install({
          target: { alias: machine.alias, user: resolved.settings.user },
          plan,
          onProgress: say,
          assets: this.#assets,
        });
        if (outcome.kind === "failed") {
          job.result = { ok: false, step: outcome.step, message: outcome.detail };
          return;
        }
        const version = outcome.kind === "already-installed" ? outcome.version : plan.version;
        // Installing replaced the program ON DISK; the process over there is still running
        // the code it loaded at start. Without this the machine reports the new version and
        // behaves like the old one, which is the worst of both — so a machine whose server
        // was up is restarted onto what was just installed.
        if (outcome.kind === "installed")
          await this.#restartAfterInstall(machine.alias, resolved.settings.user, say);
        // Remember it BEFORE the job settles, so the first poll that sees `running: false`
        // already sees the machine marked installed — otherwise the page would flash the
        // verdict and a still-uninstalled row in the same frame.
        this.#remember(machineId, { version, at: this.#effects.now().toISOString() });
        // The Project that asked for the install is the Project that gets the machine. Written
        // in the same breath as the record: a machine installed but belonging to nobody would
        // read as "installed elsewhere" on the very page that just installed it.
        this.#setMember(projectId, machineId, true);
        job.result = { ok: true, kind: outcome.kind, version };
      } catch (err) {
        job.result = {
          ok: false,
          step: "install",
          message: err instanceof Error ? err.message : String(err),
        };
      } finally {
        this.#busy.delete(machineId);
        job.running = false;
      }
    })();

    return { ok: true };
  }

  /**
   * The live tunnel port for a machine addressed by its OWN id — what the proxy asks.
   *
   * A machine is looked up by identity rather than by the alias it happens to be reached
   * through, so a re-aliased host keeps working and two aliases for one machine resolve to
   * the one tunnel instead of two.
   */
  tunnelPortForMachine(machineId: string): number | null {
    for (const [address, entry] of Object.entries(parseConnectState(this.#readConnectState()))) {
      if (entry.machineId !== machineId) continue;
      // Liveness goes through the same address-keyed check, so a dead pid is cleared here
      // exactly as it is anywhere else.
      const port = this.tunnelPortFor(address);
      if (port !== null) return port;
    }
    return null;
  }

  /**
   * Brings a machine's server up and holds a tunnel to it, as a job — the same shape as an
   * install and for the same reason (a start plus a readiness wait is minutes in the bad
   * case), in its own slot so connecting somewhere cannot cancel an install elsewhere.
   *
   * The steps are: refuse the obvious dead ends, adopt a tunnel that is already live, pick a
   * port, start the server over there if nothing is serving, open the tunnel, and wait for
   * an HTTP answer THROUGH it. Every one is idempotent, so a repeat is safe.
   */
  async startConnect(
    machineId: string,
  ): Promise<
    { ok: true } | { ok: false; why: MachineConnectFailure | "busy" | "unknown-machine" }
  > {
    if (this.#connect?.running === true) return { ok: false, why: "busy" };

    const machine = this.#allMachines().find((entry) => entry.id === machineId);
    if (machine === undefined) return { ok: false, why: "unknown-machine" };
    // Connecting to where you already are is a no-op with a failure mode: the tunnel would
    // forward a port to itself. The machine's own id is what settles it — the same file read
    // over ssh IS our file when the alias points back here.
    if (machine.local || (machine.machineId !== null && machine.machineId === this.#machineId)) {
      return { ok: false, why: "self" };
    }
    if (machine.installed === null) return { ok: false, why: "not-installed" };

    const job: MachineConnectJob = {
      machineId,
      alias: machine.alias,
      running: true,
      log: [],
      result: null,
    };
    this.#connect = job;
    const say = (line: string) => {
      job.log.push(line);
    };

    void (async () => {
      try {
        await this.#runConnect(machine.id, machine.alias, say, job);
      } catch (err) {
        job.result = { ok: false, message: err instanceof Error ? err.message : String(err) };
      } finally {
        job.running = false;
      }
    })();
    return { ok: true };
  }

  async #runConnect(
    id: string,
    alias: string,
    say: (line: string) => void,
    job: MachineConnectJob,
  ): Promise<void> {
    // Already connected: adopting costs nothing and re-tunnelling would fight for the port.
    const live = this.tunnelPortFor(id);
    if (live !== null) {
      say(`Already connected on port ${live}.`);
      // Still synced: connecting again is how someone retries after a sync that failed (or
      // after adding a model here), and re-declaring a live tunnel would be all this did.
      const known = await this.#effects.resolveTarget(alias);
      if (known !== null) {
        await this.#syncModels(
          id,
          { alias, user: known.settings.user },
          live,
          say,
          this.projectsUsing(id),
        );
      }
      job.result = { ok: true, origin: `http://localhost:${live}` };
      return;
    }

    const resolved = await this.#effects.resolveTarget(alias);
    if (resolved === null) {
      job.result = { ok: false, message: "ssh could not resolve that host." };
      return;
    }
    const target = { alias, user: resolved.settings.user };

    say("Asking what is running there…");
    const probed = await this.#effects.probe(target);
    const state = probed.state;
    if (state.kind === "unreachable") {
      job.result = { ok: false, message: state.detail };
      return;
    }
    let machineId = probed.machineId;
    this.#rememberMachineId(id, machineId);

    const remembered = parseConnectState(this.#readConnectState())[id];
    // A server already up over there keeps its port — it is bound to it, and we forward the
    // same number on both ends. Otherwise pick one that is free HERE and start it there.
    const port =
      state.kind === "running"
        ? state.port
        : await pickTunnelPort({
            remembered: remembered?.port,
            busy: (candidate) => this.#effects.portBusy(candidate),
          });
    if (port === null) {
      job.result = {
        ok: false,
        code: "port-conflict",
        message: "No free local port to forward on.",
      };
      return;
    }
    if (state.kind === "running") {
      say(`Its server is already up on port ${port}.`);
    } else {
      say(`Starting its server on port ${port}…`);
      const started = await this.#effects.startServer(target, port);
      if (!started.ok) {
        job.result = { ok: false, message: started.detail };
        return;
      }
      // Ask again now that it is up: a machine mints its id when its server starts, so one
      // that was down had none a moment ago — and the proxy addresses it by that id.
      machineId = (await this.#effects.probe(target)).machineId ?? machineId;
      this.#rememberMachineId(id, machineId);
    }

    say("Opening the tunnel…");
    const tunnel = this.#effects.openTunnel({
      target,
      port,
      onExit: () => {
        // Not restarted here: a dropped link or a rebooted machine is exactly what the
        // person needs to see, and a silent reconnect would hide it.
        this.#tunnels.delete(id);
        const entry = parseConnectState(this.#readConnectState())[id];
        if (entry !== undefined) this.#writeConnectState(id, { ...entry, tunnelPid: undefined });
      },
    });
    this.#tunnels.set(id, tunnel);
    this.#writeConnectState(id, {
      port,
      ...(machineId === null ? {} : { machineId }),
      ...(tunnel.pid === null ? {} : { tunnelPid: tunnel.pid }),
      connectedAt: this.#effects.now().toISOString(),
    });

    const origin = `http://localhost:${port}`;
    const ready = await this.#effects.waitForHttp(origin, () => tunnel.exited());
    if (!ready.ok) {
      tunnel.close();
      this.#tunnels.delete(id);
      this.#writeConnectState(id, { port });
      const said = tunnel.stderr().trim();
      job.result = { ok: false, message: said === "" ? ready.detail : said };
      return;
    }
    say(`Connected on ${origin}.`);
    // Before declaring it ready: an Agent started over there resolves its model against THAT
    // machine's config, so a machine without our credentials is connected and unusable.
    await this.#syncModels(id, target, port, say, this.projectsUsing(id));
    job.result = { ok: true, origin };
  }

  /**
   * Hands a machine the Model credentials an Agent over there needs to run at all.
   *
   * Failure is reported, never fatal: a machine whose seeded admin password was changed
   * cannot be signed into from here (machines/signin.ts), and that is a machine you can
   * still connect to, browse and read — just not one this side can configure. Saying so on
   * the row beats a connect that fails for a reason nobody can see.
   */
  async #syncModels(
    address: string,
    target: { alias: string; user: string },
    port: number,
    say: (line: string) => void,
    projects: string[],
  ): Promise<void> {
    // Nothing here uses this machine, so nothing here has credentials to put on it. Said out
    // loud rather than skipped in silence: on a connect, "no models synced" with no reason is
    // exactly the state that sends someone hunting through logs.
    if (projects.length === 0) {
      say("No models synced — no Project on this server uses that machine.");
      return;
    }
    const cookie = await this.#sessionOn(target, say);
    if (cookie === null) return;
    const outcome = await syncModelsToMachine({
      api: machineApi(port, cookie),
      loadLocal: (projectId) => this.#localModels(projectId),
      projects,
    });
    if (outcome.kind === "failed") {
      say(`Models not synced — ${outcome.detail}`);
      return;
    }
    // Recorded only for what actually landed: a Project that failed must be retried, and a
    // fingerprint written for it would say the machine has something it does not.
    await this.#rememberSynced(address, outcome.projects);
    // Creating a Project on somebody's machine is a thing done TO that machine, so it is
    // named rather than folded into the count.
    if (outcome.created.length > 0) say(`Created there: ${outcome.created.join(", ")}.`);
    if (outcome.projects.length > 0) say(`Models synced: ${outcome.projects.join(", ")}.`);
  }

  /**
   * A Cookie header for that machine's API, or null with the reason already said.
   *
   * The machine's own CLI first: it mints a short-lived token from the data root the ssh
   * account owns, which needs no password and therefore keeps working on a machine whose
   * admin password was set by a person. One command over the shared connection, where the
   * fallback needs a scratch directory and two scp'd files.
   *
   * The seeded-password path stays for machines carrying a build older than that command.
   */
  async #sessionOn(
    target: { alias: string; user: string },
    say: (line: string) => void,
  ): Promise<string | null> {
    const minted = await mintTokenOnRemote(target, (t, command) => this.#effects.runOn(t, command));
    if (minted.kind === "minted") return `${SESSION_COOKIE}=${minted.token}`;
    if (minted.kind === "failed") {
      say(`Models not synced — ${minted.detail}`);
      return null;
    }
    const signedIn = await this.#effects.signIn({ target });
    if (signedIn.kind !== "signed-in") {
      // Both ways refused. The token one is the actionable half — the machine is carrying a
      // build too old to mint one — so it is the one said out loud alongside.
      say(
        `Models not synced — ${signedIn.detail} (and it could not mint a token: ${minted.detail})`,
      );
      return null;
    }
    // Set-Cookie lines reduced to the name=value pairs a request carries.
    return signedIn.setCookie.map((line) => line.split(";")[0]?.trim() ?? "").join("; ");
  }

  /**
   * This side's model table for a Project, narrowed to the entries worth carrying: an entry
   * with an inline key or its own base URL is something the machine cannot already have.
   *
   * A bare catalog entry is skipped on purpose. Every server seeds the same presets, so
   * sending them back is at best a no-op — and when this Project has no config file at all,
   * `loadProjectConfig` answers with exactly those presets, which would otherwise rewrite a
   * machine's table on behalf of a Project nobody here has configured.
   */
  async #localModels(projectId: string): Promise<LocalModels | null> {
    let config: ProjectConfig;
    try {
      config = await this.#effects.loadConfig(projectId);
    } catch {
      return null; // Unreadable or legacy-format config: not something to push anywhere.
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

  /**
   * Puts a freshly installed build into service. Only for a machine whose server was
   * already running: one that was down is left down — starting it would be this side
   * deciding that machine should be serving, which installing software does not imply.
   *
   * A restart is not free over there: whatever that server was running stops. It is what
   * "update this machine" means, and doing it silently after an install the user asked for
   * is more honest than leaving a version number that lies about what is executing.
   */
  async #restartAfterInstall(
    alias: string,
    user: string,
    say: (line: string) => void,
  ): Promise<void> {
    const target = { alias, user };
    const before = await this.#effects.probe(target);
    if (before.state.kind !== "running") {
      say("Its server was not running; the new build will be used when it next starts.");
      return;
    }
    const port = before.state.port;
    say(`Restarting its server on port ${port} onto the new build…`);
    await this.#effects.stopServer(target, before.state.pid);
    const started = await this.#effects.startServer(target, port);
    say(
      started.ok
        ? `Restarted on port ${port}.`
        : `Installed, but its server did not come back up: ${started.detail}`,
    );
  }

  /**
   * Hands this server's build to every machine that is carrying a different one.
   *
   * Called when an App boots, which is what a hot push produces — so a push here becomes a
   * push everywhere, without anyone asking twice. A plain restart also boots an App, and
   * costs nothing: which machines are behind is decided from the install RECORDS against
   * this server's own version, so a fleet already in step is a few string comparisons and
   * no ssh at all.
   *
   * Best-effort and never awaited by boot. A machine that cannot be reached, or whose admin
   * password was changed so the far side cannot log itself in, simply stays out of sync —
   * and the Machines page already says so, with Update as the way to force it the slow way.
   */
  /**
   * Opens a tunnel to every installed machine that has none, quietly.
   *
   * Called when an App boots, so the machines a person installed are reachable without
   * anyone clicking Connect first — the tunnel is plumbing, and being asked to establish it
   * by hand before a machine will answer is not a decision, it is a chore.
   *
   * It reuses the same steps a manual connect takes, INCLUDING starting a server that is
   * down: a connect is exactly the decision that a machine should be serving, and making it
   * automatic without that step would leave it succeeding at nothing. What it does not do is
   * touch a machine that is already busy, or one whose server cannot be started — those stay
   * as they were and the Machines page keeps showing it.
   *
   * The connect JOB slot is deliberately untouched: this is background work, and clobbering
   * the log of a connect somebody is watching would be worse than not running at all.
   */
  async autoConnect(): Promise<void> {
    const candidates = this.#allMachines().filter(
      (machine) => !machine.local && machine.installed !== null && machine.origin === null,
    );
    const queue = [...candidates];
    const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
      for (let machine = queue.shift(); machine !== undefined; machine = queue.shift()) {
        await this.#withMachine(machine.id, async () => {
          const silent = () => {};
          try {
            await this.#runConnect(machine.id, machine.alias, silent, {
              machineId: machine.id,
              alias: machine.alias,
              running: true,
              log: [],
              result: null,
            });
          } catch {
            // Best effort: an unreachable machine stays unconnected, and the page says so.
          }
        });
      }
    });
    await Promise.all(workers);
  }

  /**
   * Mints a session on a machine and returns its Set-Cookie lines, or why it could not.
   *
   * The credential work happens over there (see signin.ts); this only names the machine and
   * hands back what it said. `null` for a machine this server does not know — the caller
   * turns that into a 404 rather than reaching for something.
   */
  async signInOn(machineId: string): Promise<SignInOutcome | null> {
    const machine = this.#allMachines().find(
      (entry) => entry.machineId === machineId && !entry.local,
    );
    if (machine === undefined) return null;
    const resolved = await this.#effects.resolveTarget(machine.alias);
    if (resolved === null) {
      return { kind: "failed", detail: "ssh could not resolve that host." };
    }
    const target = { alias: machine.alias, user: resolved.settings.user };
    // The machine's own CLI first, for the same reason the model sync prefers it: it needs no
    // password, so it still works on a machine whose admin password a person has set — which
    // is precisely the machine a browser could not otherwise be signed in to from here.
    const minted = await mintTokenOnRemote(target, (t, command) => this.#effects.runOn(t, command));
    if (minted.kind === "minted") {
      // Synthesized as the Set-Cookie that machine's own login would have sent: the caller's
      // job is to rename one into the machine's namespace, and it should not have to know
      // this one was minted rather than issued. No Secure — the browser is talking to THIS
      // origin through the proxy, not to the machine.
      return {
        kind: "signed-in",
        setCookie: [`${SESSION_COOKIE}=${minted.token}; Path=/; HttpOnly; SameSite=Lax`],
      };
    }
    if (minted.kind === "failed") return { kind: "failed", detail: minted.detail };
    return await this.#effects.signIn({ target, assets: this.#assets });
  }

  /** Runs `work` with this machine's slot held, or returns null when it is already busy. */
  async #withMachine<T>(id: string, work: () => Promise<T>): Promise<T | null> {
    if (this.#busy.has(id)) return null;
    this.#busy.add(id);
    try {
      return await work();
    } finally {
      this.#busy.delete(id);
    }
  }

  async syncOutOfDate(): Promise<void> {
    const plan = this.#effects.resolvePlan(this.dataRoot);
    if (plan === null) return; // Nothing to hand on: this server stands on no release.
    const behind = this.#allMachines().filter(
      (machine) =>
        !machine.local && machine.installed !== null && machine.installed.version !== plan.version,
    );
    if (behind.length === 0) return;

    const queue = [...behind];
    const workers = Array.from({ length: Math.min(PROBE_CONCURRENCY, queue.length) }, async () => {
      for (let machine = queue.shift(); machine !== undefined; machine = queue.shift()) {
        const resolved = await this.#effects.resolveTarget(machine.alias);
        if (resolved === null) continue;
        // Skipped rather than queued when the machine is busy: this is automatic work, and
        // the next push runs it again. A person's install must never wait behind it.
        const outcome = await this.#withMachine(machine.id, () =>
          this.#effects.upgrade({
            target: { alias: machine.alias, user: resolved.settings.user },
            dataRoot: this.dataRoot,
            assets: this.#assets,
            runOn: (t, command) => this.#effects.runOn(t, command),
          }),
        );
        if (outcome === null || outcome.kind !== "upgraded") continue;
        // It is running our build now; record that, so the next boot skips it.
        const record = parseInstallRecords(this.#readRecords())[machine.id];
        if (record !== undefined) {
          this.#remember(machine.id, {
            ...record,
            version: plan.version,
            at: this.#effects.now().toISOString(),
          });
        }
      }
    });
    await Promise.all(workers);
  }

  /**
   * Pushes a Project's models to every machine currently holding a tunnel.
   *
   * Called when the model config changes here: a key rotated on this machine is a key the
   * remote Agents are still failing with until they get it, and asking someone to reconnect
   * each machine after editing a credential is asking them to remember an invisible rule.
   *
   * Only connected machines, and only through their existing tunnel: this must not open ssh
   * connections to a hundred hosts because a text field changed. The rest catch up when they
   * next connect, which is when the credential first matters to them anyway.
   */
  async syncModelsEverywhere(projectId: string): Promise<void> {
    // This Project's machines, not every machine: the credential belongs to this Project, and
    // a machine another Project uses has no claim on it.
    const connected = this.list(projectId).filter(
      (machine) =>
        !machine.local && machine.installed !== null && this.tunnelPortFor(machine.id) !== null,
    );
    for (const machine of connected) {
      const port = this.tunnelPortFor(machine.id);
      if (port === null) continue; // Dropped while we were working through the list.
      const resolved = await this.#effects.resolveTarget(machine.alias);
      if (resolved === null) continue;
      // Silent: nobody asked for this and there is no job log to write to. A failure here
      // is the same failure the next connect reports, on the row, where it can be seen.
      await this.#syncModels(
        machine.id,
        { alias: machine.alias, user: resolved.settings.user },
        port,
        () => undefined,
        [projectId],
      );
    }
  }

  /** Records an id a probe just heard, when there is one and a record to hang it on. */
  #rememberMachineId(id: string, machineId: string | null): void {
    if (machineId === null) return;
    const record = parseInstallRecords(this.#readRecords())[id];
    if (record === undefined || record.machineId === machineId) return;
    this.#remember(id, { ...record, machineId });
  }

  /**
   * Drops a machine's tunnel. The remote server is left RUNNING: it is that machine's own
   * server, other people may be on it, and stopping it because one window looked away would
   * be this side deciding something that is not its to decide.
   */
  disconnect(machineId: string): void {
    // The shared shell goes with the tunnel: keeping a connection open to a machine somebody
    // just disconnected from would be holding on to exactly what they let go of.
    closeShell(machineId);
    this.#tunnels.get(machineId)?.close();
    this.#tunnels.delete(machineId);
    const entry = parseConnectState(this.#readConnectState())[machineId];
    if (entry !== undefined) this.#writeConnectState(machineId, { ...entry, tunnelPid: undefined });
  }

  /**
   * Hot-swap handover: let go of the ssh children WITHOUT killing them. They are delivered
   * to the successor through the state file (pid + port), so the processes must survive —
   * but this App's exit handlers must stop firing on children it no longer owns.
   */
  detachTunnels(): void {
    for (const tunnel of this.#tunnels.values()) tunnel.detach();
    this.#tunnels.clear();
  }

  /**
   * Writes one machine's record.
   *
   * Through a temp file and a rename rather than straight onto the target: a plain write
   * truncates first, so a crash mid-write leaves bytes the parser reads as "nothing
   * installed anywhere" — treating damage as empty is right for a cache, but it means a
   * torn write silently forgets every OTHER machine too, not just the one being recorded.
   * Rename is one step; a reader sees the old file or the new one.
   *
   * A failure here is swallowed: the install itself already succeeded, and the far side has
   * the program whether or not this side managed to note it down. Forgetting costs one
   * needless reinstall, which is a no-op on the remote.
   */
  #remember(machineId: string, record: InstallRecord): void {
    const next = withInstallRecord(this.#readRecords(), machineId, record);
    const tmp = `${this.#recordsFile}.tmp-${process.pid}`;
    try {
      fs.mkdirSync(path.dirname(this.#recordsFile), { recursive: true });
      fs.writeFileSync(tmp, next);
      fs.renameSync(tmp, this.#recordsFile);
    } catch {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* the temp file is litter at worst */
      }
    }
  }
}

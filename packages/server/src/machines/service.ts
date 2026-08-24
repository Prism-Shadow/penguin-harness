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
import { VERSION } from "@prismshadow/penguin-core";
import type {
  MachineConnectFailure,
  MachineConnectJob,
  MachineInfo,
  MachineInstallJob,
  MachineServerStatus,
} from "../api/types.js";
import { readServerLock } from "../lock.js";
import { listHostAliases, resolveTarget } from "./targets.js";
import { installOnRemote, resolvePushPlan } from "./install-server.js";
import { parseInstallRecords, withInstallRecord } from "./installs.js";
import type { InstallRecord } from "./installs.js";
import { probeServerState } from "./server-state.js";
import { readOrCreateMachineId } from "./machine-id.js";
import { localPortBusy, openTunnel, waitForTunneledHttp } from "./tunnel.js";
import type { Tunnel } from "./tunnel.js";
import { startRemoteServer } from "./server-control.js";
import { parseConnectState, pickTunnelPort, withConnectState } from "./connect-state.js";
import type { ConnectState } from "./connect-state.js";

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
  startServer: typeof startRemoteServer;
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
      startServer: startRemoteServer,
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
  list(): MachineInfo[] {
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
   * Probes the machines this server has installed on, refreshing their statuses. Only those:
   * the ssh config can declare hundreds of hosts, and a host nothing was ever installed on
   * has no server to ask about. The local entry needs no probe — it answers by existing.
   *
   * Failures are states, not errors (see server-state.ts), so this always resolves and
   * always leaves every probed machine with an answer.
   */
  async probeInstalled(): Promise<void> {
    const targets = this.list().filter((machine) => !machine.local && machine.installed !== null);
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
        const probe = await this.#effects.probe({
          alias: machine.alias,
          user: resolved.settings.user,
        });
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
    machineId: string,
  ): Promise<{ ok: true } | { ok: false; why: InstallRefusal }> {
    if (this.#job?.running === true) return { ok: false, why: "busy" };

    const machine = this.list().find((entry) => entry.id === machineId);
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
        // Remember it BEFORE the job settles, so the first poll that sees `running: false`
        // already sees the machine marked installed — otherwise the page would flash the
        // verdict and a still-uninstalled row in the same frame.
        this.#remember(machineId, { version, at: this.#effects.now().toISOString() });
        job.result = { ok: true, kind: outcome.kind, version };
      } catch (err) {
        job.result = {
          ok: false,
          step: "install",
          message: err instanceof Error ? err.message : String(err),
        };
      } finally {
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

    const machine = this.list().find((entry) => entry.id === machineId);
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
    job.result = { ok: true, origin };
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

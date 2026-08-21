/**
 * The machines service: the whole "switch this window to another machine" capability, as
 * platform code — listing the hosts of this server's own `~/.ssh/config`, and the connect
 * orchestration (probe → auto-install/update → start its server → tunnel), driven over the
 * platform's HTTP routes (http.ts) and therefore entirely hot-pushable.
 *
 * A connect is a JOB, not a request: it can take minutes (a Node runtime may ride along),
 * and the seam cannot stream, so POST starts it and the web polls the state. One job at a
 * time — the surface is one window switching to one machine.
 *
 * Nothing is supervised. The remote server is nohup-detached and found again through its
 * own lock; the tunnel is an ssh child whose pid is persisted (state.ts), so a hot-swapped
 * or restarted platform ADOPTS a live tunnel instead of duplicating it, and a dead link
 * surfaces on the next connect attempt rather than through a watchdog.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listHostAliases, resolveTarget } from "./targets.js";
import { identityFingerprintCommand, readInitialPasswordCommand, sshArgs } from "./commands.js";
import type { RemoteTarget } from "./commands.js";
import { run } from "./exec.js";
import { detectRemote, installOnRemote, resolvePayloadImage } from "./install-server.js";
import { remoteServerState, startRemoteServer, stopRemoteServer } from "./server-control.js";
import { localPortBusy, openTunnel, waitForTunneledHttp } from "./tunnel.js";
import type { Tunnel } from "./tunnel.js";
import { parseMachinesState, pickTunnelPort, withMachineState } from "./state.js";
import type { MachineState } from "./state.js";

export interface MachineTargetInfo {
  /** `ssh:<alias>` — what the connect route is asked for. */
  id: string;
  /**
   * The alias as written in ~/.ssh/config — the label and the state key. A config can
   * declare hundreds of these, so the list is nothing but the config text re-read: no
   * `ssh -G`, no processes. The alias resolves (user, hostname, …) only when it is
   * actually connected to.
   */
  alias: string;
  /** Origin of a live adopted tunnel, when one is already up. */
  origin: string | null;
}

export type ConnectFailureCode = "port-conflict" | "not-supported" | "no-image" | "self";

/**
 * This machine-and-account's fingerprint, in the same `<machine>:<account>` shape the
 * remote prints (identityFingerprintCommand). Machine-id where the OS keeps one, hostname
 * otherwise; empty machine part when neither exists.
 */
export function localIdentityFingerprint(): string {
  let machine = "";
  try {
    machine = fs.readFileSync("/etc/machine-id", "utf8").trim();
  } catch {
    machine = os.hostname();
  }
  let user = "";
  try {
    user = os.userInfo().username;
  } catch {
    // Leave empty: an unknown local user can never equal a concrete remote one.
  }
  return `${machine}:${user}`;
}

/**
 * True when the two fingerprints name the same machine AND account. A fingerprint with an
 * empty machine or account part matches nothing — better to let an exotic host through
 * than to refuse a real remote on a blank answer. Same machine with a DIFFERENT account
 * is a legitimate target by design: each account has its own ~/.penguin, hence its own
 * server.
 */
export function isSelfFingerprint(remote: string, local: string): boolean {
  const [remoteMachine, remoteUser] = remote.split(":");
  const [localMachine, localUser] = local.split(":");
  if (!remoteMachine || !remoteUser || !localMachine || !localUser) return false;
  return remoteMachine === localMachine && remoteUser === localUser;
}

export interface ConnectJobState {
  machineId: string;
  running: boolean;
  /**
   * Progress lines, oldest first — the far side's own words where possible, each
   * prefixed with its step (`[2/4] …`) so the wait has a visible shape: 1 probe,
   * 2 install, 3 server, 4 tunnel. A step that turns out unnecessary says so and passes.
   */
  log: string[];
  result:
    | null
    | {
        ok: true;
        origin: string;
        /**
         * A fresh install's seeded admin sign-in, read back from the remote's own
         * initial-password store — without it the first landing on that login page is a
         * locked door. Absent once the password has been changed over there.
         */
        initialAdmin?: { userId: string; password: string };
      }
    | { ok: false; code?: ConnectFailureCode; message: string };
}

const originFor = (port: number) => `http://localhost:${port}`;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * A connect caught mid-flight by a swap, as the parked document carries it. A type alias
 * rather than an interface on purpose: only an alias carries the implicit index signature
 * that makes it assignable to the kernel's `Json`, which every parked field must be.
 */
export type ParkedConnect = {
  machineId: string;
  allowRestart?: boolean;
  /** The progress lines so far, so the window's log survives the swap instead of restarting blank. */
  log: string[];
};

export class MachinesService {
  private job: ConnectJobState | null = null;
  private tunnels = new Map<string, Tunnel>();
  private readonly stateFile: string;
  /** Options of the running job, kept so park() can hand the connect to the next App. */
  private jobOpts: { allowRestart?: boolean } = {};

  constructor(private readonly dataRoot: string) {
    this.stateFile = path.join(dataRoot, "machines-state.json");
  }

  /**
   * Hosts from ~/.ssh/config — the config text alone, re-read on every call (an edit shows
   * up without a restart), ordered for a picker: live tunnels first, then most recently
   * connected, then config order. Only aliases WITH state are probed for adoption; a
   * config with hundreds of hosts costs hundreds of string compares, not processes.
   */
  async list(): Promise<MachineTargetInfo[]> {
    const state = this.readState();
    const machines = await Promise.all(
      listHostAliases().map(async (alias, index) => ({
        id: `ssh:${alias}`,
        alias,
        origin: await this.adoptedOrigin(alias, state[alias]),
        last: state[alias]?.lastConnectedAt ?? "",
        index,
      })),
    );
    return machines
      .sort((a, b) => {
        const liveA = a.origin !== null ? 1 : 0;
        const liveB = b.origin !== null ? 1 : 0;
        if (liveA !== liveB) return liveB - liveA;
        // ISO timestamps order lexically; "" (never connected) sorts last.
        if (a.last !== b.last) return a.last < b.last ? 1 : -1;
        return a.index - b.index;
      })
      .map(({ id, alias, origin }) => ({ id, alias, origin }));
  }

  state(): { job: ConnectJobState | null } {
    return { job: this.job };
  }

  /**
   * The live tunnel port for one machine — the proxy's per-request lookup, so it stays
   * cheap: the in-memory tunnel first, else the state file's pid checked with one signal
   * (no HTTP probe here — a stale port surfaces as the proxied request's own 502, which
   * is both rarer and more honest than probing every request).
   */
  async tunnelPortFor(alias: string): Promise<number | null> {
    const inMemory = this.tunnels.get(alias);
    if (inMemory !== undefined) return inMemory.port;
    const state = this.readState()[alias];
    if (state?.tunnelPid === undefined || !pidAlive(state.tunnelPid)) return null;
    return state.port;
  }

  /**
   * Park-side handover. BOTH kinds of state this service holds are DELIVERED, not
   * suspended:
   *
   * - Tunnels are OS processes the next App re-adopts through the state file (pid, port),
   *   so the in-memory objects are detached — exit handlers silenced — rather than closed.
   *   Killing them would drop every window looking at that machine over a push.
   * - An in-flight connect is handed over as parked state ({@link ParkedConnect}) for the
   *   successor to run again. Every step is idempotent by construction — "connect means
   *   make it so": a matching version skips the install, a live server is used as-is, a
   *   live tunnel is adopted — so re-running one is cheap and lands in the same place. The
   *   log rides along, so the window that was watching keeps its history instead of
   *   restarting blank. This is the whole point of a hot update: a push must not cost the
   *   user a connect that may have been installing a Node runtime for minutes.
   *
   * The old job object itself stops mattering the moment this App is disposed; its
   * async body is left to unwind against a service nobody reads any more.
   */
  park(): ParkedConnect | undefined {
    for (const tunnel of this.tunnels.values()) tunnel.detach();
    this.tunnels.clear();
    if (this.job === null || !this.job.running) return undefined;
    return {
      machineId: this.job.machineId,
      ...(this.jobOpts.allowRestart === true ? { allowRestart: true } : {}),
      log: [...this.job.log, "The platform was replaced mid-connect; continuing."],
    };
  }

  /**
   * Load-side counterpart: pick up a connect the previous App was running. Re-runs it from
   * the top (idempotent steps, see park()) with the parked log as its prefix, so the UI
   * polling `state()` sees one continuous job across the swap.
   */
  resume(parked: ParkedConnect): void {
    const job: ConnectJobState = {
      machineId: parked.machineId,
      running: true,
      log: [...parked.log],
      result: null,
    };
    this.startJob(job, { ...(parked.allowRestart === true ? { allowRestart: true } : {}) });
  }

  /** Starts a connect job; refuses while one runs. */
  startConnect(
    id: string,
    opts: { allowRestart?: boolean } = {},
  ): { ok: boolean; message?: string } {
    if (this.job !== null && this.job.running) {
      return { ok: false, message: `already connecting to ${this.job.machineId}` };
    }
    const job: ConnectJobState = { machineId: id, running: true, log: [], result: null };
    this.startJob(job, opts);
    return { ok: true };
  }

  /** The one place a connect job is driven — shared by startConnect() and resume(). */
  private startJob(job: ConnectJobState, opts: { allowRestart?: boolean }): void {
    this.job = job;
    this.jobOpts = opts;
    void this.runConnect(job.machineId, opts, job)
      .then((result) => {
        job.result = result;
      })
      .catch((err) => {
        job.result = { ok: false, message: err instanceof Error ? err.message : String(err) };
      })
      .finally(() => {
        job.running = false;
      });
  }

  /** The full path to a machine. Every step logs; every failure carries the far side's words. */
  private async runConnect(
    id: string,
    opts: { allowRestart?: boolean },
    job: ConnectJobState,
  ): Promise<ConnectJobState["result"]> {
    // Four steps, numbered so the wait has a visible shape; a step that turns out
    // unnecessary still reports itself and passes.
    const STEPS = 4;
    let step = 0;
    const say = (line: string) => job.log.push(`[${Math.max(step, 1)}/${STEPS}] ${line}`);
    const phase = (n: number, line: string) => {
      step = n;
      say(line);
    };
    const machines = await this.list();
    const machine = machines.find((m) => m.id === id);
    if (machine === undefined) return { ok: false, message: `unknown machine ${id}` };
    const alias = machine.alias;

    // Adoption: a live tunnel from an earlier platform or server run IS the connection.
    if (machine.origin !== null) {
      say(`A tunnel to ${alias} is already up.`);
      return { ok: true, origin: machine.origin };
    }

    // The one `ssh -G` of the whole flow: the picked alias resolves (login user, Match,
    // Include, wildcard inheritance) only now — the LIST never resolves anything.
    phase(1, `Resolving ${alias}…`);
    const resolved = await resolveTarget(alias);
    if (resolved === null) {
      return { ok: false, message: `ssh could not resolve "${alias}" (check ~/.ssh/config)` };
    }
    const target: RemoteTarget = { alias, user: resolved.settings.user };

    say(`Asking what ${alias} is…`);
    const detected = await detectRemote(target);
    if ("error" in detected) return { ok: false, message: detected.error };
    let identity = detected.identity;
    if (identity.platform === "win32") {
      return {
        ok: false,
        code: "not-supported",
        message: `${alias} is a Windows machine; starting a detached server from a cmd.exe ssh session is not supported yet.`,
      };
    }

    // The self-guard: an alias resolving to the machine and account this server already
    // runs on would install over its own program directory, and the port-conflict path
    // could kill the very server serving this request. One extra round trip, only on
    // connect. Same machine + different account passes — that IS another target.
    const fingerprint = await run("ssh", sshArgs(target, identityFingerprintCommand()), {
      timeoutMs: 30_000,
    });
    if (
      fingerprint.code === 0 &&
      isSelfFingerprint(fingerprint.stdout.trim(), localIdentityFingerprint())
    ) {
      return {
        ok: false,
        code: "self",
        message: `"${alias}" resolves to the machine and account this server already runs on — you are already here.`,
      };
    }

    const image = resolvePayloadImage(this.dataRoot);
    if (image === null) {
      return {
        ok: false,
        code: "no-image",
        message:
          "This server has nothing pushable: no hot-pushed version in its store, and no installed image on disk (a fresh dev checkout). Push once with scripts/deploy.mjs, or run an installed build.",
      };
    }

    // Install or update — automatic: "connect" means "make it so". A version DIFFERENT
    // from the image includes a remote NEWER one; the database only migrates forward, so
    // the log says which way the replacement went.
    let replacedInstall = false;
    if (identity.installedVersion === image.version) {
      phase(2, `PenguinHarness is already current on ${alias}.`);
    }
    if (identity.installedVersion !== image.version) {
      phase(
        2,
        identity.installedVersion === null
          ? `Installing PenguinHarness ${image.version} on ${alias}…`
          : `Replacing PenguinHarness ${identity.installedVersion} with ${image.version} on ${alias}…`,
      );
      const outcome = await installOnRemote({
        target,
        image,
        identity,
        runtimeCacheDir: path.join(this.dataRoot, "cache", "node-runtimes"),
        onProgress: say,
      });
      if (outcome.kind === "failed") {
        return { ok: false, message: `install failed at "${outcome.step}": ${outcome.detail}` };
      }
      replacedInstall = identity.installedVersion !== null;
      identity = outcome.identity;
    }

    phase(3, "Looking for its server…");
    let state = await remoteServerState(target);
    // A server that predates a replace still runs the OLD build in memory: restart it.
    if (state.alive && state.lock !== null && replacedInstall) {
      say("Restarting its server onto the new build…");
      await stopRemoteServer(target, state.lock.pid);
      state = await remoteServerState(target);
    }

    let port: number;
    if (state.alive && state.lock !== null && !(await localPortBusy(state.lock.port))) {
      // The running server's port is free here: use it as-is, nothing to start.
      port = state.lock.port;
    } else {
      if (state.alive && state.lock !== null) {
        // Running, but its port is taken on this machine — and the tunnel's local port must
        // equal the remote one (preview URLs are built from the server's own bound port).
        // Restarting the remote onto another port ends its sessions, so the caller opts in.
        if (opts.allowRestart !== true) {
          return {
            ok: false,
            code: "port-conflict",
            message: `The server on ${alias} uses port ${state.lock.port}, which is taken on this machine; restarting it onto a free port would interrupt whatever runs there.`,
          };
        }
        say(`Stopping its server on the conflicting port ${state.lock.port}…`);
        await stopRemoteServer(target, state.lock.pid);
      }
      const remembered = this.readState()[alias]?.port;
      const picked = await pickTunnelPort({ remembered, busy: localPortBusy });
      if (picked === null) {
        return { ok: false, message: "no free port for the tunnel on this machine" };
      }
      port = picked;
      say(`Starting its server on port ${port}…`);
      const started = await startRemoteServer(target, port);
      if (!started.ok) {
        return { ok: false, message: `its server did not start: ${started.detail}` };
      }
    }

    phase(4, `Opening the tunnel on port ${port}…`);
    const tunnel = openTunnel({
      target,
      port,
      onExit: () => {
        // The pid is stale the moment ssh exits; the next list()/connect re-discovers.
        // The port and the recency stay — they are what orders and re-numbers the next
        // connect to this machine.
        this.tunnels.delete(alias);
        this.writeState(alias, { port, lastConnectedAt: new Date().toISOString() });
      },
    });
    const origin = originFor(port);
    const ready = await waitForTunneledHttp(origin, () => tunnel.exited());
    if (!ready.ok) {
      tunnel.close();
      const stderr = tunnel.stderr().trim();
      return { ok: false, message: [ready.detail, stderr].filter((s) => s !== "").join("\n") };
    }

    this.tunnels.get(alias)?.close();
    this.tunnels.set(alias, tunnel);
    this.writeState(alias, {
      port,
      ...(tunnel.pid !== null ? { tunnelPid: tunnel.pid } : {}),
      lastConnectedAt: new Date().toISOString(),
    });
    say("Connected.");

    // A fresh install seeds its admin with a random password kept in the remote's data
    // root until changed; without handing it over, the login page this connect lands on
    // is a locked door. One quiet read — absent means "already changed", say nothing.
    const seeded = await run("ssh", sshArgs(target, readInitialPasswordCommand()), {
      timeoutMs: 15_000,
    });
    const initialPassword = seeded.code === 0 ? seeded.stdout.trim() : "";
    if (initialPassword !== "") {
      return {
        ok: true,
        origin,
        initialAdmin: { userId: "admin", password: initialPassword },
      };
    }
    return { ok: true, origin };
  }

  /**
   * The origin of a still-live tunnel for this machine, or null. Live = the recorded ssh
   * pid is alive AND the port answers HTTP here — either signal alone false-positives
   * (pids recycle; the port may be someone else entirely).
   */
  private async adoptedOrigin(
    machine: string,
    state: MachineState | undefined,
  ): Promise<string | null> {
    const inMemory = this.tunnels.get(machine);
    if (inMemory !== undefined) return originFor(inMemory.port);
    if (state?.tunnelPid === undefined || !pidAlive(state.tunnelPid)) return null;
    const answers = await waitForTunneledHttp(originFor(state.port), () => false, 1200);
    return answers.ok ? originFor(state.port) : null;
  }

  private readState(): Record<string, MachineState> {
    try {
      return parseMachinesState(fs.readFileSync(this.stateFile, "utf8"));
    } catch {
      return {};
    }
  }

  private writeState(machine: string, state: MachineState | null): void {
    let raw: string | null = null;
    try {
      raw = fs.readFileSync(this.stateFile, "utf8");
    } catch {
      // First write: the file does not exist yet.
    }
    try {
      fs.writeFileSync(this.stateFile, withMachineState(raw, machine, state));
    } catch {
      // Remembering is a convenience; the connect itself already succeeded or failed.
    }
  }
}

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
import path from "node:path";
import { listHostAliases, resolveTarget } from "./targets.js";
import type { RemoteTarget } from "./commands.js";
import { detectRemote, installOnRemote, resolvePayloadImage } from "./install-server.js";
import { remoteServerState, startRemoteServer, stopRemoteServer } from "./server-control.js";
import { localPortBusy, openTunnel, waitForTunneledHttp } from "./tunnel.js";
import type { Tunnel } from "./tunnel.js";
import { parseMachinesState, pickTunnelPort, withMachineState } from "./state.js";
import type { MachineState } from "./state.js";

export interface MachineTargetInfo {
  /** `ssh:<user>@<alias>` — what the connect route is asked for. */
  id: string;
  /** SSH identity (`user@alias`): the label, the state key, the web app's machine tag. */
  machine: string;
  alias: string;
  user: string;
  /** Origin of a live adopted tunnel, when one is already up. */
  origin: string | null;
}

export type ConnectFailureCode = "port-conflict" | "not-supported" | "no-image";

export interface ConnectJobState {
  machineId: string;
  running: boolean;
  /** Progress lines, oldest first — the far side's own words where possible. */
  log: string[];
  result:
    null | { ok: true; origin: string } | { ok: false; code?: ConnectFailureCode; message: string };
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

export class MachinesService {
  private job: ConnectJobState | null = null;
  private tunnels = new Map<string, Tunnel>();
  private resolved: MachineTargetInfo[] | null = null;
  private readonly stateFile: string;

  constructor(private readonly dataRoot: string) {
    this.stateFile = path.join(dataRoot, "machines-state.json");
  }

  /** Hosts from ~/.ssh/config, resolved once per platform boot (`ssh -G` each). */
  async list(): Promise<MachineTargetInfo[]> {
    if (this.resolved === null) {
      const resolved = await Promise.all(listHostAliases().map((alias) => resolveTarget(alias)));
      this.resolved = resolved
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .map((entry) => ({
          id: `ssh:${entry.machine}`,
          machine: entry.machine,
          alias: entry.alias,
          user: entry.settings.user,
          origin: null,
        }));
    }
    // Live-tunnel adoption is re-checked on every list: it is what lets the menu mark a
    // machine as already reachable after a swap or restart neither side remembers.
    const state = this.readState();
    return await Promise.all(
      this.resolved.map(async (machine) => ({
        ...machine,
        origin: await this.adoptedOrigin(machine.machine, state[machine.machine]),
      })),
    );
  }

  state(): { job: ConnectJobState | null } {
    return { job: this.job };
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
    this.job = job;
    void this.runConnect(id, opts, job)
      .then((result) => {
        job.result = result;
      })
      .catch((err) => {
        job.result = { ok: false, message: err instanceof Error ? err.message : String(err) };
      })
      .finally(() => {
        job.running = false;
      });
    return { ok: true };
  }

  /** The full path to a machine. Every step logs; every failure carries the far side's words. */
  private async runConnect(
    id: string,
    opts: { allowRestart?: boolean },
    job: ConnectJobState,
  ): Promise<ConnectJobState["result"]> {
    const say = (line: string) => job.log.push(line);
    const machines = await this.list();
    const machine = machines.find((m) => m.id === id);
    if (machine === undefined) return { ok: false, message: `unknown machine ${id}` };
    const target: RemoteTarget = { alias: machine.alias, user: machine.user };

    // Adoption: a live tunnel from an earlier platform or server run IS the connection.
    if (machine.origin !== null) {
      say(`A tunnel to ${machine.machine} is already up.`);
      return { ok: true, origin: machine.origin };
    }

    say(`Asking what ${machine.machine} is…`);
    const detected = await detectRemote(target);
    if ("error" in detected) return { ok: false, message: detected.error };
    let identity = detected.identity;
    if (identity.platform === "win32") {
      return {
        ok: false,
        code: "not-supported",
        message: `${machine.machine} is a Windows machine; starting a detached server from a cmd.exe ssh session is not supported yet.`,
      };
    }

    const image = resolvePayloadImage();
    if (image === null) {
      return {
        ok: false,
        code: "no-image",
        message:
          "This server carries no pushable install image (a dev checkout does not); connect from an installed build.",
      };
    }

    // Install or update — automatic: "connect" means "make it so". A version DIFFERENT
    // from the image includes a remote NEWER one; the database only migrates forward, so
    // the log says which way the replacement went.
    let replacedInstall = false;
    if (identity.installedVersion !== image.version) {
      say(
        identity.installedVersion === null
          ? `Installing PenguinHarness ${image.version} on ${machine.machine}…`
          : `Replacing PenguinHarness ${identity.installedVersion} with ${image.version} on ${machine.machine}…`,
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

    say("Looking for its server…");
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
            message: `The server on ${machine.machine} uses port ${state.lock.port}, which is taken on this machine; restarting it onto a free port would interrupt whatever runs there.`,
          };
        }
        say(`Stopping its server on the conflicting port ${state.lock.port}…`);
        await stopRemoteServer(target, state.lock.pid);
      }
      const remembered = this.readState()[machine.machine]?.port;
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

    say(`Opening the tunnel on port ${port}…`);
    const tunnel = openTunnel({
      target,
      port,
      onExit: () => {
        // The pid is stale the moment ssh exits; the next list()/connect re-discovers.
        this.tunnels.delete(machine.machine);
        this.writeState(machine.machine, { port });
      },
    });
    const origin = originFor(port);
    const ready = await waitForTunneledHttp(origin, () => tunnel.exited());
    if (!ready.ok) {
      tunnel.close();
      const stderr = tunnel.stderr().trim();
      return { ok: false, message: [ready.detail, stderr].filter((s) => s !== "").join("\n") };
    }

    this.tunnels.get(machine.machine)?.close();
    this.tunnels.set(machine.machine, tunnel);
    this.writeState(machine.machine, {
      port,
      ...(tunnel.pid !== null ? { tunnelPid: tunnel.pid } : {}),
    });
    say("Connected.");
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

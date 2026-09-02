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
 * The RESULT is, in web.db (MachinesRepo): which machines carry this program, and which
 * Project uses which. It has to outlive the job, the process and the next install somewhere
 * else. It is a record of what WE did, not a survey of the far side — a machine someone
 * wiped by hand still reads as installed here, and the install itself is what corrects that,
 * since it probes the remote before deciding anything.
 *
 * A machine BELONGS TO A PROJECT. The host is shared — one program, one ssh config entry —
 * but which Projects use it is this server's own bookkeeping, because a Project's machines
 * are where that Project's work runs. A host installed for another Project is reported as
 * `elsewhere` rather than hidden: adopting it costs a row, while re-installing costs a
 * 30 MB transfer to reach the same place.
 */
import os from "node:os";
import { VERSION } from "@prismshadow/penguin-core";
import type { MachineInfo, MachineInstallJob, MachineServerStatus } from "../api/types.js";
import { readServerLock } from "../lock.js";
import { listHostAliases } from "./transport/index.js";
import type { ExecResult } from "./transport/index.js";
import type { RemoteTarget } from "./commands.js";
import { installOnRemote, resolvePushPlan } from "./install-server.js";
import { probeServerState } from "./server-state.js";
import type { MachinesRepo } from "../db/repos/machines.js";

/** The id of the entry standing for the machine this server runs on. */
const LOCAL_MACHINE_ID = "local";

/** How many machines the probe works on at once. */
const CONCURRENCY = 5;

/** Why a start was refused before any ssh ran. */
export type InstallRefusal = "busy" | "unknown-machine" | "no-image" | "self";

/**
 * The three things this service does to the world, injectable as a set. Production passes
 * none of them; tests pass all three, because the real ones read the developer's own
 * ~/.ssh/config and spawn ssh against whatever it names. The push path itself is covered
 * where it belongs — machines-push.test.ts drives the real installOnRemote against a fake
 * ssh binary — so what is faked here is only the reaching-out, never the logic under test.
 */
export interface MachinesEffects {
  listAliases: typeof listHostAliases;
  resolvePlan: typeof resolvePushPlan;
  install: typeof installOnRemote;
  probe: typeof probeServerState;
  /** One command on a machine, over its own ssh. */
  runOn: (target: RemoteTarget, command: string) => Promise<ExecResult>;
  /** Injected so a test can pin the recorded timestamp instead of asserting around the clock. */
  now: () => Date;
}

export class MachinesService {
  #job: MachineInstallJob | null = null;
  /**
   * The last probe per address. In memory on purpose: a status is only true for the moment
   * it was taken, so one that outlived its App would be a claim nobody measured.
   */
  readonly #statuses = new Map<string, MachineServerStatus>();
  readonly #effects: MachinesEffects;
  readonly #machineId: string;

  /** Where a pushed bundle's assets were unpacked; null in a packaged server (hmr.assetsDir). */
  readonly #assets: () => string | null;

  /** `dataRoot` is the server's own data root: it holds the hmr state a push replicates. */
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
      // 30s: a probe is one short command, and a machine that cannot answer it in that time
      // is one the list should call unreachable rather than wait on.
      runOn: (target, command) => run("ssh", sshArgs(target, command), { timeoutMs: 30_000 }),
      now: () => new Date(),
      ...effects,
    };
  }

  /** The ssh target for an alias, or null when ssh cannot resolve it. */
  async #targetOf(alias: string): Promise<RemoteTarget | null> {
    const resolved = await this.#effects.resolveTarget(alias);
    return resolved === null ? null : { alias, user: resolved.settings.user };
  }

  /**
   * This machine: always installed, always up, never a target. Read directly rather than
   * probed — both facts are right here — and absent from the install picker, because a
   * server does not push this build over the program directory it is running from.
   */
  #localMachine(): MachineInfo {
    const lock = readServerLock(this.dataRoot);
    return {
      id: LOCAL_MACHINE_ID,
      alias: os.hostname(),
      machineId: this.#machineId,
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
   * The ssh config's host aliases, answered for one Project: `installed` means installed FOR
   * THIS PROJECT, and a host this server installed on but this Project does not use is
   * reported through `elsewhere`. Empty when there is no config, which is not an error.
   */
  list(projectId: string): MachineInfo[] {
    const members = new Set(this.#members(projectId));
    const remotes = this.#effects.listAliases().map((alias): MachineInfo => {
      const id = `ssh:${alias}`;
      const row = this.repo.get(id);
      const installed =
        row?.version == null ? null : { version: row.version, at: row.installedAt ?? "" };
      const mine = members.has(id);
      return {
        id,
        alias,
        machineId: row?.machineId ?? null,
        installed: mine ? installed : null,
        ...(!mine && installed !== null ? { elsewhere: installed } : {}),
        local: false,
        status: this.#statuses.get(id) ?? null,
      };
    });
    return [this.#localMachine(), ...remotes];
  }

  /**
   * Asks this Project's installed machines what they are doing, five at a time, and keeps
   * each answer. Never at list time: a probe is an ssh round trip per machine, and a page
   * load is not a reason to open one to every host in a config.
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
        const probe = await this.#effects.probe(
          target,
          this.#effects.runOn,
          this.repo.get(machine.id)?.platform ?? null,
        );
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

  /** Drops a machine from a Project. The program stays installed; only the membership goes. */
  release(projectId: string, address: string): void {
    this.#setMember(projectId, address, false);
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
  job(): MachineInstallJob | null {
    return this.#job;
  }

  /**
   * Starts an install, refusing rather than queueing. The refusals that can be decided here —
   * a job already running, an alias this config does not declare, an ssh that cannot resolve
   * it, no image to send — are answered synchronously, so the page distinguishes "did not
   * start" from "started and failed" without reading the log.
   *
   * Success also gives the machine to the Project that asked for it: an install is how a
   * Project acquires a machine, and one that installed but belonged to nobody would not
   * appear in the list it was started from.
   */
  async startInstall(
    projectId: string,
    machineId: string,
  ): Promise<{ ok: true } | { ok: false; why: InstallRefusal }> {
    if (this.#job?.running === true) return { ok: false, why: "busy" };

    // Never this machine: a server does not push this build over its own program directory
    // while running from it. The synthetic row is the obvious case. An alias that points
    // back home — `Host localhost`, a second name for this host — is the same machine at
    // another address, and the id a probe once heard from it says so without any ssh; an
    // alias never probed is asked inside the job, before anything is written.
    if (machineId === LOCAL_MACHINE_ID) return { ok: false, why: "self" };
    const alias = this.#effects.listAliases().find((entry) => `ssh:${entry}` === machineId);
    if (alias === undefined) return { ok: false, why: "unknown-machine" };
    if (this.repo.get(machineId)?.machineId === this.#machineId) return { ok: false, why: "self" };

    const plan = this.#effects.resolvePlan(this.dataRoot);
    if (plan === null) return { ok: false, why: "no-image" };

    const job: MachineInstallJob = {
      machineId,
      alias,
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
        // The alias IS the target: what it means — user, host, port, key, jump host — is
        // ssh's to resolve, from its own config, every time it is handed the alias.
        const target = { alias, user: "" };
        say(`Installing ${plan.version} on ${alias}…`);
        // Asked before anything is written: only the machine can say whether this alias is
        // this host under another name. Unreachable is not a refusal — a host with nothing
        // installed yet answers exactly that — this server's own id is.
        const heard = await this.#effects.probe(target, this.#effects.runOn, null);
        this.#rememberMachineId(machineId, heard.machineId);
        if (heard.machineId !== null && heard.machineId === this.#machineId) {
          job.result = {
            ok: false,
            step: "connect",
            message:
              "That alias reaches this very machine — it answered with this server's own id. A server does not push this build over the program directory it is running from.",
          };
          return;
        }
        // No identity passed: installOnRemote runs the probe itself as its first step and
        // narrates it, so the page shows what the machine turned out to be.
        const outcome = await this.#effects.install({
          target,
          plan,
          onProgress: say,
          assets: this.#assets,
        });
        if (outcome.kind === "failed") {
          job.result = { ok: false, step: outcome.step, message: outcome.detail };
          return;
        }
        const version = outcome.kind === "already-installed" ? outcome.version : plan.version;
        // Remembered BEFORE the job settles, so the first poll that sees `running: false`
        // already sees the machine marked installed — otherwise the page would flash the
        // verdict and a still-uninstalled row in the same frame.
        this.repo.patch(machineId, {
          version,
          installedAt: this.#effects.now().toISOString(),
          platform: outcome.identity.platform,
        });
        this.#setMember(projectId, machineId, true);
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
}

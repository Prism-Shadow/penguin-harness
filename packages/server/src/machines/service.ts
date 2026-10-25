/**
 * The machines service: this server's own `~/.ssh/config` as a list of targets, and putting
 * this build on one of them, reaching it, and keeping it configured.
 *
 * ONE JOB per machine at a time — an install, a connect, a stop — started by POST, a few
 * machines worked on at once, each job's progress pushed to the page as it goes
 * (`machines_changed`). The job lives in this App's memory; what it achieved is in web.db
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
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PROJECT_ID,
  VERSION,
  effectivePluginTable,
  loadProjectConfig,
} from "@prismshadow/penguin-core";
import type { ModelRef, ProjectConfig } from "@prismshadow/penguin-core";
import type {
  SshHostSummary,
  MachineCheck,
  MachineConfigSync,
  MachineDiagnosis,
  MachineEnvOnly,
  MachineInfo,
  MachineSkippedModel,
  MachineJob,
  MachinePhase,
  MachineReconnect,
  MachineServerStatus,
  MachineSshFailure,
  MachineSocketFact,
  MachineUseRefusal,
  MachinesCheckoutImage,
  ServerEvent,
} from "../api/types.js";
import { readServerLock } from "../lock.js";
import { SESSION_COOKIE } from "../auth/middleware.js";
import http from "node:http";
import {
  appendHostBlock,
  closeAllConnections,
  SESSION_GROUP,
  attachSessionRegistry,
  closeConnectionTo,
  connectionTo,
  forgetRefusal,
  heldSessionOf,
  listHostAliases,
  listHostEntries,
  onSessionChange,
  passwordSignIn,
  readSshConfig,
  writeSshConfig,
} from "./transport/index.js";
import type {
  AskpassPlan,
  ExecResult,
  MachineConnection,
  SessionListener,
  ShellSession,
} from "./transport/index.js";
import { SshPasswords, passwordProblem } from "./ssh-passwords.js";
import {
  findHostBlock,
  machineIdentity,
  renderHostBlock,
  replaceHostBlock,
  sameHostEntry,
  validateHostEntry,
} from "./ssh-config.js";
import type { SshHostEntry, SshHostProblem } from "./ssh-config.js";
import { DIR_LIST_MARK, listDirsCommand, uninstallCommand } from "./commands.js";
import type { RemoteTarget } from "./commands.js";
import {
  detectRemote,
  installOnRemote,
  resolvePushPlan,
  runningBuild,
  runsPlan,
  sameBuild,
  shippedImage,
} from "./install-server.js";
import { parseProbeOutput, posixProbe } from "./detect.js";
import { explainSshFailure, sshRefusal } from "./ssh-failure.js";
import type { SshFailureReason } from "./ssh-failure.js";
import { diagnoseCommand, parseDiagnosis, sshFailureChecks } from "./diagnose.js";
import type { CarryRelease, PushPlan, RunningBuild } from "./install-server.js";
import { releaseCache } from "./release-cache.js";
import { CheckoutImage, deployPacker, findCheckout, imageAssets } from "./checkout-image.js";
import type { CheckoutBuild, CheckoutPacker } from "./checkout-image.js";
import { ShippedImage } from "./shipped-image.js";
import { probeServerState } from "./server-state.js";
import { upgradeRemote } from "./upgrade.js";
import type { UpgradeOutcome } from "./upgrade.js";
import { mintTokenOnRemote } from "./remote-token.js";
import { envSourced, syncModelsToMachine } from "./models-sync.js";
import { syncPluginsToMachine, type WantedPlugin } from "./plugins-sync.js";
import type { LocalModels } from "./models-sync.js";
import { localSettings, syncSettingsToMachine } from "./settings-sync.js";
import { machineApi } from "./machine-api.js";
import type { MachineApi } from "./machine-api.js";
import { ADOPTED_AT_HEADER } from "../runtime/session-sources.js";
import { startRemoteServer, stopRemoteServer } from "./server-control.js";
import type { MachineRow } from "../db/repos/machines.js";
import { Interface, Bind, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../auth/middleware.js";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import { machinesRoutes } from "../http/routes/machines.js";
import { machinesProxy } from "./proxy.js";
import type { ProxyTarget } from "./proxy.js";
import { MachineEventHub } from "./event-hub.js";
import { MachineSockets } from "./machine-sockets.js";
import { machineSessionForward } from "./session-forward.js";
import type { MachineSessionForward } from "./session-forward.js";
import { HttpError } from "../http/errors.js";
import type { Access } from "../mechanisms/projects.js";
import { Hono } from "hono";
import { MachinesRepo } from "../db/repos/machines.js";
import type { DatabaseSync } from "node:sqlite";
import type { Channels, Db, Hmr, Paths, ResourceGroups } from "../hmr/capabilities.js";
import type { Users } from "../mechanisms/identity.js";
import { userChannelKey } from "../http/routes/events.js";
import { currentRemoteLayout } from "./layout.js";
import type { RemoteLayout } from "./layout.js";

/**
 * What a dial to a machine's server returns: the connection to route requests over, the port
 * its server is on over there, and a session there as its own cookie. The socket proxy path
 * (proxyTarget) dials machines this way.
 */
interface RelayDial {
  /** Dials the machine's server through the session held to it. */
  agent: http.Agent;
  /** The port its server is on over there. */
  port: number;
  /** A session on that machine, as its own cookie. */
  cookie: string;
}

/** A job's narrator: a line for the log, and optionally the step of the pipeline it begins. */
type Say = (line: string, phase?: MachinePhase) => void;

/**
 * Why a machine was not handed this server's Project config: what it runs, and what it must run
 * instead. Said where the job stops, and as the reason a kept machine is still on its way back.
 */
function mustUpdate(running: RunningBuild | null, to?: string): string {
  const runs = running === null ? "" : running.foreign ? running.release : running.version;
  const target = to === undefined ? "" : ` to ${to}`;
  return runs === ""
    ? `That machine must be updated${target} before it can use this server's models.`
    : `That machine runs ${runs}; it must be updated${target} before it can use this server's models.`;
}

/**
 * This side's model table for a Project, whole: every group connection (`[providers.<id>]`)
 * and every entry, a bare one included. The file is the only truth, here as over there: a
 * bare row runs on its group's table, which travels beside it, and the machine's own copy of
 * a preset may have been seeded by another release or edited since — so nothing is skipped
 * on the guess that the far side already holds the same.
 */
function localModelsOf(config: ProjectConfig): LocalModels {
  return {
    models: config.models,
    ...(config.providers !== undefined ? { providers: config.providers } : {}),
    ...(config.default_model !== undefined ? { defaultModel: config.default_model } : {}),
    ...(config.vision_model !== undefined ? { visionModel: config.vision_model } : {}),
    ...(config.name !== undefined ? { name: config.name } : {}),
  };
}

/** `provider/model (VAR, VAR)`, one per model, in the order the config lists them. */
function envOnlyList(rows: readonly MachineEnvOnly[]): string {
  const byModel = new Map<string, string[]>();
  for (const row of rows) {
    const key = `${row.provider}/${row.modelId}`;
    byModel.set(key, [...(byModel.get(key) ?? []), row.variable]);
  }
  return [...byModel].map(([model, variables]) => `${model} (${variables.join(", ")})`).join(", ");
}

/** A job's outcome when it did not go through. */
type JobFailure = Extract<NonNullable<MachineJob["result"]>, { ok: false }>;

/** How often the machines this server keeps connected are looked over, as a net under the timers. */
const KEEP_HELD_MS = 60_000;
/**
 * The first wait before a machine that was lost is tried again — long enough for a server that
 * restarts itself (a plugin load, a hot update) to be back. Each failed attempt doubles the wait,
 * up to the cap.
 */
const RECONNECT_FIRST_MS = 5_000;
const RECONNECT_MAX_MS = 5 * 60_000;
/**
 * After this many failed attempts in a row the streak stops, and waits for a person's Retry.
 * With the waits above the last one lands about fifteen minutes after the loss: a restart, a
 * reboot or a network blip is back well inside that, and a machine still down after it needs
 * someone to look — a probe every five minutes for a day would only fill its auth log.
 */
const RECONNECT_MAX_ATTEMPTS = 8;
/**
 * ssh's refusals that another try cannot fix: each needs a person to act (accept a host key,
 * fix a key file or the ssh config, authorize a key) and then press Retry. The first one ends the
 * streak. A refused password has its own stop (`waitsForPassword`).
 */
const UNRECOVERABLE_SSH: ReadonlySet<MachineSshFailure> = new Set<MachineSshFailure>([
  "host-key-unknown",
  "host-key-changed",
  "key-file",
  "auth",
  "ssh-config",
]);
/** After this many failed attempts in a row, the connection check runs on its own. */
const DIAGNOSE_AFTER = 3;
/** `machines_changed` goes out at most this often: a burst of log lines is one event per window. */
const ANNOUNCE_MS = 200;
/**
 * Failure steps a connection check can explain — reaching, installing on or starting the
 * machine. A failed job at one of them gets a check of its own; one at this server's own build
 * or at the hand-over protocol does not, since the machine is not what failed.
 */
const DIAGNOSABLE_STEPS = new Set([
  "check",
  "connect",
  "install",
  "copy",
  "resolve the release",
  "download the release",
  "send the release",
  "verify the install",
  "start its server",
]);

/** Why an install was refused before any ssh ran. */
type InstallRefusal = "busy" | "unknown-machine" | "no-image" | "self";
/** Why a connect — or a stop, a restart, an uninstall — was refused before any ssh ran. */
type ConnectRefusal = "busy" | "unknown-machine" | "not-installed" | "self" | "unsupported";
/** Why a config sync was refused before any ssh ran: those, or a machine not connected. */
type SyncRefusal = ConnectRefusal | "not-connected";
/**
 * What a person's Retry of a reconnect did — `started` false when an attempt already runs or
 * the machine is up — or why it was refused before anything ran.
 */
export type RetryReconnectAnswer =
  | { ok: true; started: boolean }
  | { ok: false; why: "unknown-machine" | "busy" | "password" | "not-kept" };

/** A machine this server keeps connected, while it is brought back (MachineReconnect, in epoch ms). */
interface Reconnecting {
  since: number;
  attempts: number;
  /** When the next attempt is due; null while one runs, and once the streak stopped. */
  nextAt: number | null;
  /** The streak stopped: nothing runs until a person's Retry (retryReconnect) begins another. */
  gaveUp?: "attempts" | "ssh";
  lastError: string | null;
  sshReason?: MachineSshFailure;
  diagnosis: MachineDiagnosis | null;
  /** The failure the diagnosis was taken for: a different one is checked again. */
  diagnosedFor: string | null;
  /**
   * The stored password was refused (or the host takes none): no attempt runs until a password
   * is saved for the machine again or removed — retrying it would lock the account.
   */
  waitsForPassword?: true;
}

/** Why a host block or its password was not written. */
type HostRefusal =
  | { ok: false; why: "invalid"; problem: SshHostProblem }
  | { ok: false; why: "password-invalid"; problem: "required" | "invalid" }
  | { ok: false; why: "password-unsupported"; detail: string; ssh: string };

/**
 * Runs a job's work with what its batch installs — a plan and where its installers are —
 * held for as long as the work runs; or answers with the failure that left the batch without.
 */
type WithImage = (
  say: Say,
  work: (image: { plan: PushPlan; assets: () => string | null }) => Promise<MachineJob["result"]>,
) => Promise<MachineJob["result"]>;

/**
 * What this service does to the world, injectable as a set. Production passes none of them;
 * tests fake the reaching-out, because the real ones read the developer's own ~/.ssh/config
 * and spawn ssh against whatever it names. The push path itself is covered where it belongs
 * — machines-push.test.ts drives the real installOnRemote against a fake ssh binary — so
 * what is faked here is only the reaching-out, never the logic under test.
 */
export interface MachinesEffects {
  /** How long after boot the second out-of-date sweep runs (see start()). */
  lateSweepMs: number;
  listAliases: typeof listHostAliases;
  /** The hosts with what each one's own block says (user, host, port): the add dialog's rows. */
  listHosts: typeof listHostEntries;
  /** The writes to the ssh config: appending a host block a person composed in the page, and rewriting one this app wrote. */
  appendHost: typeof appendHostBlock;
  readConfig: typeof readSshConfig;
  writeConfig: typeof writeSshConfig;
  resolvePlan: typeof resolvePushPlan;
  install: typeof installOnRemote;
  /** What a machine is, asked in either shell's dialect (install-server.ts). */
  detect: typeof detectRemote;
  /**
   * The release package for a machine that cannot download it itself, fetched on this side
   * (release-cache.ts) to be carried over the session.
   */
  carryRelease: CarryRelease;
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
  mintToken: (
    target: RemoteTarget,
    runOn: MachinesEffects["runOn"],
  ) => ReturnType<typeof mintTokenOnRemote>;
  upgrade: typeof upgradeRemote;
  /** This server's own Project config, credentials in plaintext — the source of a config sync. */
  loadConfig: (projectId: string) => Promise<ProjectConfig>;
  /** This server's environment: what a model entry with no key of its own may take one from. */
  env: () => Readonly<Record<string, string | undefined>>;
  /**
   * Packs this server's checkout into an install image (checkout-image.ts) — or null when it
   * does not run from a checkout, which is every server but a development one.
   */
  packCheckout: CheckoutPacker | null;
  /**
   * The install image this server's release shipped (install-server.ts's shippedImage) — or
   * null when it stands on no installed release, or on one packaged without an image.
   */
  shippedImage: { baseVersion: string; body: string } | null;
  /** Injected so a test can pin the recorded timestamp instead of asserting around the clock. */
  now: () => Date;
  /** Tells this server's admins that the machines list changed (`machines_changed`). */
  announce: () => void;
  /** Starts telling `listener` when a held connection comes up or goes down; returns the stop. */
  watchSessions: (listener: SessionListener) => () => void;
  /** Whether this computer's ssh can sign in with a stored password (transport/login.ts). */
  passwordSignIn: () => Promise<AskpassPlan>;
  /**
   * What the API socket to a machine is doing (machines/machine-sockets.ts), for `MachineInfo.socket`:
   * connected, dialling, refused or failed, and since when. The sockets themselves are the
   * proxy's, created beside it, so this is an injected reader rather than a field here.
   */
  socketFact: (machineId: string) => MachineSocketFact | null;
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
   * Machines with a config sync in flight, and whether another was asked for meanwhile. An
   * edit that arrives while a sync is running is not dropped and not queued behind it one
   * by one: ONE trailing sync runs when the current one ends, reading the config as it is
   * then — which is what every edit in between wanted written.
   */
  readonly #syncing = new Map<string, { again: boolean }>();
  /**
   * What each machine's last config sync came to, by address. In memory like #statuses: a
   * restart syncs every machine it brings back anyway.
   */
  readonly #configSyncs = new Map<string, MachineConfigSync>();
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
  /** Which installation on each machine this instance reaches — its profile's (layout.ts). */
  readonly #layout: RemoteLayout;
  /** Jobs waiting their turn, in order; the running one has left this list. */
  readonly #queue: Array<{
    job: MachineJob;
    opts: { offerReplaceProgram: boolean };
    work: (say: Say) => Promise<MachineJob["result"]>;
  }> = [];
  /** The latest job per machine — queued, running or finished — for the page's rows. */
  readonly #jobs = new Map<string, MachineJob>();
  /** The net under the timers: every KEEP_HELD_MS the machines kept connected are looked over. */
  #keepHeld: ReturnType<typeof setInterval> | null = null;
  /**
   * The machines kept connected that are being brought back, by address. In memory: a restart
   * starts over, bringing back every machine the record says is kept connected.
   */
  readonly #reconnects = new Map<string, Reconnecting>();
  /** The timer that runs a machine's next attempt when it is due. */
  readonly #retryTimers = new Map<string, NodeJS.Timeout>();
  /** The `machines_changed` window: open while one went out recently, and whether another is owed. */
  #announceTimer: NodeJS.Timeout | null = null;
  #announceOwed = false;
  /** This generation is on its way out: nothing new is scheduled. */
  #stopped = false;
  /** Stops listening to the held connections' ups and downs. */
  readonly #unwatch: () => void;
  /** The image a source checkout builds for its installs; null for every other server. */
  readonly #checkout: CheckoutImage | null;
  /** The image an installed release shipped, laid down on first need; null for every other server. */
  readonly #shipped: ShippedImage | null;
  /** The passwords machines sign in with, by alias, and the helper ssh asks for them. */
  readonly #passwords: SshPasswords;
  /** The boot's second sweep, pending (see start()). */
  #lateSweep: ReturnType<typeof setTimeout> | null = null;

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
      listHosts: listHostEntries,
      appendHost: appendHostBlock,
      readConfig: readSshConfig,
      writeConfig: writeSshConfig,
      resolvePlan: resolvePushPlan,
      install: installOnRemote,
      detect: (target, layout) => detectRemote(target, layout),
      carryRelease: releaseCache(path.join(dataRoot, "machines", "releases")),
      probe: probeServerState,
      runOn: (target, command) => connectionTo(target).exec(command),
      startServer: (target, port) => startRemoteServer(target, port, layout, this.#effects.runOn),
      hold: (target) => connectionTo(target).hold(),
      session: (address) => heldSessionOf(address),
      agent: (target, remotePort) => connectionTo(target).agent(remotePort),
      stopServer: (target) => stopRemoteServer(target, layout, this.#effects.runOn),
      mintToken: (target, runOn) => mintTokenOnRemote(target, layout, runOn),
      upgrade: upgradeRemote,
      loadConfig: (projectId) => loadProjectConfig(dataRoot, projectId),
      env: () => process.env,
      packCheckout: null,
      shippedImage: null,
      now: () => new Date(),
      announce: () => {},
      watchSessions: onSessionChange,
      passwordSignIn,
      lateSweepMs: 20_000,
      socketFact: () => null,
      ...effects,
    };
    this.#passwords = new SshPasswords(path.join(dataRoot, "machines"));
    // A held connection that drops is a machine to bring back; one that comes up is news.
    this.#unwatch = this.#effects.watchSessions((address, up) => {
      this.#changed();
      if (!up) this.#lost(address);
    });
    const pack = this.#effects.packCheckout;
    this.#checkout =
      pack === null
        ? null
        : new CheckoutImage(path.join(dataRoot, "machines", "checkout-image"), VERSION, pack, () =>
            this.#effects.now(),
          );
    const shipped = this.#effects.shippedImage;
    this.#shipped =
      shipped === null
        ? null
        : new ShippedImage(
            path.join(dataRoot, "machines", "release-image"),
            shipped.baseVersion,
            shipped.body,
            () => this.#effects.now(),
          );
  }

  // --- what is known -----------------------------------------------------------------------

  /**
   * A machine's ssh target is its alias, and the password it signs in with when one is stored
   * for it. What the alias means — user, host, port, key, jump host — is ssh's to resolve, from
   * its own config, every time it is handed the alias; asking ssh for that answer first
   * (`ssh -G`) only to hand it back was a process per probe that could go stale against a file a
   * person edits, for no fact we used. The password is read when a connection opens, not here.
   */
  #targetOf(alias: string): RemoteTarget {
    if (!this.#passwords.has(alias)) return { alias, user: "" };
    const passwords = this.#passwords;
    return {
      alias,
      user: "",
      password: { askpass: passwords.askpass(), read: () => passwords.read(alias) },
    };
  }

  /** How a target signs in, for reading ssh's words about it (ssh-failure.ts). */
  #signIn(target: RemoteTarget): { password: boolean } {
    return { password: target.password !== undefined };
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
      this.#record(address, { sessionPid: held.session.pid });
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
      // The build this process carries, not the package's release number: a hot-pushed
      // server runs `0.2.9+hmr.<hash>`, and that is what it would install elsewhere, so it
      // is what "this server" must say of itself — or the fleet reads as behind the wrong thing.
      installed: {
        version: this.imageVersion() ?? VERSION,
        at: lock?.startedAt ?? this.#effects.now().toISOString(),
      },
      local: true,
      connection: null,
      socket: null,
      api: null,
      root: this.dataRoot,
      status: {
        state: "running",
        checkedAt: this.#effects.now().toISOString(),
        ...(lock === null ? {} : { port: lock.port }),
      },
    };
  }

  /** This machine, then the ssh config's host aliases with what is known about each. */
  #allMachines(): MachineInfo[] {
    const withPassword = this.#passwords.aliases();
    const remotes = this.#effects.listAliases().map((alias): MachineInfo => {
      const id = `ssh:${alias}`;
      const row = this.repo.get(id);
      const session = this.#liveSession(id);
      const reconnect = this.#reconnects.get(id);
      const configSync = this.#configSyncs.get(id);
      return {
        id,
        alias,
        machineId: row?.machineId ?? null,
        installed:
          row?.version == null ? null : { version: row.version, at: row.installedAt ?? "" },
        local: false,
        connection: session === null ? null : { pid: session.pid },
        ...(reconnect === undefined ? {} : { reconnect: this.#reconnectInfo(reconnect) }),
        ...(row?.sessionPid != null ? { keepConnected: true as const } : {}),
        ...(withPassword.has(alias) ? { passwordSaved: true as const } : {}),
        socket: row?.machineId == null ? null : (this.#effects.socketFact(row.machineId) ?? null),
        api: this.#apiSeen.get(id) ?? null,
        ...(configSync === undefined ? {} : { configSync }),
        // The layout's own spelling, in the shell that machine speaks. Unknown platform
        // reads as POSIX: it is the majority, and an install corrects the record.
        root: row?.platform === "win32" ? this.#layout.dataRoot.win : this.#layout.dataRoot.posix,
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
      const sync = machine.configSync;
      return {
        ...machine,
        installed: mine ? machine.installed : null,
        ...(mine ? { member: true as const } : {}),
        ...(!mine && machine.installed !== null ? { elsewhere: machine.installed } : {}),
        // Another Project's models are its own business, on this page as on the machine.
        ...(sync === undefined
          ? {}
          : {
              configSync: {
                ...sync,
                envOnly: sync.envOnly.filter((entry) => entry.projectId === projectId),
                skipped: sync.skipped.filter((entry) => entry.projectId === projectId),
              },
            }),
      };
    });
  }

  /**
   * The hosts in this server's ssh config with what each one's own block says — for the page's
   * add dialog, which shows `user@host:port` beside an alias. Read on request, like the list.
   */
  sshHosts(): SshHostSummary[] {
    return this.#effects.listHosts();
  }

  /**
   * Puts machines in a Project's list without installing anything there: each then has a card,
   * whose one thing to do is enabling it. Refusals by id, as `startUse` answers them; nothing
   * reaches a machine.
   */
  addToProject(
    projectId: string,
    addresses: readonly string[],
  ): { refused: { machineId: string; why: MachineUseRefusal }[] } {
    const refused: { machineId: string; why: MachineUseRefusal }[] = [];
    for (const address of new Set(addresses)) {
      const machine = this.#allMachines().find((entry) => entry.id === address);
      if (machine === undefined) {
        refused.push({ machineId: address, why: "unknown-machine" });
      } else if (
        machine.local ||
        (machine.machineId !== null && machine.machineId === this.#machineId)
      ) {
        refused.push({ machineId: address, why: "self" });
      } else {
        this.#setMember(projectId, address, true);
      }
    }
    this.#changed();
    return { refused };
  }

  /** Drops a machine from a Project. The program stays installed; only the membership goes. */
  release(projectId: string, address: string): void {
    this.#setMember(projectId, address, false);
    this.#changed();
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
   * The version this server would install, or null when it has none to name. A hot-pushed
   * server names its pushed state; a release nothing was pushed to names the image it
   * shipped, once that is laid down (at boot, by start()'s sweep); a source checkout names the
   * image it last built — its next install builds again, from the checkout as it is then —
   * and null before the first build. A server that is none of these has no image at all. The
   * page asks so it can say so up front, rather than letting every install fail at the same
   * step.
   */
  imageVersion(): string | null {
    return this.#plan()?.version ?? null;
  }

  /** The checkout's image, for the page to speak of; null unless this server builds its image from a checkout. */
  checkoutImage(): MachinesCheckoutImage | null {
    if (this.#checkout === null || !this.#buildsImage()) return null;
    return this.#checkout.status();
  }

  /** The checkout's build, as the first step of a job that installs — on a server that builds its image. */
  #buildStep(): MachinePhase[] {
    return this.#buildsImage() ? ["build"] : [];
  }

  /** Whether this server's installs build their image from a checkout: it has neither pushed state nor a shipped image. */
  #buildsImage(): boolean {
    return (
      this.#checkout !== null &&
      this.#shipped === null &&
      this.#effects.resolvePlan(this.dataRoot) === null
    );
  }

  /**
   * What an install would put on a machine now: this server's pushed state, else the image
   * its release shipped, else the checkout's last image.
   */
  #plan(): PushPlan | null {
    const pushed = this.#effects.resolvePlan(this.dataRoot);
    if (pushed !== null) return pushed;
    if (this.#shipped !== null) return this.#shipped.plan();
    return this.#checkout?.plan() ?? null;
  }

  /** #plan, with a shipped image laid down first if it is not yet. */
  async #readyPlan(): Promise<PushPlan | null> {
    if (this.#effects.resolvePlan(this.dataRoot) === null && this.#shipped !== null) {
      const unlaid = this.#shipped.plan() === null;
      await this.#shipped.ready();
      // The page learns the version it names only now.
      if (unlaid) this.#changed();
    }
    return this.#plan();
  }

  /**
   * What the jobs of one batch install. A pushed server's plan is fixed; a release's shipped
   * image is laid down by the first job that needs it, once; a checkout builds
   * its image from the source as the batch finds it, once for the whole batch — the first job
   * to ask starts the build, the others hear it out, and a job that starts after it is done
   * takes its result rather than building again — and each job holds that image until its
   * work is done. Null when this server has nothing to install and no checkout to build it
   * from.
   */
  #imageForBatch(): WithImage | null {
    const installed = this.#effects.resolvePlan(this.dataRoot);
    if (installed !== null) return (_say, work) => work({ plan: installed, assets: this.#assets });
    const shipped = this.#shipped;
    if (shipped !== null) {
      return async (say, work) => {
        const unlaid = shipped.plan() === null;
        if (unlaid) say("Unpacking the install image this release ships…");
        const ready = await shipped.ready();
        if (!ready.ok) {
          return {
            ok: false,
            step: "prepare the install image",
            message: ready.detail,
            // This server's own lack: installing the program anyway would send nothing new.
            canReplaceProgram: false,
          };
        }
        if (unlaid) this.#changed();
        return work({ plan: ready.plan, assets: this.#assets });
      };
    }
    const checkout = this.#checkout;
    if (checkout === null) return null;
    let built: CheckoutBuild | null = null;
    return async (say, work) => {
      if (built === null) {
        say("Building the install image from this checkout…", "build");
        built = await checkout.build((line) => say(line));
      }
      if (!built.ok) {
        return {
          ok: false,
          step: "build the install image",
          message: built.detail,
          // This server's own lack: installing the program anyway would send nothing new.
          canReplaceProgram: false,
        };
      }
      const { plan } = built;
      // The installers this image was packed with travel in it.
      const assets = imageAssets(plan);
      // Held while the job works: the copy comes after the far side has downloaded its
      // release, and the builds other batches run meanwhile must not prune the image.
      return checkout.holding(plan, () => work({ plan, assets: () => assets }));
    };
  }

  /**
   * Checks a machine without writing anything there (machines/diagnose.ts): can this server
   * sign in, is it a platform a release exists for, does it have what the installer runs,
   * can it download the release itself, is there room, is the port free. Refused while a job
   * works on that machine — the checks would queue behind the job's commands on its session.
   */
  async diagnose(address: string): Promise<MachineDiagnosis | "unknown-machine" | "self" | "busy"> {
    const machine = this.#allMachines().find((entry) => entry.id === address);
    if (machine === undefined) return "unknown-machine";
    if (machine.local || (machine.machineId !== null && machine.machineId === this.#machineId)) {
      return "self";
    }
    if (this.#busy.has(address)) return "busy";
    return this.#diagnoseNow(machine);
  }

  /**
   * The connection check itself, for a machine nothing else is working on — asked for by the API,
   * run after a job failed at a step it can explain, and after a machine kept connected failed to
   * come back three times in a row.
   */
  async #diagnoseNow(machine: MachineInfo): Promise<MachineDiagnosis> {
    const address = machine.id;
    const target = this.#targetOf(machine.alias);
    const checkedAt = this.#effects.now().toISOString();
    const done = (checks: MachineCheck[]): MachineDiagnosis => ({
      machineId: address,
      checkedAt,
      checks,
    });
    const skipped = (["tools", "download", "disk", "port"] as const).map((id): MachineCheck => ({
      id,
      state: "skip",
    }));
    const signIn = this.#signIn(target);
    const probe = await this.#effects.runOn(target, posixProbe(this.#layout));
    let identity = probe.code === 0 ? parseProbeOutput(probe.stdout) : null;
    if (identity === null) {
      if (probe.code !== 0 && explainSshFailure(probe.stdout, target.alias, signIn) !== null) {
        return done(sshFailureChecks(probe.stdout, target.alias, signIn));
      }
      // No POSIX answer and no ssh refusal: a Windows shell, or a platform with no release.
      const detected = await this.#effects.detect(target, this.#layout);
      if ("error" in detected) {
        if (explainSshFailure(detected.error, target.alias, signIn) !== null) {
          return done(sshFailureChecks(detected.error, target.alias, signIn));
        }
        return done([
          { id: "ssh", state: "pass", user: "", host: "" },
          {
            id: "platform",
            state: "fail",
            reason: "unsupported",
            said: probe.stdout.trim().slice(0, 600),
          },
          ...skipped,
        ]);
      }
      identity = detected.identity;
    }
    // The release the image stands on: this install's own, or a checkout's VERSION.
    const version =
      this.#effects.resolvePlan(this.dataRoot)?.baseVersion ??
      this.#effects.shippedImage?.baseVersion ??
      (this.#checkout === null ? null : VERSION);
    const port = this.repo.get(address)?.remotePort ?? this.#layout.defaultPort;
    if (identity.platform === "win32") return done(parseDiagnosis(identity, "", { version, port }));
    const answer = await this.#effects.runOn(target, diagnoseCommand(this.#layout, version, port));
    return done(parseDiagnosis(identity, answer.stdout, { version, port }));
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
   * The machines a Project uses that this server installed on and knows by id, each with a
   * client to its own API while it is connected (null otherwise) — for a page of this server
   * that lists what those machines hold (the archive page). Every call carries this server's
   * adoption time, as the proxy's do. Two aliases for one machine are one entry, spoken to
   * through the alias holding a connection.
   */
  async projectApis(
    projectId: string,
  ): Promise<Array<{ machineId: string; alias: string; api: MachineApi | null }>> {
    const ids = new Set<string>();
    for (const address of this.#members(projectId)) {
      const row = this.repo.get(address);
      if (row !== null && row.machineId !== null && row.version !== null) ids.add(row.machineId);
    }
    const out: Array<{ machineId: string; alias: string; api: MachineApi | null }> = [];
    for (const machineId of ids) {
      const row = this.#rowFor(machineId);
      if (row === null) continue;
      const dial = await this.#dial(row.address);
      out.push({
        machineId,
        alias: row.address.slice("ssh:".length),
        api:
          dial === null
            ? null
            : machineApi(
                dial.agent,
                dial.port,
                dial.cookie,
                row.adoptedAt === null ? {} : { [ADOPTED_AT_HEADER]: row.adoptedAt },
              ),
      });
    }
    return out;
  }

  /**
   * What the proxy needs to forward a request to a machine addressed by its OWN id: a dial
   * through the connection, the port its server is on over there, a session there, and when
   * this server adopted it (sent along, so that machine reads the Sessions it held before then
   * as CLI tasks). Null when the machine is not connected.
   */
  async proxyTarget(machineId: string): Promise<ProxyTarget | null> {
    const row = this.#rowFor(machineId);
    if (row === null) return null;
    const dial = await this.#dial(row.address);
    return dial === null ? null : { ...dial, adoptedAt: row.adoptedAt };
  }

  /**
   * A dial to a machine's server by its address: through the connection held to it, to the port
   * its server was last bound to, with a session there. Null when it is not connected — or when
   * no session can be had, which leaves nothing to call it with either.
   */
  async #dial(address: string): Promise<(RelayDial & { session: number }) | null> {
    const row = this.repo.get(address);
    const live = this.#liveSession(address);
    if (row === null || row.remotePort === null || live === null) return null;
    const target = this.#targetOf(address.slice("ssh:".length));
    const session = await this.#sessionOn(target);
    if (!("cookie" in session)) return null;
    return {
      agent: this.#effects.agent(target, row.remotePort),
      port: row.remotePort,
      cookie: session.cookie,
      // The socket relay reuses a socket only within one ssh session (socket-relay.ts).
      session: live.pid,
    };
  }

  /**
   * The subdirectories of `dir` on a machine, over the HELD connection — so picking a
   * workspace on it costs one command and no round trip to its API. Null when the machine is
   * not connected: a read must not open ssh on its own, or a disconnected machine would be
   * reconnected by whoever browsed it. `"denied"` when the directory is there and may not be
   * read — told apart from absence so the picker can say which it is.
   */
  async listDirs(
    machineId: string,
    dir: string,
  ): Promise<
    | {
        path: string;
        parent: string | null;
        entries: { name: string; path: string }[];
      }
    | "denied"
    | null
  > {
    const row = this.#rowFor(machineId);
    if (row === null || this.#liveSession(row.address) === null) return null;
    const target = this.#targetOf(row.address.slice("ssh:".length));
    const result = await this.#effects.runOn(target, listDirsCommand(dir));
    // listDirsCommand's exit 4: the directory exists and refused the listing.
    if (result.code === 4) return "denied";
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
    // A machine a job is working on is left to the job: its commands would queue behind the
    // job's on its one session, and the round — and the page's request waiting on it — with them.
    const queue = this.list(projectId).filter(
      (m) => !m.local && m.installed !== null && !this.#busy.has(m.id),
    );
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
    const before = this.#statuses.get(address);
    this.#statuses.set(address, {
      state: state.kind,
      checkedAt: this.#effects.now().toISOString(),
      ...(state.kind === "running" ? { port: state.port } : {}),
      ...(state.kind === "unreachable" ? { detail: state.detail } : {}),
    });
    this.#rememberMachineId(address, probe.machineId);
    const port = state.kind === "running" ? state.port : undefined;
    if (before?.state !== state.kind || before.port !== port) this.#changed();
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
   *
   * A different machine is also newly adopted: its adoption time is now (see `#record`). The
   * first id a machine gives is not an adoption — the row already says when this server took
   * the machine up, or that it took it up before adoption times were kept, and either stays.
   */
  #rememberMachineId(address: string, machineId: string | null): void {
    if (machineId === null) return;
    const known = this.repo.get(address)?.machineId ?? null;
    if (known === machineId) return;
    if (known === null) {
      this.#record(address, { machineId });
      return;
    }
    this.#record(address, {
      machineId,
      version: null,
      installedAt: null,
      remotePort: null,
      platform: null,
      adoptedAt: this.#effects.now().toISOString(),
    });
  }

  /**
   * Writes what this server learned about a machine. The write that creates its row is the moment
   * this server adopted the machine, and the time is kept with it: nothing could have been
   * created there through this server before, so the Sessions that machine already held are its
   * own (runtime/session-sources.ts sourceSeenBy reads them as CLI tasks for this server's
   * requests, see `proxyTarget`). A row from before adoption times were kept has none, and no
   * later write gives it one: the Sessions on such a machine stay as they were (user decision,
   * 2026-10-15).
   */
  #record(address: string, patch: Parameters<MachinesRepo["patch"]>[1]): void {
    const adoption =
      this.repo.get(address) === null ? { adoptedAt: this.#effects.now().toISOString() } : {};
    this.repo.patch(address, { ...adoption, ...patch });
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
      this.#layout,
      this.#effects.runOn,
      this.repo.get(address)?.platform ?? null,
    );
  }

  /**
   * What a failure ssh itself caused — a host key, a key, a name, a route — adds to the job's
   * result: why, for the page to say in its own language, and no offer to install the program
   * anyway (`canReplaceProgram`). An install reaches the machine through the same ssh and
   * would stop at the same door, so the offer would be a second way to fail rather than a way
   * out.
   */
  #sshCause(
    target: RemoteTarget,
    message: string,
  ): { canReplaceProgram?: false; sshReason?: SshFailureReason } {
    const failure = explainSshFailure(message, target.alias, this.#signIn(target));
    return failure === null ? {} : { canReplaceProgram: false, sshReason: failure.reason };
  }

  /**
   * Whether ssh lets this server in at all, asked before anything else a job does — before a
   * checkout spends a minute building its image for a machine that refuses the key. One `:`
   * over the session, which the work after it reuses. Null when it gets in, or when the
   * answer is the far side's own (a Windows shell has no `sh`: the work finds that out); the
   * job's failure when ssh itself refused, at the first step — checking the machine.
   */
  async #refusedAtTheDoor(machine: MachineInfo): Promise<MachineJob["result"] | null> {
    const target = this.#targetOf(machine.alias);
    const answer = await this.#effects.runOn(target, ":");
    const refused =
      answer.code === 0 ? null : sshRefusal(answer.stdout, target.alias, this.#signIn(target));
    return refused === null
      ? null
      : { ok: false, step: "check", message: refused, ...this.#sshCause(target, refused) };
  }

  /**
   * Whether the machine already carries the build `plan` names, asked of the machine: the
   * version names the platform bundle only, so an image whose web, CLI or assets changed reads
   * as the version the machine is recorded at. One probe over the session. Unknown — no answer,
   * a Windows shell — reads as current, which is what the record said.
   */
  async #carries(target: RemoteTarget, plan: PushPlan): Promise<boolean> {
    if (plan.harness === null) return true;
    const answer = await this.#effects.runOn(target, posixProbe(this.#layout));
    const identity = answer.code === 0 ? parseProbeOutput(answer.stdout) : null;
    return identity === null || sameBuild(identity.harness, plan.harness);
  }

  // --- jobs ---------------------------------------------------------------------------------

  /**
   * Queues a job. Up to CONCURRENCY machines are worked on at once — different hosts, so
   * their ssh sessions and transfers do not contend — and one job per machine at a time; the
   * rest wait in order, and each job knows whether it is waiting or working. Failures land
   * in the job; nothing here throws.
   */
  #startJob(
    kind: MachineJob["kind"],
    machine: MachineInfo,
    /** The steps this job goes through, in order: what the page draws as its stepper. */
    steps: MachinePhase[],
    /**
     * Whether a failure offers installing the program anyway. Every failed install or
     * connect does — a failure that leaves no next step leaves a person stuck — except a
     * run that was itself that install, and a result that withholds it (`canReplaceProgram:
     * false`, this server having nothing to send). Never taken on the page's own
     * initiative: it stops a server other people may be using.
     */
    opts: { offerReplaceProgram: boolean },
    work: (say: Say) => Promise<MachineJob["result"]>,
  ): void {
    const job: MachineJob = {
      kind,
      machineId: machine.id,
      alias: machine.alias,
      queued: true,
      running: false,
      steps,
      phase: null,
      log: [],
      result: null,
    };
    // One row per machine: a machine queued twice keeps the later ask (the earlier one is
    // dropped from the queue), and a finished job is replaced by the next one on the same
    // machine. A job already running is left to finish; the new one waits behind it.
    const waiting = this.#queue.findIndex((entry) => entry.job.machineId === machine.id);
    if (waiting !== -1) this.#queue.splice(waiting, 1);
    this.#jobs.set(machine.id, job);
    this.#queue.push({ job, opts, work });
    this.#changed();
    this.#drain();
  }

  /** How many jobs are working right now. */
  #runningCount(): number {
    let n = 0;
    for (const job of this.#jobs.values()) if (job.running) n += 1;
    return n;
  }

  /**
   * Whether a machine is taken — a job running or queued for it, or the automatic work (a
   * reconnect, the boot's hand-over) on it. The single verbs refuse such a machine with 409;
   * other machines are not held up by it.
   */
  #machineBusy(address: string): boolean {
    return this.#busy.has(address) || this.#queue.some((entry) => entry.job.machineId === address);
  }

  /**
   * Starts queued jobs until CONCURRENCY are working, oldest first, passing over a job whose
   * machine is already being worked on — it starts when that work ends, which drains again.
   */
  #drain(): void {
    while (this.#runningCount() < CONCURRENCY) {
      const index = this.#queue.findIndex((entry) => !this.#busy.has(entry.job.machineId));
      if (index === -1) return;
      const [next] = this.#queue.splice(index, 1);
      void this.#run(next!.job, next!.opts, next!.work);
    }
  }

  async #run(
    job: MachineJob,
    opts: { offerReplaceProgram: boolean },
    work: (say: Say) => Promise<MachineJob["result"]>,
  ): Promise<void> {
    job.queued = false;
    job.running = true;
    this.#job = job;
    // Every line is news to whoever watches the page. A step only moves forward: work shared
    // between verbs names the step it is on from where it stands in its own pipeline — the
    // probe a connect opens with is "check" on its own, and behind an install it is already
    // part of connecting.
    const say: Say = (line, phase) => {
      job.log.push(line);
      if (phase !== undefined) {
        const next = job.steps.indexOf(phase);
        const now = job.phase === null ? -1 : job.steps.indexOf(job.phase);
        if (next > now) job.phase = phase;
      }
      this.#changed();
    };
    this.#changed();
    try {
      this.#busy.add(job.machineId);
      job.result = await work(say);
    } catch (err) {
      job.result = {
        ok: false,
        step: job.kind,
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (
        opts.offerReplaceProgram &&
        job.result?.ok === false &&
        job.result.canReplaceProgram === undefined
      ) {
        job.result = { ...job.result, canReplaceProgram: true };
      }
      this.#busy.delete(job.machineId);
      job.running = false;
      this.#changed();
    }
    this.#afterJob(job);
    this.#drain();
  }

  /**
   * What a finished job leaves to do. A machine kept connected that the job left without its
   * connection — a restart that did not come back, a failed update — is brought back like any
   * machine that was lost. A job that failed at a step a connection check can explain gets one,
   * run as soon as the machine is free.
   */
  #afterJob(job: MachineJob): void {
    const address = job.machineId;
    if (this.#keepsConnected(address) && !this.#isUp(address)) this.#lost(address, 0);
    const result = job.result;
    if (
      result === null ||
      result.ok ||
      !["use", "install", "connect"].includes(job.kind) ||
      !(DIAGNOSABLE_STEPS.has(result.step) || result.sshReason !== undefined)
    ) {
      return;
    }
    const machine = this.#allMachines().find((entry) => entry.id === address);
    if (machine === undefined) return;
    job.diagnosis = { state: "running" };
    this.#changed();
    void this.#withMachine(address, () => this.#diagnoseNow(machine)).then(
      (diagnosis) => {
        // Something else took the machine first (a retry): the check can wait for its outcome.
        if (diagnosis === null) delete job.diagnosis;
        else job.diagnosis = { state: "done", ...diagnosis };
        this.#changed();
      },
      () => {
        delete job.diagnosis;
        this.#changed();
      },
    );
  }

  /** The queued, the running and the last finished job per machine — what the page lists. */
  jobs(): MachineJob[] {
    return [...this.#jobs.values()];
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
     * Install the program even when its version already matches, and restart it. Every
     * failed job offers it (see `canReplaceProgram`); never taken on the page's own
     * initiative, because it stops a server other people may be using.
     */
    replaceProgram = false,
  ): Promise<{ ok: true } | { ok: false; why: InstallRefusal }> {
    if (this.#machineBusy(address)) return { ok: false, why: "busy" };
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
    const withImage = this.#imageForBatch();
    if (withImage === null) return { ok: false, why: "no-image" };

    this.#startJob(
      "install",
      machine,
      [...this.#buildStep(), "check", "install", "handover", "restart"],
      { offerReplaceProgram: !replaceProgram },
      async (say) =>
        (await this.#refusedAtTheDoor(machine)) ??
        withImage(say, (image) =>
          this.#installWork(projectId, machine, image, replaceProgram, say),
        ),
    );
    return { ok: true };
  }

  /** The install as one run: probe, install, hand over, restart, record — the body every install job runs. */
  async #installWork(
    projectId: string,
    machine: MachineInfo,
    { plan, assets }: { plan: PushPlan; assets: () => string | null },
    replaceProgram: boolean,
    say: Say,
  ): Promise<MachineJob["result"]> {
    const address = machine.id;
    const target = this.#targetOf(machine.alias);
    say(`Installing ${plan.version} on ${machineIdentity(target.alias, target.user)}…`, "check");
    // Only the machine can say whether this alias is this host under another name.
    // Unreachable is not a refusal — a host with nothing installed yet answers exactly
    // that — this server's own id is.
    const heard = await this.#effects.probe(target, this.#layout, this.#effects.runOn, null);
    this.#rememberMachineId(address, heard.machineId);
    if (heard.machineId !== null && heard.machineId === this.#machineId) {
      return {
        ok: false,
        step: "connect",
        message:
          "That alias reaches this very machine — it answered with this server's own id. A server does not push this build over the program directory it is running from.",
      };
    }
    say("Putting the program there…", "install");
    const outcome = await this.#effects.install({
      target,
      plan,
      onProgress: say,
      assets,
      layout: this.#layout,
      carryRelease: this.#effects.carryRelease,
      ...(replaceProgram ? { forceInstaller: true } : {}),
    });
    if (outcome.kind === "failed") {
      return {
        ok: false,
        step: outcome.step,
        message: outcome.detail,
        ...this.#sshCause(target, outcome.detail),
      };
    }
    // What the machine is, before anything below asks it again: the hand-over and the
    // restart both probe, and they should already speak its dialect.
    this.#record(address, { platform: outcome.identity.platform });
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
      say("Handing this build to its own update channel…", "handover");
      const pushed = await this.#handOverBuild(address, target, plan, say);
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
          // Installing anyway — every failed job's offer (#startJob) — is what replicates
          // the store the update channel needs; withheld for `no-build`, this server's own
          // lack, which installing would not mend.
          ...(pushed.kind === "no-build" ? { canReplaceProgram: false as const } : {}),
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
    this.#record(address, { version, installedAt: this.#effects.now().toISOString() });
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
  }

  /**
   * Adds a host to this server's ssh config, so it can be enabled like any other — with the
   * password it signs in with when one is given, stored here and never in the config. The block
   * and the password are checked before anything is written, and an alias the config already
   * declares is refused rather than shadowed: ssh takes the first block that matches, so a second
   * one would be silently ignored and the person would wonder why their edit did nothing.
   */
  async addSshHost(
    entry: SshHostEntry,
    password?: string,
  ): Promise<{ ok: true } | HostRefusal | { ok: false; why: "exists" }> {
    const problem = validateHostEntry(entry);
    if (problem !== null) return { ok: false, why: "invalid", problem };
    const refused = password === undefined ? null : await this.#passwordRefusal(password);
    if (refused !== null) return refused;
    const alias = entry.alias.trim();
    if (this.#effects.listAliases().includes(alias)) return { ok: false, why: "exists" };
    this.#effects.appendHost(renderHostBlock(entry, this.#effects.now()));
    if (password !== undefined) this.#setPassword(alias, password);
    return { ok: true };
  }

  /**
   * A host's block as the page can show it back: what it says, whether this app wrote it — only
   * then may the page rewrite it; a hand-written block may carry options this app does not know
   * (a jump host, a key agent setting), and rewriting it would drop them — and whether a password
   * is stored for it. Never the password.
   */
  sshHost(
    alias: string,
  ): { entry: SshHostEntry; editable: boolean; passwordSaved: boolean } | null {
    const text = this.#effects.readConfig();
    if (text === null) return null;
    const found = findHostBlock(text, alias);
    return found === null
      ? null
      : { entry: found.entry, editable: found.ours, passwordSaved: this.#passwords.has(alias) };
  }

  /**
   * Rewrites, in place, a block this app wrote — the alias stays, everything else is the new
   * entry — and sets how the host signs in: `password` a string stores it, null deletes the stored
   * one (back to keys), absent leaves it. A hand-written block is never rewritten, but its
   * password may still be set while the entry sent is the block as it stands.
   */
  async updateSshHost(
    alias: string,
    entry: Omit<SshHostEntry, "alias">,
    password?: string | null,
  ): Promise<
    { ok: true } | HostRefusal | { ok: false; why: "not-found" } | { ok: false; why: "foreign" }
  > {
    const next: SshHostEntry = { ...entry, alias };
    const text = this.#effects.readConfig();
    if (text === null) return { ok: false, why: "not-found" };
    const found = findHostBlock(text, alias);
    if (found === null) return { ok: false, why: "not-found" };
    const rewrite = !sameHostEntry(found.entry, next);
    if (rewrite) {
      if (!found.ours) return { ok: false, why: "foreign" };
      const problem = validateHostEntry(next);
      if (problem !== null) return { ok: false, why: "invalid", problem };
    }
    const refused = typeof password === "string" ? await this.#passwordRefusal(password) : null;
    if (refused !== null) return refused;
    if (rewrite) {
      this.#effects.writeConfig(
        replaceHostBlock(text, found, renderHostBlock(next, this.#effects.now())),
      );
    }
    if (password !== undefined) this.#setPassword(alias, password);
    return { ok: true };
  }

  /** Why `password` cannot be stored: not one line, or an ssh here that cannot be handed it. */
  async #passwordRefusal(password: string): Promise<HostRefusal | null> {
    const problem = passwordProblem(password);
    if (problem !== null) return { ok: false, why: "password-invalid", problem };
    const plan = await this.#effects.passwordSignIn();
    return plan.ok
      ? null
      : { ok: false, why: "password-unsupported", detail: plan.detail, ssh: plan.ssh };
  }

  /** Stores (or with null deletes) the password `alias` signs in with. */
  #setPassword(alias: string, password: string | null): void {
    if (password === null) {
      if (!this.#passwords.remove(alias)) return;
    } else {
      this.#passwords.save(alias, password);
    }
    this.#passwordChanged(alias);
  }

  /**
   * A machine's password was saved or deleted: what was refused before may be tried again. A
   * machine kept connected that stopped retrying on a refusal is tried once, now.
   */
  #passwordChanged(alias: string): void {
    forgetRefusal(alias);
    const address = `ssh:${alias}`;
    const state = this.#reconnects.get(address);
    this.#changed();
    if (state?.waitsForPassword !== true) return;
    delete state.waitsForPassword;
    state.nextAt = this.#effects.now().getTime();
    this.#schedule(address, 0);
  }

  /**
   * Brings machines into use, as one queued batch: for each, install (or bring the build
   * forward) if the record says it is not on this server's build, then connect and hand it
   * the Project config — the whole of what a person means by "use this machine", as one job
   * per machine, one after another. Refusals decidable without ssh are answered by id, so
   * the page can say them; everything else is queued and reported through `jobs`.
   */
  startUse(
    projectId: string,
    addresses: readonly string[],
    replaceProgram = false,
  ): { refused: { machineId: string; why: MachineUseRefusal }[] } {
    const refused: { machineId: string; why: MachineUseRefusal }[] = [];
    const withImage = this.#imageForBatch();
    for (const address of new Set(addresses)) {
      const machine = this.#allMachines().find((entry) => entry.id === address);
      if (machine === undefined) {
        refused.push({ machineId: address, why: "unknown-machine" });
        continue;
      }
      if (machine.local || (machine.machineId !== null && machine.machineId === this.#machineId)) {
        refused.push({ machineId: address, why: "self" });
        continue;
      }
      if (withImage === null) {
        refused.push({ machineId: address, why: "no-image" });
        continue;
      }
      // On the Project's list from the moment it is asked for, so its card shows the job — and
      // keeps showing a first install that failed, with its Retry, rather than vanishing with it.
      this.#setMember(projectId, address, true);
      this.#startJob(
        "use",
        machine,
        [...this.#buildStep(), "check", "install", "handover", "restart", "connect", "sync"],
        { offerReplaceProgram: !replaceProgram },
        async (say) =>
          (await this.#refusedAtTheDoor(machine)) ??
          withImage(say, (image) => this.#useWork(projectId, address, image, replaceProgram, say)),
      );
    }
    return { refused };
  }

  /** One machine's "use": install where the record says the build is missing or different, then connect. */
  async #useWork(
    projectId: string,
    address: string,
    image: { plan: PushPlan; assets: () => string | null },
    replaceProgram: boolean,
    say: Say,
  ): Promise<MachineJob["result"]> {
    const { plan } = image;
    // Read at run time, not at queue time: a batch's later rows see what the earlier ones did.
    const machine = this.#allMachines().find((entry) => entry.id === address);
    if (machine === undefined) {
      return { ok: false, step: "use", message: "that host is no longer in the ssh config." };
    }
    let needsInstall =
      replaceProgram || machine.installed === null || machine.installed.version !== plan.version;
    if (!needsInstall && this.repo.get(address)?.platform !== "win32") {
      // Same version, maybe not the same build: a web, CLI or asset change keeps the version.
      needsInstall = !(await this.#carries(this.#targetOf(machine.alias), plan));
    }
    if (needsInstall) {
      const installed = await this.#installWork(projectId, machine, image, replaceProgram, say);
      if (installed !== null && !installed.ok) return installed;
    } else {
      say(`Already on ${plan.version}.`, "check");
      // The Project that asked is the Project that uses it, install or no install.
      this.#setMember(projectId, address, true);
    }
    // A Windows machine has no shell to hold a session on (see startConnect): installed is
    // as far as "use" goes there, and the page says so from the platform on record.
    if (this.repo.get(address)?.platform === "win32") {
      return { ok: true, installed: "already-installed", version: plan.version };
    }
    const fresh = this.#allMachines().find((entry) => entry.id === address) ?? machine;
    // Behind an install, asking what runs there is already part of connecting.
    return this.#connect(fresh, say, needsInstall ? "connect" : "check", plan);
  }

  /**
   * Lets go of machines: the connection is dropped and the Project stops listing them. The
   * install over there stays — another Project may use it, and "stop using" is not "wipe".
   * With the record's held mark cleared, nothing re-holds them on the next boot either.
   */
  stopUsing(projectId: string, addresses: readonly string[]): void {
    for (const address of new Set(addresses)) {
      this.disconnect(address);
      this.release(projectId, address);
      // No Project here uses it any more: the password it signed in with goes with it.
      if (this.#projectsUsing(address).length === 0) {
        this.#setPassword(address.slice("ssh:".length), null);
      }
      // A finished job is what keeps a card for a machine that never got as far as an install
      // (the page shows every machine with a job): letting it go lets that card go too.
      const job = this.#jobs.get(address);
      if (job !== undefined && !job.queued && !job.running) this.#jobs.delete(address);
    }
  }

  /**
   * Brings a machine's server up and holds the connection to it, as a job — a start plus a
   * readiness wait is minutes in the bad case. Every step is idempotent, so a repeat is safe.
   */
  async startConnect(address: string): Promise<{ ok: true } | { ok: false; why: ConnectRefusal }> {
    if (this.#machineBusy(address)) return { ok: false, why: "busy" };
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
    this.#startJob(
      "connect",
      machine,
      ["check", "connect", "sync"],
      { offerReplaceProgram: true },
      async (say) => this.#connect(machine, say, "check", await this.#readyPlan()),
    );
    return { ok: true };
  }

  /**
   * A person's Retry on a machine this server keeps connected: an attempt now, whatever the
   * streak's schedule says. A streak that is waiting skips the rest of its wait and keeps its
   * count; one that stopped (`gaveUp`) begins again from the first attempt, its last failure
   * and check still said until the new attempt answers; a machine that is down with no streak
   * yet begins one. An attempt already running, or a machine that is up, is left alone, so a
   * second press starts no second attempt. Refused before anything runs: while a job is queued
   * or running for it (the job decides how it ends), while its stored password is refused (a
   * try could lock the account; saving a password tries again), and for a machine not kept
   * connected (nothing to bring back — Start it).
   */
  retryReconnect(address: string): RetryReconnectAnswer {
    const machine = this.#allMachines().find((entry) => entry.id === address);
    if (machine === undefined || machine.local) return { ok: false, why: "unknown-machine" };
    const job = this.#jobs.get(address);
    if (job !== undefined && (job.queued || job.running)) return { ok: false, why: "busy" };
    if (!this.#keepsConnected(address)) return { ok: false, why: "not-kept" };
    const state = this.#reconnects.get(address);
    if (state === undefined) {
      if (this.#isUp(address)) return { ok: true, started: false };
      this.#lost(address, 0);
    } else if (state.waitsForPassword === true) {
      return { ok: false, why: "password" };
    } else if (state.gaveUp !== undefined) {
      const now = this.#effects.now().getTime();
      state.since = now;
      state.attempts = 0;
      state.nextAt = now;
      delete state.gaveUp;
      // The new streak checks the machine again after its own third failure.
      state.diagnosedFor = null;
    } else if (state.nextAt === null) {
      return { ok: true, started: false };
    } else {
      state.nextAt = this.#effects.now().getTime();
    }
    this.#tryNow(address);
    return { ok: true, started: true };
  }

  async #connect(
    machine: MachineInfo,
    say: Say,
    /**
     * The step asking what runs there belongs to: `check` for a connect of its own, `connect`
     * behind an install, where the machine has already been checked.
     */
    askPhase: "check" | "connect",
    /**
     * What that machine must run before anything is handed to it: the image an install just put
     * there, or this server's own plan; null when this server has none to compare with.
     */
    expected: PushPlan | null,
  ): Promise<MachineJob["result"]> {
    const address = machine.id;
    const target = this.#targetOf(machine.alias);

    // Asked even when the connection is already up: it is an ssh process on THIS side,
    // and it outlives the far server. Taking it as the answer reported "connected" over a
    // dead server — and every caller that then found the machine silent asked for another
    // connect, which said "already connected" again, forever. Reconnecting (to retry a sync
    // that failed, or pick up a new key) now costs one probe and stays honest.
    say("Asking what is running there…", askPhase);
    const probed = await this.#probe(address, target);
    this.#recordProbe(address, probed);
    if (probed.state.kind === "unreachable") {
      // The same dead end an install reaches, and the same way out — installing anyway,
      // which every failed job offers (#startJob): the machine cannot answer because the
      // CLI in its store is not one this server can talk to, and the installer replaces it.
      // Unless ssh itself got nowhere: then an install would stop at the same door.
      return {
        ok: false,
        step: "connect",
        message: probed.state.detail,
        ...this.#sshCause(target, probed.state.detail),
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
      remotePort = this.repo.get(address)?.remotePort ?? this.#layout.defaultPort;
      say(`Starting its server on port ${remotePort}…`, "connect");
      const started = await this.#effects.startServer(target, remotePort);
      if (!started.ok) {
        return {
          ok: false,
          step: "start its server",
          message: started.detail,
          // Another program's port is not something installing the program frees.
          ...(started.portTaken === true ? { canReplaceProgram: false as const } : {}),
        };
      }
      // A machine mints its id when its server starts, so one that was down had none — and
      // its port and pid are now the freshest fact about it. The port is taken from what the
      // machine says, not from what was asked for: the two differ when an earlier, slower
      // start is the server that answered.
      const after = await this.#probe(address, target);
      this.#recordProbe(address, after);
      if (after.state.kind === "running") remotePort = after.state.port;
    }

    // Whatever answers on that port gets this server's Project config next, and a server of
    // another build may not read it: an Agent there then fails at its first Session. So it is
    // asked what it runs first, and brought in line before anything is handed over.
    const lined = await this.#inLine(address, target, remotePort, expected, say);
    if (!lined.ok) return { ok: false, step: "sync", message: lined.message };
    remotePort = lined.port;

    say("Opening the connection…", "connect");
    const connection = await this.#connection(address, target);
    if (!connection.ok) {
      return {
        ok: false,
        step: "connect",
        message: connection.detail,
        ...this.#sshCause(target, connection.detail),
      };
    }
    this.#record(address, { remotePort });
    say(`Connected; its server is on port ${remotePort} over there.`);
    // An Agent started over there resolves its model, its command policy and its defaults
    // against THAT machine's config, so a machine without ours is connected and unusable.
    say("Handing over the Project config…", "sync");
    await this.#syncConfig(
      address,
      target,
      remotePort,
      say,
      this.#projectsUsing(address),
      lined.unasked,
    );
    // Connected, by whichever way it came — a job or the supervision's own attempt: a streak of
    // reconnecting that was under way is over.
    this.#settle(address);
    this.#changed();
    return { ok: true, connected: true };
  }

  /**
   * Makes the server answering on a machine's port the one to hand this server's Project config
   * to, or says why it is not:
   *
   * - a server that does not run the build on its disk ({@link RunningBuild.foreign}: say a
   *   release's own server started on that root) is restarted onto that build, the way a
   *   restart after an install is;
   * - a server on a build other than `expected` is given `expected` through its update channel,
   *   as the boot-time sweep does (syncOutOfDate).
   *
   * Either step that cannot be done ends here with a plain sentence, and nothing is handed over:
   * a config written for one build and read by another is how every Session there fails. A
   * server that cannot be asked at all is connected all the same (as it was before this check:
   * the hand-over would fail at the same door), and `unasked` says why nothing is handed to it.
   *
   * `mend` false only checks: a server on another build is refused with the same sentence and
   * nothing is done to it — what a Sync config job asks, which is not an update.
   */
  async #inLine(
    address: string,
    target: RemoteTarget,
    port: number,
    expected: PushPlan | null,
    say: Say,
    mend = true,
  ): Promise<{ ok: true; port: number; unasked?: string } | { ok: false; message: string }> {
    // The steps below are this connect's, not jobs of their own: their lines, not their phases.
    const tell: Say = (line) => say(line);
    let asked = await this.#askBuild(target, port);
    if (!asked.ok) {
      return {
        ok: true,
        port,
        unasked: `could not ask that machine what it runs: ${asked.detail}`,
      };
    }
    if (asked.build.foreign && !mend) return { ok: false, message: mustUpdate(asked.build) };
    if (asked.build.foreign) {
      say(
        `Its server runs ${asked.build.release}, not the build installed there; restarting it onto that build…`,
      );
      const restarted = await this.#restartServer(address, target, tell);
      if (!restarted.ok) {
        return {
          ok: false,
          message: `${mustUpdate(asked.build)} Its restart failed: ${restarted.detail}`,
        };
      }
      port = restarted.port;
      asked = await this.#askBuild(target, port);
      if (!asked.ok) {
        return {
          ok: false,
          message: `${mustUpdate(null)} It did not answer after its restart: ${asked.detail}`,
        };
      }
      if (asked.build.foreign) return { ok: false, message: mustUpdate(asked.build) };
    }
    if (expected === null || runsPlan(asked.build, expected)) return { ok: true, port };
    if (!mend) return { ok: false, message: mustUpdate(asked.build, expected.version) };

    say(`It runs ${asked.build.version}; bringing it to ${expected.version} first…`);
    const handOver = () => this.#handOverBuild(address, target, expected, tell);
    const outcome = await (this.#checkout?.holding(expected, handOver) ?? handOver());
    if (outcome.kind === "upgraded" && outcome.persisted) {
      this.#record(address, {
        version: expected.version,
        installedAt: this.#effects.now().toISOString(),
      });
      asked = await this.#askBuild(target, port);
      if (asked.ok && !asked.build.foreign && runsPlan(asked.build, expected)) {
        return { ok: true, port };
      }
    }
    const why =
      outcome.kind === "refused" || outcome.kind === "failed"
        ? ` It did not take this build: ${outcome.detail}`
        : outcome.kind === "upgraded" && !outcome.persisted
          ? " It took this build but could not write it to its disk."
          : "";
    return {
      ok: false,
      message: `${mustUpdate(asked.ok ? asked.build : null, expected.version)}${why}`,
    };
  }

  /** What a machine's server says it runs (its GET /api/version, asked as its admin). */
  async #askBuild(
    target: RemoteTarget,
    port: number,
  ): Promise<{ ok: true; build: RunningBuild } | { ok: false; detail: string }> {
    const session = await this.#sessionOn(target);
    if (!("cookie" in session)) return { ok: false, detail: session.detail };
    try {
      const answer = await machineApi(
        this.#effects.agent(target, port),
        port,
        session.cookie,
      ).request("GET", "/api/version");
      if (answer.status !== 200) {
        return { ok: false, detail: `it answered ${answer.status} when asked its version` };
      }
      const build = runningBuild(JSON.parse(answer.text));
      return build === null
        ? { ok: false, detail: "its answer named no version" }
        : { ok: true, build };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Drops the connection to a machine. The remote server is left RUNNING: it is that
   * machine's own server, and other people may be on it.
   */
  disconnect(address: string): void {
    // The record first: with the mark gone, nothing below reads as a machine to bring back.
    if (this.repo.get(address) !== null) {
      this.#record(address, { sessionPid: null });
    }
    this.#settle(address);
    closeConnectionTo(address);
    this.#sessions.delete(address);
    this.#changed();
  }

  // --- keeping machines connected -------------------------------------------------------------

  /**
   * Whether this server keeps a machine connected: it was enabled (or started) and has not been
   * stopped or deleted since — the record's held mark, which a disconnect clears — and it is
   * still something to connect to: installed, not a Windows host (no shell to hold), and still
   * in the ssh config.
   */
  #keepsConnected(address: string): boolean {
    const row = this.repo.get(address);
    if (row === null || row.sessionPid === null || row.version === null) return false;
    if (row.platform === "win32") return false;
    return this.#effects.listAliases().includes(address.slice("ssh:".length));
  }

  /**
   * Whether a machine is connected as far as this server is concerned: the connection held.
   * A server that stopped or restarted over there is no longer noticed from here — a machine
   * with a hub (event-hub.ts) says so through it, and one without answers when next used.
   */
  #isUp(address: string): boolean {
    return this.#liveSession(address) !== null;
  }

  /**
   * A machine kept connected was lost: it is brought back after `delay`, and from then on with a
   * backoff. A machine already on its way back keeps its own schedule — a connection that drops
   * again while it is down is the same loss, and must not cut its wait short.
   */
  #lost(address: string, delay = RECONNECT_FIRST_MS): void {
    if (this.#stopped || this.#reconnects.has(address) || !this.#keepsConnected(address)) return;
    const now = this.#effects.now().getTime();
    this.#reconnects.set(address, {
      since: now,
      attempts: 0,
      nextAt: now + delay,
      lastError: null,
      diagnosis: null,
      diagnosedFor: null,
    });
    this.#changed();
    this.#schedule(address, delay);
  }

  /** Arms the timer that runs a machine's next attempt; one per machine, the later ask replacing it. */
  #schedule(address: string, delay: number): void {
    if (this.#stopped) return;
    const pending = this.#retryTimers.get(address);
    if (pending !== undefined) clearTimeout(pending);
    const timer = setTimeout(() => {
      this.#retryTimers.delete(address);
      void this.#bringBack([address]);
    }, delay);
    timer.unref?.();
    this.#retryTimers.set(address, timer);
  }

  /**
   * Runs a machine's due attempt now rather than when its timer fires. The attempt marks itself
   * running before the first thing it awaits, so the list read right after already says so.
   */
  #tryNow(address: string): void {
    const pending = this.#retryTimers.get(address);
    if (pending !== undefined) clearTimeout(pending);
    this.#retryTimers.delete(address);
    this.#changed();
    void this.#bringBack([address]);
  }

  /** A machine stops being brought back: it came back, or it is no longer to be kept connected. */
  #settle(address: string): void {
    const timer = this.#retryTimers.get(address);
    if (timer !== undefined) clearTimeout(timer);
    this.#retryTimers.delete(address);
    if (this.#reconnects.delete(address)) this.#changed();
  }

  /** The reconnect state as the list reports it. */
  #reconnectInfo(state: Reconnecting): MachineReconnect {
    const iso = (ms: number) => new Date(ms).toISOString();
    return {
      since: iso(state.since),
      attempts: state.attempts,
      maxAttempts: RECONNECT_MAX_ATTEMPTS,
      nextAt: state.nextAt === null ? null : iso(state.nextAt),
      ...(state.gaveUp === undefined ? {} : { gaveUp: state.gaveUp }),
      lastError: state.lastError,
      ...(state.sshReason === undefined ? {} : { sshReason: state.sshReason }),
      diagnosis: state.diagnosis,
      ...(state.waitsForPassword === true ? { waitsForPassword: true as const } : {}),
    };
  }

  /**
   * Brings back each of `addresses` that this server keeps connected, is not connected, and is
   * due — never tried in this streak, or past its wait — five machines at a time. A machine a job
   * is working on is passed over: the job leaves it connected or it does not (#afterJob).
   */
  async #bringBack(addresses: readonly string[]): Promise<void> {
    if (this.#stopped) return;
    const now = this.#effects.now().getTime();
    const due = addresses.filter((address) => {
      if (!this.#keepsConnected(address)) {
        this.#settle(address);
        return false;
      }
      const state = this.#reconnects.get(address);
      if (this.#machineBusy(address)) {
        // A job has it: looked at again in a while, when the job may have brought it back.
        if (state !== undefined) this.#schedule(address, RECONNECT_FIRST_MS);
        return false;
      }
      if (state !== undefined) return state.nextAt !== null && state.nextAt <= now;
      return !this.#isUp(address);
    });
    // Said at once for every machine on its way back, not as each one's turn comes.
    for (const address of due) {
      if (!this.#reconnects.has(address)) {
        this.#reconnects.set(address, {
          since: now,
          attempts: 0,
          nextAt: now,
          lastError: null,
          diagnosis: null,
          diagnosedFor: null,
        });
      }
    }
    if (due.length > 0) this.#changed();
    await this.#sweep(due, (address) => this.#attempt(address));
  }

  /**
   * One attempt to bring a machine back — the whole connect: what runs there, its server started
   * if it is not, the connection held, the Project config handed over. A failure waits twice as long
   * as the one before, up to the cap; the third in a row, and any later one that fails
   * differently, runs the connection check, whose answer the page shows as the explanation. The
   * streak stops at RECONNECT_MAX_ATTEMPTS failures, or at the first that no retry can fix.
   */
  async #attempt(address: string): Promise<void> {
    const state = this.#reconnects.get(address);
    if (state === undefined || this.#stopped) return;
    state.nextAt = null;
    this.#changed();
    const machine = this.#allMachines().find((entry) => entry.id === address);
    const result: MachineJob["result"] =
      machine === undefined
        ? { ok: false, step: "connect", message: "that host is no longer in the ssh config." }
        : await this.#connect(machine, () => {}, "check", await this.#readyPlan());
    // Stopped, deleted or disposed meanwhile: what the attempt learned is nobody's now.
    if (this.#stopped || this.#reconnects.get(address) !== state) return;
    if (result !== null && result.ok) {
      this.#settle(address);
      return;
    }
    state.attempts += 1;
    state.lastError = result?.message ?? "it did not come back.";
    if (result !== null && !result.ok && result.sshReason !== undefined) {
      state.sshReason = result.sshReason;
    } else {
      delete state.sshReason;
    }
    // A stored password refused, or a host that takes none: another try would only add to an
    // account's failed sign-ins, and could lock it. Nothing runs until a password is saved for it
    // again or removed (#passwordChanged); the refusal is its own explanation, so no check either.
    if (state.sshReason === "password-rejected" || state.sshReason === "password-not-offered") {
      state.waitsForPassword = true;
      state.nextAt = null;
      this.#changed();
      return;
    }
    // A host key, a key file, a refused key or the ssh config: the next try would fail the same
    // way until someone fixes it, and the sentence for the reason already says how — no check.
    if (state.sshReason !== undefined && UNRECOVERABLE_SSH.has(state.sshReason)) {
      state.gaveUp = "ssh";
      state.nextAt = null;
      this.#changed();
      return;
    }
    if (state.attempts >= RECONNECT_MAX_ATTEMPTS) {
      // The stated give-up point: no timer, and the look-over passes a streak with no next
      // attempt by (#bringBack), until a Retry or this server's restart begins another.
      state.gaveUp = "attempts";
      state.nextAt = null;
    } else {
      const wait = Math.min(RECONNECT_FIRST_MS * 2 ** state.attempts, RECONNECT_MAX_MS);
      state.nextAt = this.#effects.now().getTime() + wait;
      this.#schedule(address, wait);
    }
    this.#changed();
    if (
      machine !== undefined &&
      state.attempts >= DIAGNOSE_AFTER &&
      state.diagnosedFor !== state.lastError
    ) {
      state.diagnosedFor = state.lastError;
      const diagnosis = await this.#diagnoseNow(machine).catch(() => null);
      if (diagnosis !== null && this.#reconnects.get(address) === state) {
        state.diagnosis = diagnosis;
        this.#changed();
      }
    }
  }

  /**
   * Tells this server's admins that the machines list changed — at once for the first change,
   * then at most once per ANNOUNCE_MS, the last change of a burst always told.
   */
  #changed(): void {
    if (this.#announceTimer !== null) {
      this.#announceOwed = true;
      return;
    }
    this.#announce();
    this.#announceTimer = setTimeout(() => {
      this.#announceTimer = null;
      if (this.#announceOwed) {
        this.#announceOwed = false;
        this.#changed();
      }
    }, ANNOUNCE_MS);
    this.#announceTimer.unref?.();
  }

  #announce(): void {
    try {
      this.#effects.announce();
    } catch {
      // Telling is best effort; the list is read again on the next change or visit.
    }
  }

  // --- the generation's lifetime: what an App does at boot and on its way out ------------------

  /**
   * Brings back every machine this server keeps connected — a restart or a hot push in between
   * notwithstanding — five at a time, starting a server that is down on the way. Only those: a
   * stop or a delete cleared the mark, and a machine merely installed on was never asked for.
   * Called by the platform at boot and not awaited there: a host that is slow to answer must not
   * hold up the App that serves everything else.
   */
  async start(): Promise<void> {
    // Every machine kept connected is on its way back from the moment this server is up, and
    // says so at once — the hand-over below can take a while, and a machine read as merely not
    // connected meanwhile would look stopped.
    const now = this.#effects.now().getTime();
    for (const { address } of this.repo.all()) {
      if (!this.#keepsConnected(address) || this.#reconnects.has(address)) continue;
      this.#reconnects.set(address, {
        since: now,
        attempts: 0,
        nextAt: now,
        lastError: null,
        diagnosis: null,
        diagnosedFor: null,
      });
    }
    this.#changed();
    // The build first, the connections second: a machine behind this build is brought
    // forward over a transient session and its server restarted, and only then re-held —
    // so the connection that stays is to the server that will keep running, and the Model
    // config handed over as it connects lands on the build that will read it.
    await this.syncOutOfDate();
    await this.autoConnect();
    // A stop that came while the sweep ran ended this generation (a hot push, a shutdown, an
    // App torn down): nothing is armed after it, or the look-over would outlive the store it reads.
    if (this.#stopped) return;
    // Kept connected is a standing intent, not a boot-time attempt: each loss arms its own
    // retry (#lost), and this look-over every KEEP_HELD_MS catches whatever slipped past —
    // a drop no event reported. Unref'd: a timer must not keep a process alive.
    if (this.#keepHeld === null) {
      this.#keepHeld = setInterval(() => void this.autoConnect(), KEEP_HELD_MS);
      this.#keepHeld.unref?.();
    }
    // Once more, later. A pushed platform boots BEFORE its version is committed: the store is
    // written only when the boot has succeeded, and this method runs as part of that boot. So
    // the pass above usually read the PREVIOUS version off the disk, found every machine
    // already carrying it, and handed nothing over — the push then reached the machines one
    // push late, or never. By now the commit has landed; with nothing behind this is a no-op.
    this.#lateSweep = setTimeout(() => {
      this.#lateSweep = null;
      void this.syncOutOfDate().catch(() => undefined);
    }, this.#effects.lateSweepMs);
    this.#lateSweep.unref?.();
  }

  /**
   * Brings back, now, every machine kept connected that is not connected and is due: never tried,
   * or past its wait. What the boot runs, and what the look-over repeats.
   */
  async autoConnect(): Promise<void> {
    // A stopped generation reads nothing: its store may already be closed.
    if (this.#stopped) return;
    await this.#bringBack(this.repo.all().map((row) => row.address));
  }

  /**
   * Lets go of every connection THIS generation opened — the platform's dispose effect on a hot
   * push — and every subscription and timer with them: a transient session is closed, a held one
   * is left in the resource registry for the successor to claim (transport/ssh-session.ts). The
   * record of which machines are kept connected stays, so the successor's start() brings each
   * back. Nothing here closes by a remembered pid: the child handles are this generation's own.
   */
  stop(): void {
    this.#stopped = true;
    if (this.#keepHeld !== null) clearInterval(this.#keepHeld);
    this.#keepHeld = null;
    for (const timer of this.#retryTimers.values()) clearTimeout(timer);
    this.#retryTimers.clear();
    this.#reconnects.clear();
    if (this.#announceTimer !== null) clearTimeout(this.#announceTimer);
    this.#announceTimer = null;
    this.#unwatch();
    if (this.#lateSweep !== null) clearTimeout(this.#lateSweep);
    this.#lateSweep = null;
    closeAllConnections();
  }

  // --- work on a machine ---------------------------------------------------------------------

  /**
   * Hands a machine the Project config of every Project using it — what an Agent over there
   * resolves against that machine's own copy: the models with their groups, the default and
   * vision model and the Project's name (models-sync.ts), the sandbox command policy and the
   * new-chat defaults (settings-sync.ts), and the plugin list (plugins-sync.ts). A part the
   * machine refuses for one Project is said and the rest still go; only a channel that gives out
   * ends it. What it came to is kept as the machine's last sync, beside the values this server's
   * environment supplies, which no sync carries.
   */
  async #syncConfig(
    address: string,
    target: RemoteTarget,
    port: number,
    say: Say,
    projects: string[],
    /** Why nothing may be handed over this time: the machine could not say what it runs. */
    withheld?: string,
  ): Promise<MachineConfigSync> {
    // One read of each Project's config serves every part of this sync; the next sync reads
    // the file afresh, which is what a trailing sync after an edit is for.
    const configs = new Map<string, Promise<ProjectConfig>>();
    const configOf = (projectId: string): Promise<ProjectConfig> => {
      let config = configs.get(projectId);
      if (config === undefined) {
        config = this.#effects.loadConfig(projectId);
        // Each part handles a rejection its own way; the shared copy must not go unhandled.
        config.catch(() => {});
        configs.set(projectId, config);
      }
      return config;
    };
    const envOnly = await this.#envOnly(projects, configOf);
    const skipped: MachineSkippedModel[] = [];
    const problems: string[] = [];
    const fail = (line: string) => {
      problems.push(line);
      say(line);
    };
    const finish = (): MachineConfigSync => {
      // Said last, whatever went through: these never travel, so the machine lacks them anyway.
      for (const projectId of projects) {
        const rows = envOnly.filter((entry) => entry.projectId === projectId);
        if (rows.length === 0) continue;
        const whose = projects.length > 1 ? ` for ${projectId}` : "";
        say(
          `Not carried${whose} — these authenticate from this server's environment: ${envOnlyList(rows)}; enter the key on the Models page, or set the same variable on that machine.`,
        );
      }
      const sync: MachineConfigSync = {
        at: this.#effects.now().toISOString(),
        ok: problems.length === 0,
        ...(problems.length === 0 ? {} : { detail: problems.join("\n") }),
        envOnly,
        skipped,
      };
      this.#configSyncs.set(address, sync);
      this.#changed();
      return sync;
    };
    if (projects.length === 0) {
      say("Nothing synced — no Project on this server uses that machine.");
      return finish();
    }
    if (withheld !== undefined) {
      fail(`Config not synced — ${withheld}`);
      return finish();
    }
    const session = await this.#sessionOn(target);
    if (!("cookie" in session)) {
      fail(`Config not synced — ${session.detail}`);
      return finish();
    }
    const api = machineApi(this.#effects.agent(target, port), port, session.cookie);

    const models = await syncModelsToMachine({
      api,
      loadLocal: (projectId) => configOf(projectId).then(localModelsOf, () => null),
      projects,
    });
    if (models.kind === "failed") {
      fail(`Config not synced — ${models.detail}`);
      return finish();
    }
    if (models.created.length > 0) say(`Created there: ${models.created.join(", ")}.`);
    for (const entry of models.skipped) {
      skipped.push(entry);
      say(
        entry.builtInHere === true
          ? `Skipped ${entry.provider}/${entry.modelId} — a built-in model here that the build on that machine does not include yet; update that machine, then sync again.`
          : `Skipped ${entry.provider}/${entry.modelId} — ${entry.reason}`,
      );
      const config = await configOf(entry.projectId).catch(() => null);
      const names = (ref: ModelRef | undefined) =>
        ref?.provider === entry.provider && ref.model_id === entry.modelId;
      for (const [pointer, ref] of [
        ["Default model", config?.default_model],
        ["Vision model", config?.vision_model],
      ] as const) {
        if (names(ref)) {
          say(
            `${pointer} not sent — it is ${entry.provider}/${entry.modelId}, which was skipped; that machine keeps its own.`,
          );
        }
      }
    }
    if (models.projects.length > 0) say(`Models synced: ${models.projects.join(", ")}.`);
    for (const { projectId, detail } of models.refused) {
      fail(`Models of ${projectId} not synced — ${detail}`);
    }

    const settings = await syncSettingsToMachine({
      api,
      loadLocal: (projectId) => configOf(projectId).then(localSettings),
      projects,
    });
    if (settings.projects.length > 0) {
      say(`Command policy and new-chat defaults synced: ${settings.projects.join(", ")}.`);
    }
    for (const { projectId, detail } of settings.notes) {
      say(`New-chat defaults of ${projectId}: ${detail}.`);
    }
    for (const { projectId, part, detail } of settings.refused) {
      fail(`The ${part} of ${projectId} not synced — ${detail}`);
    }

    // A plugin a Project asks for has to be loaded on the machine that will run its Sessions,
    // and enabling it once per machine by hand is not a path this product has (PRFC-0010).
    const plugins = await syncPluginsToMachine({
      api,
      // Asked of THIS machine: its own table joins the shared one, keyed by the id its server
      // minted — null (no server there has reported one) reads the shared table alone.
      loadLocal: (projectId) =>
        this.#localPlugins(configOf, projectId, this.repo.get(address)?.machineId ?? null),
      projects,
    });
    if (plugins.kind === "failed") {
      fail(`Plugins not synced — ${plugins.detail}`);
      return finish();
    }
    if (plugins.added.length > 0) say(`Plugins added there: ${plugins.added.join(", ")}.`);
    if (plugins.removed.length > 0) say(`Plugins removed there: ${plugins.removed.join(", ")}.`);
    if (plugins.unresolved.length > 0) {
      say(
        `Listed there but not resolvable — that machine may need updating first: ${plugins.unresolved.join(", ")}.`,
      );
    }
    if (plugins.restartPending) say(`That machine restarts to finish loading its plugins.`);
    for (const { projectId, detail } of plugins.refused) {
      fail(`Plugins of ${projectId} not synced — ${detail}`);
    }
    return finish();
  }

  /**
   * The values the given Projects' models take from this server's environment (models-sync.ts
   * `envSourced`); a Project whose config cannot be read has none to name.
   */
  async #envOnly(
    projects: readonly string[],
    configOf: (projectId: string) => Promise<ProjectConfig>,
  ): Promise<MachineEnvOnly[]> {
    const env = this.#effects.env();
    const found: MachineEnvOnly[] = [];
    for (const projectId of projects) {
      const config = await configOf(projectId).catch(() => null);
      if (config === null) continue;
      for (const entry of envSourced(config, env)) found.push({ projectId, ...entry });
    }
    return found;
  }

  /**
   * What a Project asks of one machine, by package name with its pinned version; an
   * unreadable config syncs nothing rather than emptying the machine.
   */
  async #localPlugins(
    configOf: (projectId: string) => Promise<ProjectConfig>,
    projectId: string,
    machineId: string | null,
  ): Promise<WantedPlugin[]> {
    const config = await configOf(projectId);
    const table = effectivePluginTable(config.plugins ?? { all: {}, machines: {} }, machineId);
    return Object.entries(table).map(([name, req]) =>
      req.version === undefined ? { name } : { name, version: req.version },
    );
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
        await this.#syncConfig(address, target, port, () => {}, projects());
      } while (slot.again);
    } finally {
      this.#syncing.delete(address);
    }
  }

  /**
   * Hands a machine the build a plan carries, through the connection held to it: this
   * server's own pushed build, or a checkout's image — read from the plan's own store, never
   * from a checkout's `<root>/hmr`, which holds nothing of it.
   */
  async #handOverBuild(
    address: string,
    target: RemoteTarget,
    plan: PushPlan,
    say: Say,
  ): Promise<UpgradeOutcome> {
    const probed = await this.#effects.probe(
      target,
      this.#layout,
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
    this.#record(address, { remotePort: port });
    const session = await this.#sessionOn(target);
    if (!("cookie" in session)) return { kind: "failed", step: "sign in", detail: session.detail };
    return this.#effects.upgrade({
      agent: this.#effects.agent(target, port),
      port,
      cookie: session.cookie,
      // The root the plan's store sits in: `<root>/hmr` for this server's own, and the
      // image's directory for a checkout's.
      dataRoot: plan.hmrDir === null ? this.dataRoot : path.dirname(plan.hmrDir),
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
    say: Say,
  ): Promise<{ ok: true; port: number } | { ok: false; detail: string }> {
    say("Asking what is running there…", "check");
    const before = await this.#effects.probe(
      target,
      this.#layout,
      this.#effects.runOn,
      this.repo.get(address)?.platform ?? null,
    );
    if (before.state.kind === "unreachable") return { ok: false, detail: before.state.detail };
    if (before.state.kind !== "running") {
      return { ok: false, detail: "no server is running on that machine." };
    }
    const port = before.state.port;
    say(`Stopping its server on port ${port}…`, "restart");
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
    this.#record(address, { remotePort: port });
    return { ok: true, port };
  }

  /**
   * Restarts a machine's server as a job — the same shape as an install or a connect, and
   * for the same reason: a stop plus a readiness wait is tens of seconds.
   */
  async startRestart(address: string): Promise<{ ok: true } | { ok: false; why: ConnectRefusal }> {
    if (this.#machineBusy(address)) return { ok: false, why: "busy" };
    const machine = this.#allMachines().find((entry) => entry.id === address);
    if (machine === undefined) return { ok: false, why: "unknown-machine" };
    if (machine.local) return { ok: false, why: "self" };
    if (machine.installed === null) return { ok: false, why: "not-installed" };
    this.#startJob(
      "restart",
      machine,
      ["check", "restart"],
      { offerReplaceProgram: false },
      async (say) => {
        const target = this.#targetOf(machine.alias);
        const done = await this.#restartServer(address, target, say);
        if (!done.ok) return { ok: false, step: "restart", message: done.detail };
        say(`Restarted on port ${done.port}.`);
        return { ok: true, connected: true };
      },
    );
    return { ok: true };
  }

  /**
   * Why a verb that acts on one installed machine — stop, uninstall — cannot start, or null
   * when it can. A Windows machine is refused: this server never starts a server there (it has
   * no shell to hold a session on), so there is none of its own to stop, and its program is
   * not removed from here.
   */
  #refuseOnInstalled(address: string): ConnectRefusal | null {
    if (this.#machineBusy(address)) return "busy";
    const machine = this.#allMachines().find((entry) => entry.id === address);
    if (machine === undefined) return "unknown-machine";
    if (machine.local || (machine.machineId !== null && machine.machineId === this.#machineId)) {
      return "self";
    }
    const row = this.repo.get(address);
    if (row?.version == null) return "not-installed";
    if (row.platform === "win32") return "unsupported";
    return null;
  }

  /**
   * Stops a machine's server and stops keeping it connected — the page's Stop service. It then
   * stays stopped, this server's own restarts included, until it is started again
   * (startConnect). Nothing is touched when the machine cannot be reached.
   */
  startStop(address: string): { ok: true } | { ok: false; why: ConnectRefusal } {
    const refused = this.#refuseOnInstalled(address);
    if (refused !== null) return { ok: false, why: refused };
    const machine = this.#allMachines().find((entry) => entry.id === address)!;
    this.#startJob("stop", machine, ["check", "stop"], { offerReplaceProgram: false }, (say) =>
      this.#stopWork(machine, say),
    );
    return { ok: true };
  }

  /**
   * Asks what runs there, refusing — with nothing changed — when the machine cannot be reached;
   * otherwise stops keeping it connected and stops its server if one runs. The shared start of
   * a stop and an uninstall; `nothing` says what was left alone, in the refusal's words.
   */
  async #stopServerFor(
    machine: MachineInfo,
    say: Say,
    nothing: string,
  ): Promise<{ ok: true } | JobFailure> {
    const address = machine.id;
    const target = this.#targetOf(machine.alias);
    say("Asking what is running there…", "check");
    const probed = await this.#probe(address, target);
    this.#recordProbe(address, probed);
    if (probed.state.kind === "unreachable") {
      return {
        ok: false,
        step: "check",
        message: `could not reach that machine, so ${nothing}: ${probed.state.detail}`,
        canReplaceProgram: false,
        ...this.#sshCause(target, probed.state.detail),
      };
    }
    // From here the machine is to stay stopped: nothing may bring it back while its server goes
    // away, so the mark goes first. The commands below open a passing session of their own.
    this.disconnect(address);
    if (probed.state.kind !== "running") {
      say("Its server was not running.", "stop");
      return { ok: true };
    }
    say(`Stopping its server on port ${probed.state.port}…`, "stop");
    const stopped = await this.#effects.stopServer(target);
    if (!stopped.ok) {
      return {
        ok: false,
        step: "stop",
        message: `its server would not stop — ${stopped.detail}`,
        canReplaceProgram: false,
      };
    }
    const after = await this.#probe(address, target);
    this.#recordProbe(address, after);
    if (after.state.kind === "running") {
      return {
        ok: false,
        step: "stop",
        message: "its server is still running after it was told to stop.",
        canReplaceProgram: false,
      };
    }
    say("Its server is stopped.");
    return { ok: true };
  }

  async #stopWork(machine: MachineInfo, say: Say): Promise<MachineJob["result"]> {
    const stopped = await this.#stopServerFor(machine, say, "nothing was stopped");
    if (!stopped.ok) return stopped;
    // The passing session the commands opened is let go too: nothing is kept open to a
    // machine that is to stay stopped.
    closeConnectionTo(machine.id);
    return { ok: true, stopped: true };
  }

  /**
   * Removes the program from a machine: its server stopped, then the program directory, and the
   * data directory too when `removeData` says so. The machine stays in the Project's list, as
   * not installed, and stops being kept connected.
   */
  startUninstall(
    address: string,
    removeData: boolean,
  ): { ok: true } | { ok: false; why: ConnectRefusal } {
    const refused = this.#refuseOnInstalled(address);
    if (refused !== null) return { ok: false, why: refused };
    const machine = this.#allMachines().find((entry) => entry.id === address)!;
    this.#startJob(
      "uninstall",
      machine,
      ["check", "stop", "remove"],
      { offerReplaceProgram: false },
      (say) => this.#uninstallWork(machine, removeData, say),
    );
    return { ok: true };
  }

  async #uninstallWork(
    machine: MachineInfo,
    removeData: boolean,
    say: Say,
  ): Promise<MachineJob["result"]> {
    const address = machine.id;
    const target = this.#targetOf(machine.alias);
    const stopped = await this.#stopServerFor(machine, say, "nothing was removed");
    if (!stopped.ok) return stopped;
    const dir = this.#layout.programDir.posix;
    say(
      removeData
        ? `Removing the program and its data from ${dir}…`
        : `Removing the program from ${dir}; its data directory stays…`,
      "remove",
    );
    const removed = await this.#effects.runOn(target, uninstallCommand(this.#layout, removeData));
    const said = removed.stdout.trim();
    if (removed.code !== 0) {
      return {
        ok: false,
        step: "remove",
        message: said === "" ? "the machine did not say why it could not remove it." : said,
        canReplaceProgram: false,
      };
    }
    for (const line of said.split("\n")) if (line.trim() !== "") say(line.trim());
    // What this server knew about the program there is gone with it. The machine's own id lives
    // in its data directory: kept with the data, forgotten with it.
    this.#record(address, {
      version: null,
      installedAt: null,
      remotePort: null,
      sessionPid: null,
      ...(removeData ? { machineId: null } : {}),
    });
    this.#statuses.delete(address);
    this.#apiSeen.delete(address);
    this.#configSyncs.delete(address);
    closeConnectionTo(address);
    this.#changed();
    return { ok: true, uninstalled: true, dataRemoved: removeData };
  }

  /**
   * Hands a connected machine the Project config now, as a job: `check`, the build check a
   * connect makes — a machine on another build is refused with the sentence that points at
   * Update, and nothing is done to it — then `sync`. Refused before any ssh for a machine that is
   * not connected.
   */
  startSyncConfig(address: string): { ok: true } | { ok: false; why: SyncRefusal } {
    const refused = this.#refuseOnInstalled(address);
    if (refused !== null) return { ok: false, why: refused };
    if (this.#liveSession(address) === null || this.repo.get(address)?.remotePort == null) {
      return { ok: false, why: "not-connected" };
    }
    const machine = this.#allMachines().find((entry) => entry.id === address)!;
    this.#startJob("sync", machine, ["check", "sync"], { offerReplaceProgram: false }, (say) =>
      this.#syncConfigWork(machine, say),
    );
    return { ok: true };
  }

  async #syncConfigWork(machine: MachineInfo, say: Say): Promise<MachineJob["result"]> {
    const address = machine.id;
    const target = this.#targetOf(machine.alias);
    const port = this.repo.get(address)?.remotePort ?? null;
    if (port === null || this.#liveSession(address) === null) {
      return {
        ok: false,
        step: "check",
        message: "that machine is no longer connected.",
        canReplaceProgram: false,
      };
    }
    say("Asking what it runs…", "check");
    const lined = await this.#inLine(address, target, port, await this.#readyPlan(), say, false);
    if (!lined.ok) {
      return { ok: false, step: "check", message: lined.message, canReplaceProgram: false };
    }
    say("Handing over the Project config…", "sync");
    const sync = await this.#syncConfig(
      address,
      target,
      lined.port,
      say,
      this.#projectsUsing(address),
      lined.unasked,
    );
    return sync.ok
      ? { ok: true, synced: true }
      : { ok: false, step: "sync", message: sync.detail ?? "", canReplaceProgram: false };
  }

  /**
   * Puts a freshly installed build into service. Only for a machine whose server was already
   * running: one that was down is left down — installing software is not a decision that the
   * machine should be serving.
   */
  async #restartAfterInstall(
    address: string,
    target: RemoteTarget,
    say: Say,
  ): Promise<{ ok: true } | { ok: false; detail: string }> {
    const before = await this.#effects.probe(
      target,
      this.#layout,
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
      // A job queued while this ran was passed over by #drain; it may start now.
      this.#drain();
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

  /**
   * Hands this server's build to every machine carrying a different one. A checkout hands
   * over the image it last built and builds nothing here: this runs at every start, and a
   * dev server restarts on every edit.
   */
  async syncOutOfDate(): Promise<void> {
    const plan = await this.#readyPlan();
    if (plan === null) return;
    const behind = this.repo
      .all()
      .filter((row) => row.version !== null && row.version !== plan.version)
      .map((row) => row.address);
    const sweep = () =>
      this.#sweep(behind, async (address, target) => {
        const outcome = await this.#handOverBuild(address, target, plan, () => {});
        // Recorded only when the machine also wrote it down: a swap it could not persist is
        // gone at its next restart, and a record of it would outlive the thing it records.
        if (outcome.kind === "upgraded" && outcome.persisted) {
          this.#record(address, {
            version: plan.version,
            installedAt: this.#effects.now().toISOString(),
          });
        }
      });
    // A checkout's image is held for the sweep as for a job: builds the page starts meanwhile
    // must not prune what is being handed over.
    await (this.#checkout?.holding(plan, sweep) ?? sweep());
  }

  /**
   * Pushes a Project's config to every connected machine it uses — a key rotated here, a
   * default switched, a command policy edited, the Project renamed, a plugin listed: each
   * reaches them at once. Not through #sweep: that returns null for a machine that is busy and
   * would silently drop the edit; a sync in flight is instead told to run once more
   * (#syncCoalesced), and an install in flight on the machine is not a reason to lose a
   * credential either — the two do not contend for the shell.
   */
  async syncConfigEverywhere(projectId: string): Promise<void> {
    // A machine left on another build than this server's image keeps the config it has: what
    // this server writes is for its own build (#inLine says the same at connect). Updating the
    // machine is what brings it back into the sync.
    const plan = this.#plan();
    const connected = this.list(projectId).filter(
      (m) =>
        !m.local &&
        m.installed !== null &&
        m.connection !== null &&
        (plan === null || m.installed.version === plan.version),
    );
    await Promise.all(
      connected.map(async (machine) => {
        const address = machine.id;
        const port =
          this.#liveSession(address) === null ? null : (this.repo.get(address)?.remotePort ?? null);
        if (port === null) return;
        try {
          // Every Project using the machine, not only the one edited: a trailing run serves
          // whichever edits it coalesced, and the machine's last-sync record speaks for all of them.
          await this.#syncCoalesced(address, this.#targetOf(machine.alias), port, () =>
            this.#projectsUsing(address),
          );
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
    | "list"
    | "imageVersion"
    | "job"
    | "startInstall"
    | "start"
    | "syncConfigEverywhere"
    | "proxyTarget"
    | "projectApis"
    | "jobs"
    | "startUse"
    | "stopUsing"
    | "addSshHost"
    | "sshHost"
    | "updateSshHost"
    | "diagnose"
    | "sshHosts"
    | "addToProject"
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
  @Use() private readonly paths!: Paths;
  @Use() private readonly db!: Db;
  @Use() private readonly hmr!: Hmr;
  @Use() private readonly access!: Access;
  @Use() private readonly channels!: Channels;
  @Use() private readonly users!: Users;
  @Use() private readonly resourceGroups!: ResourceGroups;
  @Provide() machines!: Machines;
  /** Session-level requests for a machine's Session, routed by its id (session-forward.ts). */
  @Provide() sessionForward!: MachineSessionForward;
  @Bind("MachinesModule.routes") routes!: Hono<AppEnv>;
  @Bind("MachinesModule.server-proxy") serverProxyRoutes!: Hono<AppEnv>;
  setup({ effect }: ClassCtx) {
    // This machine's own id is minted on the first boot of this data root and stable ever
    // after — every stored reference to this machine, here and on the machines it reaches,
    // points at it. A test that supplies its own service mints none.
    const repo = new MachinesRepo(this.db as unknown as DatabaseSync);
    // The held ssh sessions a predecessor left in the registry are claimed back only when the
    // platform judged their contract this build's; this generation's are registered there too.
    attachSessionRegistry(this.hmr.resources, this.resourceGroups.adoptable(SESSION_GROUP));
    // A server running from a checkout builds the image its installs need (checkout-image.ts);
    // asked of this module's own file, which a packaged program or a pushed platform keeps
    // outside any checkout.
    const checkout = findCheckout(path.dirname(fileURLToPath(import.meta.url)));
    // The machines page and the proxy are admins' alone, so their events are too: told to every
    // admin with GET /api/events open (`peek`, never `get` — a channel opened here would be one
    // nobody listens on). Never throws: it runs in timers and ssh events as well as requests.
    const users = this.users;
    const channels = this.channels;
    const toAdmins = (event: ServerEvent) => {
      try {
        for (const user of users.list()) {
          if (user.isAdmin)
            channels.peek(userChannelKey(user.userId))?.publish(event, "server_event");
        }
      } catch {
        // Best effort: a page reads the list again on its next change or visit.
      }
    };
    // The generation's one socket cache and the event hub over it (PRFC-0011): the proxy's
    // streams and the machines' aggregate event stream share both, so the hub holds ONE
    // subscription per machine however many tabs read it.
    const sockets = new MachineSockets((line) => console.log(line));
    const events = new MachineEventHub(sockets, (line) => console.log(line));
    const machines = new MachinesService(
      this.paths.root,
      repo.ownId(),
      repo,
      {
        ...(checkout === null ? {} : { packCheckout: deployPacker(checkout) }),
        // An installed release installs the image its build shipped, unless it was pushed to.
        shippedImage: shippedImage(),
        socketFact: (machineId) => sockets.fact(machineId),
        announce: () => toAdmins({ type: "machines_changed" }),
      },
      () => this.hmr.assetsDir(),
    );
    this.machines = machines;
    this.routes = machinesRoutes({ machines, access: this.access, events });
    this.serverProxyRoutes = machinesServerProxyRoutes(machines, { sockets, events });
    this.sessionForward = machineSessionForward(machines, { sockets, events }, (line) =>
      console.log(line),
    );
    // Every transient ssh session THIS generation opened closes with it, and every held one is
    // left for the successor, whose start() re-holds each one the record says was held.
    effect(() => {
      machines.stop();
      events.close();
      sockets.close();
    });
  }
}

/**
 * `/server/<machineId>/api/…` — a connected machine's API, forwarded over the connection held
 * to it and addressed by the machine's OWN id. Admins only: the request is made over there as
 * that machine's admin, with a session this server minted over the ssh access that installed
 * it, so this server's admin session is the one credential involved.
 */
export function machinesServerProxyRoutes(
  machines: MachinesService,
  shared: { sockets?: MachineSockets; events?: MachineEventHub } = {},
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const proxy = machinesProxy(
    (machineId) => machines.proxyTarget(machineId),
    (machineId, outcome) => machines.noteApiSeen(machineId, outcome),
    (line) => console.log(line),
    shared,
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

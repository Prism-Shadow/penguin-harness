/**
 * The machines domain's wire vocabulary: the DTOs the Machines page and the machine-facing
 * routes speak, the server's directory listing a machine's answers share, and the two
 * literals every client spells the same way — the session cookie's name and the API
 * socket's address. The server re-exports these unchanged (api/types.ts); this package owns
 * the words so its services and routes speak the same shapes.
 */
import type { ServerEvent } from "@prismshadow/penguin-library-project";

/** Server directory browsing (the Workspace picker): starts from the home directory by default, can navigate up to the root. */
export interface DirEntryInfo {
  name: string;
  /** Absolute path of this entry (a folder's can be submitted directly as a Workspace). */
  path: string;
  /**
   * `file` for anything that is not a folder (a symlink counts as what it points to). Absent
   * means a folder: a machine listed over ssh reports folders only.
   */
  kind?: "dir" | "file";
  /** Last modification, epoch milliseconds; absent when unknown (listings over ssh, an entry stat could not reach). */
  mtime?: number;
  /** Hidden by the machine's own rules beyond the dot-name convention (Windows hidden/system attribute). */
  hidden?: true;
}
/** A storage location the machine offers beside its folders: a Windows drive, a macOS volume, a Linux root or mount. */
export interface DirLocation {
  /** Absolute path it opens (`C:\`, `/`, `/Volumes/USB`, `/media/me/USB`, `/mnt/c`). */
  path: string;
  kind: "drive" | "removable" | "network" | "optical" | "volume" | "root";
  /** The machine's own name for it (volume label, volume name, share `\\nas\media`, WSL `C:`); absent when none. */
  label?: string;
}
/** The platform's standard folders as that machine resolves them; only those that exist. */
export interface DirStandardFolders {
  desktop?: string;
  documents?: string;
  downloads?: string;
  pictures?: string;
}
export interface DirListResponse {
  /** Absolute path of the current directory (realpath). */
  path: string;
  /** Absolute path of the parent directory; null when already at the root. */
  parent: string | null;
  /** Entries sorted by name, hidden ones included (the picker drops them). */
  entries: DirEntryInfo[];
  /** The listed machine's `process.platform`; absent for a machine listed over ssh. */
  platform?: string;
  /** Home request with `places=1` only. */
  standardFolders?: DirStandardFolders;
  /** Home request with `places=1` only, in the order the sidebar lists them. */
  locations?: DirLocation[];
}

/**
 * The session cookie's name as every non-browser client spells it (a browser's carries the
 * server's port; auth/middleware.ts): the CLI, a server speaking to a machine it holds, and the
 * desktop shell that mints its window's session. Shared so they all write the cookie the server
 * reads.
 */
export const SESSION_COOKIE = "penguin_session";

/**
 * The API socket (PRFC-0011): one WebSocket per tab, every frame a call to an existing
 * endpoint. It has its own upgrade route, {@link API_SOCKET_PATH}: the runtime's websocket
 * seam authenticates the cookie and the Origin there and hands the socket to the platform,
 * which serves the protocol as the signed-in user (server: socket/ref.ts). Shared so the Web
 * App and anything else that speaks to another server spell the address the same way.
 */
export const API_SOCKET_PATH = "/api/socket";

/** The API socket's address. No id is involved: the handshake's cookie names the user. */
export function apiSocketPath(): string {
  return API_SOCKET_PATH;
}

/**
 * What the API socket this server holds to one machine is doing (machines/machine-sockets.ts) —
 * the fact behind `MachineInfo.socket`. `since` is the instant the state was entered, so the
 * Machines page can say how long a machine has been dialling, failing or connected instead of
 * sending someone to the browser console for it.
 */
export interface MachineSocketFact {
  /**
   * `connected` once the handshake completed, `dialling` while a dial is outstanding, `refused`
   * when the machine answered the handshake with a status (a program predating the socket),
   * `unanswered` when its server answers HTTP and never answered the handshake, and `failed` when
   * the dial did not complete or a socket that was up closed.
   *
   * `unanswered` is a server PROCESS older than the socket: an update handed to a running server
   * swaps its platform and never the process that takes the upgrade, so the machine reports the
   * current build and still has no socket: it is not running this server's version, which a remote
   * machine must. A restart of its server, and failing that an update or a reinstall, brings it
   * there; the Machines page reads the state as needing a restart. It lasts until a handshake
   * completes: a
   * machine dialled again keeps it while the dial is outstanding, instead of reading `dialling`.
   */
  state: "connected" | "dialling" | "refused" | "unanswered" | "failed";
  /** When that state was entered (ISO). */
  since: string;
  /** The transport's own words where there are any: a refusal's status, a dial's error. */
  detail?: string;
}

/**
 * One machine's event, as the machines aggregate stream carries it
 * (`GET /api/projects/:projectId/machines/events`): the machine's own `ServerEvent`, with the
 * machine it came from — one stream carries many machines, and the tag is what keeps their
 * events apart (docs: /docs/server-api § "One event stream per machine").
 */
export interface MachineEvent {
  machineId: string;
  event: ServerEvent;
}

/** One `Host` entry of the server's `~/.ssh/config`, as the Machines page lists it. */
export interface MachineInfo {
  /** `ssh:<alias>` — the id the install route is asked for. */
  id: string;
  /**
   * The alias exactly as written in the config. The list is the config text and nothing
   * else — no `ssh -G`, no processes, no network — so a config declaring hundreds of hosts
   * costs one file read; an alias is resolved only when it is actually installed to.
   */
  alias: string;
  /**
   * The last install THIS server carried out there FOR THIS PROJECT, remembered in web.db so
   * it survives a restart, a hot push, and installing on some other machine. Null when this
   * Project has never installed there — a host another Project did is `elsewhere` below.
   *
   * A record of what was done, not a survey of the far side: a machine wiped by hand still
   * reads as installed until the next install probes it and corrects the record. Asking the
   * remote instead would cost an ssh round trip per host at page load, which is the price
   * the config-text list exists to avoid.
   */
  installed: { version: string; at: string } | null;
  /**
   * Installed by this server, but not this Project's machine — another Project's, or nobody's
   * since it was released — and so not a host nobody has touched either. Absent in every
   * other case, including when it IS this Project's (where `installed` carries the same record).
   *
   * Reported rather than folded into `installed` because the two lead to different actions:
   * one is a machine to use, the other is a machine to adopt, which costs a row and no ssh.
   * Reported rather than hidden because a row that silently looked uninstalled would send
   * someone to spend a 30 MB transfer re-doing what is already done.
   */
  elsewhere?: { version: string; at: string };
  /** This server signs in to the machine with a password it stores for the alias, not a key. */
  passwordSaved?: true;
  /**
   * In this Project's list: the Machines page shows a card for it. A machine joins the list when
   * it is added (`POST …/machines/add`, which installs nothing) or when an install or a use for
   * this Project runs on it, and leaves it with stop-using or release. Absent for a host that is
   * only in the ssh config, or only in another Project's list; never set on `local`, which is
   * always shown.
   */
  member?: true;
  /**
   * The machine's OWN id — 16 base64url characters minted by the server that runs there,
   * stable across renames, re-aliasing and reinstalls. Null until a server has started on
   * that machine, since nothing has minted one yet.
   *
   * This is what anything stored should point at; `id` above is an ADDRESS (`ssh:<alias>`),
   * and `alias` is what people read. Two aliases for one host share a `machineId`, and an
   * alias repointed at a different host answers a different one — an id never changes for a
   * machine, so a change of id is a change of machine.
   */
  machineId: string | null;
  /** The host this server itself runs on. Always present, always installed, never a target. */
  local: boolean;
  /**
   * The connection this server holds to it — the one ssh session everything to the machine
   * rides (machines/transport/ssh-session.ts): a fact about a process on THIS side, which
   * outlives the far server. Present means `/server/<id>/api/…` has somewhere to go; whether
   * a server ANSWERS over there is `status`'s word, from the last probe — and the two must not
   * be read for each other: taking the connection for the machine's liveness is the mistake
   * behind the connect loop (#561). Always null for `local`, which needs no connection.
   */
  connection: { pid: number } | null;
  /**
   * Present while this server is bringing a machine it keeps connected back — the connection
   * dropped, its server stopped or restarted, or this server itself just started — and absent
   * otherwise. A machine is kept connected from the moment it is enabled until it is stopped
   * (`POST …/stop`) or deleted (`POST …/stop-using`); see machines/service.ts's supervision.
   */
  reconnect?: MachineReconnect;
  /**
   * This server keeps a connection to it: it was enabled, or started, and has not been stopped
   * or deleted since. Absent otherwise — a machine only added, one whose server was stopped
   * here, one that never got as far as a connection.
   */
  keepConnected?: true;
  /**
   * The API socket this server holds to that machine — connected, dialling, refused or failed,
   * and since when (machines/machine-sockets.ts). Null for `local`, and until a stream has
   * asked for a socket at all. A fact about one process on THIS side, like `connection` and
   * for the same reason: it says the socket exists and what it is doing, never that the far
   * side is answering. The Machines page reads it so a stuck stream does not have to be found
   * in the browser console.
   */
  socket: MachineSocketFact | null;
  /**
   * The machine's API as last seen by this server's proxy — stamped by traffic passing
   * through, never by a probe of its own. `answeredAt` when the last forwarded request got
   * an HTTP answer (any status: a server that refuses is still answering); `failedAt` and
   * the transport's own words when the connection had nowhere to deliver. Null until a first
   * request flows, and only as fresh as the last one — no traffic, no measurement, which is
   * honest: nothing burns ssh for a page nobody is looking at. Always null for `local`;
   * this server answering the request that fetched this list is that measurement.
   */
  api: { answeredAt: string } | { failedAt: string; detail: string } | null;
  /**
   * What the last time this server handed it the Project config came to: at a connect, a Sync
   * config job, or an automatic sync after a config edit here. Absent until the first one since
   * this server started; kept in memory only.
   */
  configSync?: MachineConfigSync;
  /**
   * What the last probe found over there, or null when none has been taken. Never filled in
   * at list time: a probe costs an ssh round trip per machine, so the list reports the last
   * answer and the page asks for a fresh one when it wants one — on a widening schedule,
   * since each probe is an ssh round trip while the list is only the config's text.
   */
  status: MachineServerStatus | null;
  /**
   * The data root the server there runs on (`PENGUIN_HOME`). This instance's PROFILE decides
   * it — a dev instance names the machine's dev root and never the release one beside it
   * (machines/layout.ts) — which is exactly what a reader looking at two instances of this
   * page needs to tell them apart. Written in that machine's own spelling once its platform
   * is known, and in the POSIX one before that; for `local` it is this process's own root,
   * already resolved to an absolute path.
   */
  root: string;
}

/**
 * One config sync to a machine: when it ended, whether every part of it reached the machine for
 * every Project using it, and what did not, in the far side's words.
 */
export interface MachineConfigSync {
  /** ISO timestamp the sync ended. */
  at: string;
  ok: boolean;
  /** The parts that did not go through, one per line; absent when `ok`. */
  detail?: string;
  /**
   * The values the Project's models take from this server's environment variables rather than
   * its config (an API key, or a base URL), which no sync can carry: one row per variable. On
   * the list answered for a Project, that Project's rows only.
   */
  envOnly: MachineEnvOnly[];
  /**
   * The model entries the machine refused by name — a hand-added model in a group that takes
   * only its built-in ones there — left out while the rest of the table went. On the list
   * answered for a Project, that Project's rows only.
   */
  skipped: MachineSkippedModel[];
}

/** A model entry a machine would not take: its error code and its own words for why. */
export interface MachineSkippedModel {
  projectId: string;
  provider: string;
  modelId: string;
  /** The far side's error code (`model_not_addable`, `model_not_routable`). */
  code: string;
  reason: string;
  /**
   * The entry is one of this server's built-in models for its group, which the machine refused
   * as not addable: the machine's build does not list it yet, so updating the machine, then
   * syncing again, carries it. Absent for any other refusal.
   */
  builtInHere?: true;
}

/** A model entry that takes `variable` from this server's environment. */
export interface MachineEnvOnly {
  projectId: string;
  provider: string;
  modelId: string;
  variable: string;
}

/**
 * A machine this server keeps connected, while it is being brought back. Attempts back off
 * from 15 s, doubling, and stop after `maxAttempts` failures in a row — or after the first, when
 * ssh refused in a way no retry fixes, or when a person asks to stop
 * (`POST …/machines/:machineId/stop-reconnecting`) — until a person asks for a Retry
 * (`POST …/machines/:machineId/reconnect`). After three failures in a row the connection check
 * runs on its own, and its answer is what the page shows as the explanation.
 */
export interface MachineReconnect {
  /** When this streak began: the moment the machine was found not connected, or the Retry that began it again. */
  since: string;
  /** Attempts that failed in this streak; 0 while the first is still to run or running. */
  attempts: number;
  /** How many failures in a row end the streak: the page says "attempt n of this". */
  maxAttempts: number;
  /** When the next attempt runs; null while one is running, and once the streak stopped. */
  nextAt: string | null;
  /**
   * The streak stopped, and nothing runs until a person asks for a Retry, which begins a new
   * one: `attempts` — `maxAttempts` failed in a row; `ssh` — ssh refused in a way retrying
   * cannot fix (a host key unknown or changed, an unusable key file, a key refused, a broken
   * ssh config), said by `sshReason`; `cancelled` — a person stopped it. An attempt that was
   * under way when it was stopped runs out: it may still connect the machine, and its failure
   * is the `lastError`.
   */
  gaveUp?: "attempts" | "ssh" | "cancelled";
  /** The last attempt's failure in the far side's words; null before the first one fails. */
  lastError: string | null;
  /** Why ssh refused, when the last failure was ssh's own — for the page to say in its language. */
  sshReason?: MachineSshFailure;
  /** The connection check run after three failures in a row; null until then. */
  diagnosis: MachineDiagnosis | null;
  /**
   * The password stored for the machine was refused, or its host takes none (`sshReason`
   * says which): no attempt runs until a password is saved for it again or removed, since
   * retrying could lock the account. `nextAt` is null meanwhile.
   */
  waitsForPassword?: true;
}

/**
 * One machine's server state. There is deliberately no separate "ssh" status: ssh is the
 * transport, so a machine it cannot reach reads as `unreachable` with OpenSSH's own
 * diagnostic in `detail` rather than as two statuses a reader has to combine.
 */
export interface MachineServerStatus {
  state: "running" | "stopped" | "unreachable";
  /** ISO timestamp of the probe this answer came from. */
  checkedAt: string;
  /** The port it is serving on (`running`). */
  port?: number;
  /** Why the machine could not be reached (`unreachable`) — ssh's own words. */
  detail?: string;
}

/**
 * The running or last job on a machine — an install, or a connect — polled by GET
 * /api/machines while one runs. One at a time. `log` carries the far side's own words where
 * there are any: ssh's diagnostics and the remote installer's output say more about a
 * refused key or an unusable Node than a paraphrase would.
 */
export interface MachineJob {
  /**
   * `use` is the whole pipeline — install if needed, hand over, connect, sync — as one job;
   * `connect` is what the page calls Start service; `stop` stops the machine's server and stops
   * keeping it connected; `uninstall` stops it and removes the program, and the data directory
   * when asked; `sync` hands a connected machine the Project config.
   */
  kind: "install" | "connect" | "restart" | "use" | "stop" | "uninstall" | "sync";
  machineId: string;
  alias: string;
  /** Waiting its turn: a few machines are worked on at once, and a batch queues the rest. */
  queued: boolean;
  running: boolean;
  /**
   * The steps this job goes through, in order — what the page draws as its stepper. Fixed when
   * the job is queued; a step the job turns out not to need is passed over, never revisited.
   */
  steps: MachinePhase[];
  /**
   * Which of `steps` the job is on. Only moves forward. Null until the first step is named; a
   * finished job keeps its last phase.
   */
  phase: MachinePhase | null;
  log: string[];
  /**
   * The connection check run after the job failed at a step it can explain — checking,
   * installing, connecting: running, then its answer. Absent for every other job.
   */
  diagnosis?: { state: "running" } | ({ state: "done" } & MachineDiagnosis);
  result:
    | null
    | { ok: true; installed: "installed" | "already-installed"; version: string | null }
    | { ok: true; connected: true }
    /** The machine's server is stopped and stays so until it is started again. */
    | { ok: true; stopped: true }
    /** The program is gone from the machine; `dataRemoved` says whether its data root went too. */
    | { ok: true; uninstalled: true; dataRemoved: boolean }
    /** Every part of the Project config reached the machine (its `configSync` says the same). */
    | { ok: true; synced: true }
    | {
        ok: false;
        step: string;
        message: string;
        /**
         * The failure has a next step this side can take, and it needs saying yes to:
         * installing the PROGRAM over there and restarting it. Every failed install or
         * connect offers it — a failure that leaves no next step leaves a person stuck —
         * except a run that was itself that install, and one this server could not act on
         * (no build of its own to send), which says `false`. Offered rather than done,
         * because it restarts a server this Project does not own alone.
         */
        canReplaceProgram?: boolean;
        /**
         * Why ssh refused, when the failure is ssh's own (a host key, a key, a host name, a
         * route), for the page to say in its language; `message` says it in English, with
         * ssh's own words after `(ssh: …)`.
         */
        sshReason?: MachineSshFailure;
      };
}

/**
 * A source checkout's install image (machines/checkout-image.ts), built from the checkout
 * again at each install or use: not built yet, building, built, or failed with the build's
 * own last words.
 */
export type MachinesCheckoutImage =
  | { state: "unbuilt" }
  | { state: "building" }
  | { state: "built" }
  | { state: "failed"; detail: string };

/** GET /api/machines, and the 202 body of POST /api/machines/:machineId/install. */
export interface MachinesResponse {
  machines: MachineInfo[];
  /**
   * The version an install would leave on the remote — the base release, plus a `+hmr.<sha>`
   * suffix when this server carries a pushed version to replicate. A source checkout answers
   * with the image it last built, and null before its first build (see `checkoutImage`).
   * Null otherwise only for a server that carries no image and builds none.
   */
  imageVersion: string | null;
  /**
   * Present only when this server runs from a source checkout: it builds its install image
   * from the checkout at each install or use, so no image yet is not a reason to refuse one.
   */
  checkoutImage?: MachinesCheckoutImage;
  /** The most recently started job, running or finished. */
  job: MachineJob | null;
  /**
   * Every job worth showing this generation: the queued ones, the running one, and the last
   * finished one per machine — so a batch reads as a list of rows each saying where it is.
   */
  jobs: MachineJob[];
}

/**
 * Every step a job may name, in the order they can occur. A job lists its own subset as
 * `MachineJob.steps`: a source checkout's enable starts by building its install image
 * (`build`); a stop is `check`, `stop`; an uninstall `check`, `stop`, `remove`; a config sync
 * `check`, `sync`.
 */
export const MACHINE_PHASES = [
  "build",
  "check",
  "install",
  "handover",
  "restart",
  "connect",
  "sync",
  "stop",
  "remove",
] as const;
export type MachinePhase = (typeof MACHINE_PHASES)[number];

/** `POST /api/projects/:projectId/machines/:machineId/uninstall`. */
export interface MachineUninstallRequest {
  /** Remove the machine's data root too — its Sessions, Agents and config there. Default false. */
  removeData?: boolean;
}

/**
 * `POST /api/projects/:projectId/machines/ssh-hosts`: append a host block to this server's
 * `~/.ssh/config`. Answers the machines list (201), or 400 `ssh_host_invalid` naming the
 * field, or 409 `ssh_host_exists`.
 */
export interface SshHostRequest {
  /** The alias — what `ssh <alias>` will take, and the machine's name everywhere here. */
  alias: string;
  hostName: string;
  user?: string;
  port?: number;
  identityFile?: string;
  /**
   * Sign in with this password instead of a key: stored on this server in a 0600 file under its
   * data root, never in the ssh config, and never sent back. On a PUT, `null` deletes the stored
   * one (back to key sign-in) and leaving it out keeps it. A PUT on a block written by hand may
   * set it when the other fields are the block as it stands. 400 `ssh_password_invalid` for an
   * empty or multi-line one; 409 `ssh_password_unsupported` (`details.ssh`: what `ssh -V` said)
   * when this computer's ssh cannot be handed a password.
   */
  password?: string | null;
}

/**
 * `GET /api/projects/:projectId/machines/ssh-hosts/:alias`: a host's block read back, and
 * whether this app wrote it. Only a block this app wrote may be rewritten
 * (`PUT …/ssh-hosts/:alias`, the same fields less the alias): a hand-written one may carry
 * options this app does not know, and rewriting it would drop them.
 */
export interface SshHostResponse extends Omit<SshHostRequest, "password"> {
  editable: boolean;
  /** A password is stored for this host, which then signs in with it rather than with a key. */
  passwordSaved?: true;
}

/**
 * `GET /api/projects/:projectId/machines/ssh-hosts`: every host this server's ssh config declares,
 * its included files' too, with what each one's own block says about reaching it — the literal
 * lines, not what ssh resolves (no `ssh -G`): a `Host *` default or a `Match` block is not
 * applied. For the add dialog's rows; an option the block leaves out is absent.
 */
export interface SshHostSummary {
  alias: string;
  hostName?: string;
  user?: string;
  port?: number;
}

export interface SshHostsResponse {
  hosts: SshHostSummary[];
}

/**
 * `POST /api/projects/:projectId/machines/add`: put these machines in this Project's list without
 * installing anything there — each then has a card whose one thing to do is enabling it. Answers
 * like `…/use`, refusals by id (`unknown-machine`, `self`).
 */
export interface MachinesAddRequest {
  machines: string[];
}

/** `POST /api/projects/:projectId/machines/use`: bring these machines into use, as one queued batch. */
export interface MachinesUseRequest {
  /** Machine ids (`ssh:<alias>`). Every one is queued; refusals come back by id. */
  machines: string[];
  /** Install the program even where its version matches, and restart there — the answer to a job that asked for it. */
  replaceProgram?: boolean;
}

/** Why one machine of a batch was not queued; the rest were. */
export type MachineUseRefusal = "unknown-machine" | "self" | "no-image";

/**
 * Why ssh could not get a session to a machine, read from its own diagnostic
 * (machines/ssh-failure.ts); `other` when it printed none of the ones with a fixed meaning.
 */
export type MachineSshFailure =
  | "host-key-unknown"
  | "host-key-changed"
  | "key-file"
  | "auth"
  | "password-rejected"
  | "password-not-offered"
  | "host-not-found"
  | "refused"
  | "timeout"
  | "closed"
  | "ssh-config"
  | "other";

/** Whether a machine reaches one release source: the package is there, the source answered without it, or no answer. */
export type MachineSourceReach = "ok" | "missing" | "unreachable";

/**
 * One check of a machine (machines/diagnose.ts), as facts for the page to word. `pass` is
 * fine, `warn` works with a caveat, `fail` stops an install or a connect, `skip` could not be
 * asked (an earlier check failed, or it does not apply).
 */
export type MachineCheck =
  /** A session came up (keys, or the stored password), as this account on that host. */
  | { id: "ssh"; state: "pass"; user: string; host: string }
  /** It did not; `said` is ssh's own words, led by what they mean. */
  | { id: "ssh"; state: "fail"; reason: MachineSshFailure; said: string }
  /**
   * `warn` for Windows (installable, not connectable yet), and for a Linux whose glibc runs the
   * release but is older than `terminalsNeed`, the one its terminal binding loads on.
   */
  | {
      id: "platform";
      state: "pass" | "warn";
      os: string;
      arch: string;
      glibc?: string;
      terminalsNeed?: string;
    }
  /**
   * What the release's Node cannot run on: an OS or architecture no release is published for
   * (`unsupported`, `said` what the machine answered), a glibc older than `need` (`glibc`), or
   * a musl libc such as Alpine's (`musl`).
   */
  | {
      id: "platform";
      state: "fail";
      reason: "unsupported" | "glibc" | "musl";
      os?: string;
      arch?: string;
      glibc?: string;
      need?: string;
      said?: string;
    }
  /**
   * What the release installer needs and the machine lacks. `warn` when curl alone is missing:
   * the release is then sent over ssh rather than downloaded there.
   */
  | { id: "tools"; state: "pass" | "warn" | "fail"; missing: string[] }
  /**
   * Whether the machine itself reaches release `version` for its platform. `warn`: out of
   * reach, so an install cannot download it there; `fail`: both sources answered and neither
   * has it (not published).
   */
  | {
      id: "download";
      state: "pass" | "warn" | "fail";
      version: string;
      github: MachineSourceReach;
      oss: MachineSourceReach;
    }
  /** Free space in the machine's home against what an install needs, in MB. */
  | { id: "disk"; state: "pass" | "warn" | "fail"; freeMb: number; needMb: number }
  /** The port its server would start on: free, already its PenguinHarness server's, or taken by something else. */
  | { id: "port"; state: "pass" | "fail"; port: number; holder: "free" | "penguin" | "other" }
  | { id: "platform" | "tools" | "download" | "disk" | "port"; state: "skip" };

/**
 * `POST /api/projects/:projectId/machines/:machineId/diagnose`: the checks, in order. Nothing
 * is written on the machine; 409 `job_running` while a job works on it.
 */
export interface MachineDiagnosis {
  machineId: string;
  checkedAt: string;
  checks: MachineCheck[];
}

export interface MachinesUseResponse extends MachinesResponse {
  refused: { machineId: string; why: MachineUseRefusal }[];
}

/** `POST /api/projects/:projectId/machines/stop-using`: let go of these machines — connection dropped, Project membership released; the install stays. */
export interface MachinesStopUsingRequest {
  machines: string[];
}

/**
 * The header a hand-over sets to tell the machine it may run this build even though a plugin
 * of the machine's own would be left out, and the value that names that choice. The
 * machines-facing copy; the server's own push seam (hmr/push-plugins.ts) reads the same words.
 */
export const UNSATISFIED_PLUGINS_HEADER = "x-penguin-unsatisfied-plugins";
export const LEAVE_OUT = "leave-out";

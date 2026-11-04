} from "@penguinharness/plugin-workbenches/server";

  WorkbenchRecord,
||||||| parent of 76b96d65fd (api types take workbench face)

/** GET /api/version/history: the harness versions this data root has committed, newest first. */
export type VersionHistoryResponse = HarnessHistory;

/** POST /api/version/history/rollback `{ id }`: the push back has started; the swap follows. */
export interface VersionRollbackResponse {
  started: true;
  id: string;
}

/** GET /api/version/history/diff?from=&to=: what changed between two stored interface tables. */
export type VersionHistoryDiffResponse = IfacesDiff;
export type { IfaceChange, IfacesDiff, MemberChange, ModuleChange } from "@prismshadow/penguin-hmr";

/**
 * GET /api/version/update-check: newest published release vs the running version.
 * Always HTTP 200 (fail-soft): a lookup failure sets `error` and leaves `latestVersion`
 * null rather than failing the request; results are cached server-side.
 */
export interface UpdateCheckResponse {
  currentVersion: string;
  /** Same as VersionResponse.buildDate: the running version's release date, stamped at build time. */
  buildDate: string | null;
  /** Newest published release (normalized, no leading `v`); null when the lookup failed or checks are disabled. */
  latestVersion: string | null;
  updateAvailable: boolean;
  /** Release page of the newest release (for the "release notes" link). */
  releaseUrl: string | null;
  /** Publish timestamp of the newest release (ISO 8601). */
  publishedAt: string | null;
  /** When this result was produced (ISO 8601) — a cached result keeps its original timestamp. */
  checkedAt: string;
  /** Present (true) when update checks are turned off via PENGUIN_UPDATE_CHECK=off; no network call was made. */
  disabled?: true;
  /** Why the lookup failed: unreachable network / GitHub rate limit / unusable response. */
  error?: "network" | "rate_limited" | "bad_response";
}

// ---------------------------------------------------------------------------
// Desktop client update (desktop mode only)
// ---------------------------------------------------------------------------

/**
 * The desktop shell's updater snapshot, pushed to the embedded server over the
 * utilityProcess message channel and served at GET /api/desktop/update. `state` is the
 * discriminator; the optional fields belong to the states named on them.
 *
 * The shell never downloads on its own: a check ends in `available`, and the download
 * starts only on the page's (or the native dialog's) say-so — the `download` command. A
 * `downloaded` build stays the reported state until it is installed: a later periodic
 * check (or its failure) must not hide the actionable "restart to install" step.
 */
export interface DesktopUpdateStatus {
  /** Installed shell version (Electron app.getVersion()). */
  appVersion: string;
  /**
   * Bumped by the shell on every updater event it folds, whether or not the visible
   * state changed. A row-initiated check settles when the seq has moved past its
   * at-click value and the state is no longer `checking` — snapshot equality can't
   * carry that signal (a check that ends where it started is byte-identical).
   */
  seq?: number;
  state:
    | "idle"
    | "checking"
    | "up-to-date"
    | "available"
    | "downloading"
    | "downloaded"
    | "error"
    | "unsupported";
  /** The newer release: offered (`available`), being fetched (`downloading`) or ready to install (`downloaded`). */
  version?: string;
  /** Download progress 0–100 (`downloading`). */
  percent?: number;
  /** Updater failure text (`error`). */
  message?: string;
  /** Why this install form cannot update itself (`unsupported`): dev run, or a Linux install that is not an AppImage (e.g. .deb — the system package manager owns it). */
  reason?: "dev" | "linux-not-appimage";
}

/**
 * GET /api/desktop/update (desktop-shell sessions only): the latest shell snapshot.
 * `status` is null until the shell's first push lands (a beat after server start).
 */
export interface DesktopUpdateStatusResponse {
  status: DesktopUpdateStatus | null;
}

/** Shell → server push over the utilityProcess message channel. */
export interface DesktopUpdaterStatusMessage {
  type: "desktop-updater-status";
  status: DesktopUpdateStatus;
}

/**
 * Server → shell command over the utilityProcess message channel (relayed from
 * POST /api/desktop/update/check|download|install): look for a release, fetch the one
 * offered, or restart into the one downloaded.
 */
export interface DesktopUpdaterCommandMessage {
  type: "desktop-updater-command";
  action: "check" | "download" | "install";
}

// Desktop tray icon (desktop mode only)
//
// The shell keeps an icon in the system tray for as long as the app runs, and Settings ›
// Appearance is where it is turned off and on. The switch rides the same utilityProcess
// message channel as the client updater above: the shell pushes what it currently shows,
// the page reads it at GET /api/desktop/tray and writes through PUT, which is relayed
// back. The window stays a plain browser — no renderer IPC bridge.
//
// The page reports its UI language over the same route, so the tray menu reads in the
// language the window does. The shell cannot see that preference itself: it lives in the
// browser's localStorage, on the other side of a boundary this design keeps one-way.

/** The two languages the Web App has; the shell's tray menu follows whichever is in use. */
export type DesktopTrayLocale = "zh" | "en";

/** What the shell is currently doing about its tray icon. */
export interface DesktopTrayStatus {
  /** Whether an icon is shown in the system tray while the app runs. */
  showTrayIcon: boolean;
  /**
   * The language the tray menu is drawn in. Until a page reports one the shell uses the
   * device language, so this can differ from the Web App's until the first report lands.
   */
  locale: DesktopTrayLocale;
}

/**
 * What one PUT asks the shell to change. Every field is optional and a request must carry at
 * least one: the switch and the language reach this route from different parts of the page.
 */
export interface DesktopTrayPatch {
  showTrayIcon?: boolean;
  locale?: DesktopTrayLocale;
}

/**
 * GET / PUT /api/desktop/tray (desktop-shell sessions only): the tray preference.
 * `status` is null until the shell's first push lands (a beat after server start); a
 * client that finds null reads it as on, which is the shell's own default.
 */
export interface DesktopTrayStatusResponse {
  status: DesktopTrayStatus | null;
}

/** Shell → server push over the utilityProcess message channel. */
export interface DesktopTrayStatusMessage {
  type: "desktop-tray-status";
  status: DesktopTrayStatus;
}

/**
 * Server → shell command over the utilityProcess message channel (relayed from PUT
 * /api/desktop/tray). A patch, not a snapshot: the switch and the language are written by
 * different parts of the page at different moments, and neither should have to restate the
 * other's value to change its own.
 */
export interface DesktopTrayCommandMessage {
  type: "desktop-tray-command";
  showTrayIcon?: boolean;
  locale?: DesktopTrayLocale;
}

/**
 * The API socket (PRFC-0011): one WebSocket per tab, every frame a call to an existing
 * endpoint. It has its own upgrade route, {@link API_SOCKET_PATH}: the runtime's websocket
 * seam authenticates the cookie and the Origin there and hands the socket to the platform,
 * which serves the protocol as the signed-in user (server: socket/ref.ts). Shared so the Web
 * App and anything else that speaks to another server spell the address the same way.
 */
export const API_SOCKET_PATH = "/api/socket";

/**
 * Paths whose answer depends on the KIND of session behind the request — the desktop shell's
 * own window (`sessionVia === "desktop"`: its update, tray and privacy relays, folder access,
 * revealing a file) or a first-login link (a password change without the old password). The
 * socket's handshake does not say how the cookie behind it was minted, so these are made over
 * HTTP: the socket answers them 421 `not_on_socket` and the Web App never sends them there.
 */
export function sessionKindPath(pathname: string): boolean {
  return (
    pathname === "/api/me/password" ||
    pathname === "/api/desktop" ||
    pathname.startsWith("/api/desktop/") ||
    /^\/api\/projects\/[^/]+\/dirs\/access$/.test(pathname) ||
    (pathname.startsWith("/api/") && pathname.endsWith("/reveal"))
  );
}
/** The API socket's address. No id is involved: the handshake's cookie names the user. */
export function apiSocketPath(): string {
  return API_SOCKET_PATH;
}

// Desktop folder access (desktop mode, macOS)
//
// macOS privacy protection (TCC) guards Desktop, Documents, Downloads and removable and network
// volumes. It asks the user only on behalf of an app it holds responsible for a read, and lists
// under Files and Folders only the apps it has asked about; any other read gets a silent EPERM.
// The Workspace picker's "Allow access" therefore goes to the shell, over the same
// utilityProcess message channel as the updater and tray above: its main process reads the
// folder once in the app's own name and says whether it could, and once the app is allowed its
// children (this server, the agents' shells) read too. The page can also have the shell open
// the Privacy & Security pane to change it. What either outcome means for the user is the
// page's to say; the shell only reports.

/** What the shell's read of one folder came to. */
export interface DesktopFolderAccessResult {
  /** The folder could be read. Always true off macOS, where the shell reads nothing. */
  granted: boolean;
  /** The failed read's errno code (`EPERM`, `EACCES`, `ENOENT`, …); `EINVAL` for a path that is not absolute. */
  code?: string;
  /**
   * Whether the app is a packaged build (Electron's `app.isPackaged`). An unpackaged one is a
   * development instance started from a terminal, and macOS holds that terminal responsible
   * for its reads rather than the app.
   */
  packaged: boolean;
}

/** Server → shell request over the utilityProcess message channel (relayed from POST /api/projects/:projectId/dirs/access). */
export interface DesktopFolderAccessMessage {
  type: "desktop-folder-access";
  /** Pairs the reply with its request. */
  id: string;
  /** The folder to read, as an absolute path. */
  path: string;
}

/** Shell → server reply to one {@link DesktopFolderAccessMessage}, carrying its `id`. */
export interface DesktopFolderAccessResultMessage extends DesktopFolderAccessResult {
  type: "desktop-folder-access-result";
  id: string;
}

/** POST /api/projects/:projectId/dirs/access: the shell's answer, for the picker to act on. */
export interface DirAccessResponse {
  granted: boolean;
  packaged: boolean;
}

/** The Privacy & Security panes the page may open: Files and Folders, and Full Disk Access. */
export type DesktopPrivacyPane = "files" | "fullDisk";

/** Server → shell command over the utilityProcess message channel (relayed from POST /api/desktop/privacy-settings). No reply. */
export interface DesktopOpenPrivacySettingsMessage {
  type: "desktop-open-privacy-settings";
  pane: DesktopPrivacyPane;
}

/**
 * A native action the host process can run on the page's behalf — what the desktop shell's
 * application menu used to offer, reached from the command palette instead (the menu bar
 * stays hidden so a lone Alt no longer takes the keyboard). A plain server offers none.
 *
 * `open-devtools` is the same story one step further: the shell's View menu toggles DevTools
 * and the shell binds F12 to it, but neither is visible with the menu bar hidden — so
 * someone reading a console error has to be told a key. Naming it here makes it findable.
 * It stays a HOST command, run by the shell on its own window: the page is a plain browser
 * environment with no bridge of its own, and adding one for this was rejected
 * (packages/desktop/src/main.ts).
 *
 * This list is NOT the set of runnable commands — {@link HostCommandOffer} is, and the host
 * writes it. What this list holds is the ids this build has its OWN words for, so the page
 * can show a better label than the host sent (translated, with search terms). An id absent
 * here is still offered, still runnable, and shown in the host's words.
 */
export const HOST_COMMANDS = ["install-cli", "check-updates", "open-devtools"] as const;
export type HostCommand = (typeof HOST_COMMANDS)[number];

/**
 * The ids the legacy `commands` field of `GET /api/command` may carry — the set the page
 * that predates `offers` knows. That page looks every id up in a table of its own and
 * throws on a miss, so this set is PINNED: an id added to {@link HOST_COMMANDS} travels
 * only in `offers` (whose words ride along) until the old page is gone. Filtering by the
 * build's own `HOST_COMMANDS` here would leak each new id to a page that cannot say it.
 */
export const LEGACY_HOST_COMMANDS = ["install-cli", "check-updates"] as const;

/**
 * One command the host offers, carrying the words to show for it.
 *
 * The words travel WITH the command because the three programs involved ship apart: the
 * shell reaches users through an installer, the server and the page through a hot push. A
 * page that could only render commands it already had words for made the offer list pointless
 * — a host could never offer anything new — and reading words it did not have blanked it.
 *
 * `command` is opaque to both server and page: the host decides what it means and the host
 * runs it. Neither side validates it against a list of its own; the only question either asks
 * is whether the host offered it.
 */
export interface HostCommandOffer {
  command: string;
  label: string;
  /** The same words in Chinese. A host with only one language sends it in both. */
  labelZh: string;
}

/** Shell → server push over the utilityProcess message channel, once per wiring: what this host offers. */
export interface HostCommandsMessage {
  type: "host-commands";
  commands: HostCommandOffer[];
}

/** `GET /api/command` (admin): what the host offers — empty under a plain server, or before the shell's push. */
export interface HostCommandsResponse {
  /**
   * The offered ids this build also has words for, and nothing else.
   *
   * For pages older than `offers`, which look up every id in a table of their own: an id
   * they have never heard of throws while they build the palette, and a throw there blanks
   * the App. So this field stays conservative and the new field carries everything.
   */
  commands: HostCommand[];
  /** Everything the host offers, in the host's words. What a current page renders. */
  offers: HostCommandOffer[];
}

/** Server → shell: run one. `POST /api/command/:command` sends it. */
export interface HostCommandMessage {
  type: "host-command";
  command: string;
}

/**
 * The outcome of one self-update run (`penguin update --yes` on the server host), carried
 * by {@link UpdateJobStatus.result}. `unsupported` covers both a server not launched via
 * the CLI and the CLI's own refusals (source checkout, unrecognized install layout, Windows).
 */
export interface UpdateRunResponse {
  status: "updated" | "failed" | "unsupported";
  /** Set when the server cannot run the CLI at all (started without `penguin server|web`). */
  reason?: "not_launched_via_cli";
  /** Tail of the update command's combined stdout+stderr (capped; empty when nothing ran). */
  output: string;
  /** True when the install changed (or was already current): restart the service to run the new version. */
  needsRestart: boolean;
}

/**
 * Where a running self-update is: resolving the release and fetching the installer,
 * downloading the bundle (the one phase with a percentage), or verifying and installing it.
 */
export type UpdateJobPhase = "resolving" | "downloading" | "installing";

/**
 * GET / POST /api/version/update (admin only): the self-update job. POST starts a run when
 * none is in flight — a finished run may be started again, which is how a failed one is
 * retried — and answers with the status exactly as GET does; the page polls GET while
 * `state` is `running`. One job per process: two admins clicking at once share the one run,
 * and the finished status stays readable until the next start.
 */
export interface UpdateJobStatus {
  state: "idle" | "running" | "done";
  /** The release the run targets — the update check's newest version when the run started; null when none was known. */
  targetVersion: string | null;
  /** Running only. */
  phase?: UpdateJobPhase;
  /** Running, `downloading` only: 0–100 read off the installer's progress bar; null until its first tick. */
  percent?: number | null;
  /** Tail of the update command's combined stdout+stderr so far (capped; empty when nothing ran). */
  output: string;
  /** Done only. */
  result?: UpdateRunResponse;
  startedAt?: string;
  finishedAt?: string;
}

/**
 * POST /api/version/restart (admin only): asks the process to exit with the supervisor's
 * restart code after a graceful shutdown, so `penguin server|web` relaunches it on the
 * installed release. `restarting: false` when nothing supervises this process — it was
 * started some other way than through the CLI, or it is a dev run — and the page shows the
 * manual restart hint instead.
 */
export interface RestartResponse {
  restarting: boolean;
  reason?: "no_supervisor";
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

// ---------------------------------------------------------------------------
// Company mode: organizations (files are the truth; every DTO here is a projection)
// ---------------------------------------------------------------------------

/**
 * Organization status: `paused` stops every automatic trigger; humans can still talk to any
 * desk. These two values are the whole lifecycle — no route deletes an organization, so a
 * paused one keeps its conversations, employees, desks and tickets.
 */
export type OrgStatus = "active" | "paused";
/** Approval mode for desk and ticket sessions; unattended runs never get always-ask. */
export type OrgApprovalMode = "allow-all" | "read-only" | "deny-all";
/** The five kanban columns, each a directory under `tickets/<yyyy-mm>/`. */
export type OrgTicketStatus = "proposed" | "in_progress" | "review" | "done" | "rejected";
export type OrgTicketPriority = "P0" | "P1" | "P2";
/** Live employee state: running when the desk or any ticket session has a Task in progress; paused when budget-paused. */
export type OrgEmployeeState = "running" | "idle" | "paused";
/**
 * The trigger kinds an `[org_trigger]` block carries. `ticket_notice` is read-only: a ticket
 * change starts no run of its own, so nothing writes that kind any more, and it stays in the
 * union because Traces recorded while it did still carry it.
 */
export type OrgTriggerKind = "init" | "event" | "mention" | "ticket_notice" | "ticket_work";
/** The ticket changes an employee is told about, listed in the body of its next calendar sweep. */
export type OrgTicketChange = "assigned" | "blocked" | "blocker_closed" | "done" | "rejected";
/** What the last evaluation of a calendar event did. */
export type OrgCalendarOutcome = "fired" | "queued" | "paused" | "missed" | "error";
/**
 * The organization's working language: the language its handbook, its CEO's initialization
 * run, every employee brief and every desk and ticket run are written in. Detected from the
 * mission at creation (CJK text → `zh`, anything else → `en`) unless the request names one.
 */
export type OrgLanguage = "zh" | "en";

/** The organization's settings as `org_config.toml` records them. */
export interface OrganizationSettings {
  name: string;
  mission: string;
  status: OrgStatus;
  /** IANA timezone: budget periods (natural months) and chat day files follow it. */
  timezone: string;
  approvalMode: OrgApprovalMode;
  /** Chat @-chain limit: a message whose hop reaches it records its mentions without triggering anyone. */
  mentionChainLimit: number;
  budgetWarnRatio: number;
  budgetPauseRatio: number;
  createdBy: string;
  /** The shared workspace root when it is not the organization's own `workspace/` (absolute path). */
  workspace?: string;
  /** The model desks and ticket sessions run on when the employee names none; absent = the Project default. */
  model?: { provider: string; modelId: string };
  /** The working language (`language` in `org_config.toml`); absent on an organization written before the field existed, which reads as `en`. */
  language?: OrgLanguage;
}

/** Period spend against the CEO's budget (= the whole organization). */
export interface OrgSpendSummary {
  /** `yyyy-mm` in the organization's timezone. */
  period: string;
  cost: number;
  budget?: number;
  /** cost / budget; absent without a budget. */
  ratio?: number;
}

export interface OrganizationSummary {
  projectId: string;
  orgId: string;
  name: string;
  mission: string;
  status: OrgStatus;
  employeeCount: number;
  runningCount: number;
  pausedCount: number;
  /** proposed + in_progress + review. */
  openTickets: number;
  blockedTickets: number;
  createdBy: string;
  spend: OrgSpendSummary;
  /** Present when `org_config.toml` / `org_chart.yaml` fail validation: the organization is listed but every automatic trigger is held until it is fixed. */
  invalid?: string;
}

export interface OrganizationsResponse {
  organizations: OrganizationSummary[];
}

export interface OrgEmployeeItem {
  agentId: string;
  /**
   * What this employee goes by in the organization, unique across it: the chart's `name`, else
   * the Agent's display name, else the id — with the id noted (`name (id)`) when the name is
   * not this employee's alone. It is what every surface shows and what works after `@`.
   */
  name: string;
  /** The `name` as written in the chart, for editing; absent when the entry has none. */
  givenName?: string;
  /**
   * Present when the employee has an avatar: the content revision of the image served at
   * `GET …/employees/:agentId/avatar` (append it as `?rev=` — the image is cached for good).
   * Absent, surfaces draw the letter tile.
   */
  avatarRev?: string;
  title: string;
  /** null for the CEO (the root). */
  reportsTo: string | null;
  duties?: string;
  /** As written in the chart: a sub-directory of the shared workspace (`.` = all of it) or an absolute path. */
  workspace: string;
  /** Where that resolves to; absent when the directory does not exist (the entry is then invalid). */
  resolvedWorkspace?: string;
  /** Monthly budget in USD for this employee plus all subordinates; absent = unbounded. */
  budget?: number;
  model?: { provider: string; modelId: string };
  state: OrgEmployeeState;
  /**
   * The employee's current desk. Absent while the ledger names none, and while the Session
   * it names no longer exists (deleted by hand, or with its Agent): a desk is listed only
   * once it can be opened, and the reconcile pass re-opens a missing one when it can.
   */
  desk?: { sessionId: string; workspace: string; openedAt: string };
  /** Period spend: own sessions, and cumulative (own + every subordinate). */
  spend: { own: number; cumulative: number; ratio?: number };
  /** Why the entry cannot be triggered (missing Agent, missing workspace directory). */
  invalid?: string;
  /**
   * The entry's Agent no longer exists (`invalid` carries the sentence). Its desk cannot be
   * opened; the entry stays until a person makes the employee leave, or until an Agent with
   * the same id is created again (which is how a deleted CEO is restored).
   */
  agentMissing?: true;
}

export interface OrgChartResponse {
  ceoAgentId: string;
  employees: OrgEmployeeItem[];
}

export interface OrgCalendarItem {
  agentId: string;
  name: string;
  title?: string;
  prompt: string;
  enabled: boolean;
  startAt: string;
  period?: string;
  endAt?: string;
  status: ScheduleStatus;
  invalidReason?: string;
  nextFireAt?: string;
  lastFiredAt?: string;
  /** What the most recent evaluation did (absent until the event has been evaluated once). */
  lastOutcome?: OrgCalendarOutcome;
  /** The organization or this employee is paused, so due slots are skipped, not fired. */
  paused: boolean;
}

export interface OrgCalendarResponse {
  events: OrgCalendarItem[];
  invalidFiles: Array<{ agentId: string; name: string; error: string }>;
}

/**
 * One line of a ticket's operation history, kept in the file's frontmatter apart from the
 * progress prose: what was done, by whom (`agent:<id>` / `user:<id>` — an employee is recognised
 * from the Agent id its command subprocesses carry, a person otherwise), and when.
 */
export type OrgTicketHistoryAction =
  | "created"
  | "assigned"
  | "moved"
  | "blocked"
  | "unblocked"
  | "progress"
  | "session_started"
  | "session_attached"
  | "edited";

export interface OrgTicketHistoryEntry {
  at: string;
  by: string;
  action: OrgTicketHistoryAction;
  /** The action's detail: the column moved to, the new owner, the block reason, the session id. */
  note?: string;
}

/**
 * The ticket id's slug: lowercase letters in hyphen-joined words, no digits (the date prefix
 * already carries the numbers), chosen for meaning — derived from an ASCII title, proposed by
 * the Project's model for a title in another language, or passed explicitly.
 */
export const TICKET_SLUG_PATTERN = /^[a-z]+(?:-[a-z]+)*$/;

export interface OrgTicketItem {
  ticketId: string;
  title: string;
  status: OrgTicketStatus;
  /** The ONE responsible principal (`agent:<id>` / `user:<id>`); who filed it is the history's `created` entry. */
  owner: string;
  parent?: string;
  notify: string[];
  priority: OrgTicketPriority;
  due?: string;
  /** Non-empty = blocked; the ticket stays in its column. */
  blocked?: string;
  blockedBy?: string;
  /** Contributing session ids, in the order they were attached. */
  sessions: string[];
  /** Any contributing session has a Task in progress. */
  running: boolean;
  /** Period cost of the contributing sessions (a session attached to n tickets counts 1/n here). */
  cost: number;
  /** Header/column disagreement or a duplicate id: shown with a danger mark, left where it is. */
  invalid?: string;
}

export interface OrgTicketSessionItem {
  sessionId: string;
  agentId: string;
  title?: string;
  status: SessionStatus;
  lastActiveAt?: string;
}

export interface OrgTicketDetail extends OrgTicketItem {
  goal: string;
  acceptanceCriteria: string;
  /** `## Progress` as plain sentences; who wrote one and when is the matching history entry. */
  progress: string[];
  result: string;
  /** The operation history from the frontmatter, oldest first. */
  history: OrgTicketHistoryEntry[];
  /** The whole file, for the Markdown view and for clients that prefer to edit it as text. */
  body: string;
  children: string[];
  /** Own cost plus every descendant's along `Parent`. */
  rolledUpCost: number;
  sessionItems: OrgTicketSessionItem[];
}

export interface OrgTicketsResponse {
  columns: Record<OrgTicketStatus, OrgTicketItem[]>;
  /** Files that failed to parse (skipped; also recorded as errors). */
  invalidFiles: Array<{ path: string; error: string }>;
}

/**
 * What a `system` line records, structured: the kind of event and its parameters, so a client
 * renders the sentence in the reader's language and with the principals' display names instead
 * of showing the English `text` verbatim. `text` stays the English sentence (the CLI, older
 * clients and the file itself read it); `notice` is the same fact for a client that can do better.
 */
export type OrgChannelNoticeKind =
  | "employee_joined"
  | "employee_left"
  | "channel_created"
  | "channel_archived"
  | "channel_unarchived"
  | "channel_joined"
  | "channel_invited"
  | "channel_left"
  | "channel_removed"
  | "budget_warned"
  | "budget_paused"
  /**
   * Legacy, read-only: ticket changes no longer write into a channel — the board is read from
   * the board and the overview's inbox. These three kinds stay so the lines already in an
   * organization's message files keep rendering; nothing writes them any more.
   */
  | "ticket_blocked"
  | "ticket_done"
  | "ticket_rejected";

/**
 * The parameters each kind carries, all strings: principals as `agent:<id>` / `user:<id>`
 * (`agent`, `principal`, `by`, `reportsTo`), a ticket as `ticket` + `title`, a budget event as
 * `agent`, `period`, `percent`, `cost`, `budget`.
 */
export interface OrgChannelNotice {
  kind: OrgChannelNoticeKind;
  params: Record<string, string>;
}

export interface OrgChannelMessage {
  id: string;
  /** ISO 8601 UTC. */
  time: string;
  /** `agent:<id>` / `user:<id>` / `system`. */
  sender: string;
  hop: number;
  text: string;
  /** Principals mentioned, `all` included. */
  mentions: string[];
  refs?: { ticket?: string; session?: string; replyTo?: string };
  /** Present on `system` lines the server wrote with a structured notice; absent on lines from before the field existed. */
  notice?: OrgChannelNotice;
}

/**
 * One channel as the API reports it. The all-hands channel (`default_channel`,
 * `everyone: true`) exists for as long as the organization does and every employee and
 * Project member is in it; every other channel carries the membership its members edit.
 */
export interface OrgChannelItem {
  channelId: string;
  /** As stored; the UI renders the all-hands channel's label itself. */
  name: string;
  /** "" when unset. */
  purpose: string;
  /** True only for `default_channel`: membership is implicit. */
  everyone: boolean;
  /** An archived channel is read-only and folded away. */
  archived: boolean;
  /** `user:<id>` / `agent:<id>` / `system`. */
  createdBy: string;
  /** ISO 8601 UTC. */
  createdAt: string;
  /** Implicit membership counted for the all-hands channel. */
  memberCount: number;
  /** Whether the caller (person or employee) is a member. */
  isMember: boolean;
  /** People only; 0 for an employee caller. */
  unread: number;
  /** People only; 0 for an employee caller. */
  mentionsMe: number;
  lastMessageAt: string | null;
}

export interface OrgChannelMember {
  /** `agent:<id>` or `user:<id>`. */
  principal: string;
  name: string;
  kind: "agent" | "user";
}

export interface OrgChannelDetail extends OrgChannelItem {
  /** The all-hands channel resolves to every employee plus every Project member. */
  members: OrgChannelMember[];
}

export interface OrgChannelsResponse {
  /** `default_channel` first, then by name. */
  channels: OrgChannelItem[];
}

export interface OrgChannelCreateRequest {
  channelId: string;
  name?: string;
  purpose?: string;
}

export interface OrgChannelPatchRequest {
  name?: string;
  purpose?: string;
  archived?: boolean;
}

export interface OrgChannelMemberRequest {
  /** `agent:<id>` (an employee) or `user:<id>` (a Project member). */
  principal: string;
}

export interface OrgChannelMessagesResponse {
  /** The channel served. */
  channelId: string;
  /** The day file served (`yyyy-mm-dd` in the organization's timezone). */
  date: string;
  /** The days this channel has a file for, newest first, for paging back. */
  days: string[];
  messages: OrgChannelMessage[];
  /** Messages of this channel after the caller's read cursor in it, across the recent days. */
  unread: number;
  /** Of those, the ones that mention the caller (or all). */
  mentionsMe: number;
  lastReadId?: string;
}

export interface OrgBudgetAlert {
  agentId: string;
  period: string;
  warnedAt?: string;
  pausedAt?: string;
}

export interface OrgFinanceEmployee {
  agentId: string;
  name: string;
  title: string;
  reportsTo: string | null;
  own: number;
  cumulative: number;
  budget?: number;
  ratio?: number;
  warned: boolean;
  paused: boolean;
}

export interface OrgFinanceTicket {
  ticketId: string;
  title: string;
  status: OrgTicketStatus;
  parent?: string;
  cost: number;
  rolledUp: number;
}

export interface OrgFinanceResponse {
  period: string;
  currency: "USD";
  employees: OrgFinanceEmployee[];
  tickets: OrgFinanceTicket[];
  /** Daily cost of the organization's sessions over the period. */
  daily: Array<{ date: string; cost: number }>;
  alerts: OrgBudgetAlert[];
  total: number;
  /** Some usage ran on a model without pricing: tokens were counted, cost is a lower bound. */
  unpriced: boolean;
}

export interface OrgDeskItem {
  agentId: string;
  name: string;
  sessionId: string;
  title?: string;
  status: SessionStatus;
  workspace: string;
  lastActiveAt?: string;
  /**
   * Present when the desk session has an ENABLED messaging binding: its channel, read as
   * `SessionInfo.messagingChannel` is (the company sidebar's desk row draws the same mark as a
   * development row, and the development list never holds a desk).
   */
  messagingChannel?: MessagingChannel;
}

export interface OrgSessionsResponse {
  /** One per employee whose current desk Session exists; a desk the ledger names but the server no longer has is left out. */
  desks: OrgDeskItem[];
  tickets: Array<{
    ticketId: string;
    title: string;
    status: OrgTicketStatus;
    sessions: OrgTicketSessionItem[];
  }>;
}

export interface OrgDeskResponse {
  agentId: string;
  sessionId: string;
  workspace: string;
  openedAt: string;
  /** True when this call created the desk session. */
  created: boolean;
}

export interface OrganizationDetail extends OrganizationSummary {
  settings: OrganizationSettings;
  board: Record<OrgTicketStatus, number>;
  /** Today's calendar events (organization timezone) with their outcomes. */
  today: OrgCalendarItem[];
  pending: {
    /** Unread messages mentioning the caller (or all). */
    mentions: number;
    reviewTickets: OrgTicketItem[];
    blockedByMe: OrgTicketItem[];
  };
  /** The last messages of the all-hands channel. */
  recentMessages: OrgChannelMessage[];
  alerts: OrgBudgetAlert[];
  /** What the overview's inbox lists; absent only from a server older than the field. */
  inbox?: OrgInbox;
  /** The CEO's desk session once opened (creation opens it). */
  ceoDeskSessionId?: string;
}

/**
 * The overview's inbox: the three things a person is waited on or told about — messages
 * that name them (or `@all`) in the all-hands channel, the tickets that are blocked (all of
 * them, whoever they wait on), and the tickets closed as done this period. Newest first in
 * each list; each capped at a page.
 */
export interface OrgInbox {
  mentions: OrgChannelMessage[];
  blockedTickets: OrgTicketItem[];
  doneTickets: Array<OrgTicketItem & { closedAt?: string }>;
}

export interface OrganizationCreateRequest {
  /** Semantic id, unique within the Project; also the directory name. */
  orgId: string;
  name?: string;
  mission: string;
  timezone?: string;
  /** An existing absolute directory to use as the shared workspace; default = the organization's own `workspace/`. */
  workspace?: string;
  /** The model for desks and ticket sessions (a configured pair); default = the Project default. */
  model?: { provider: string; modelId: string };
  /**
   * The CEO's monthly budget in USD, written as the `budget` of its `org_chart.yaml` entry.
   * Budgets are compared on the cumulative line, so the CEO's is the whole company's.
   * Omitted = 100; 0 is a real (zero) budget, not "unbounded" — only clearing the field
   * later (`PATCH …/employees/:agentId` with `budget: null`) leaves the CEO unbounded.
   */
  ceoBudget?: number;
  /** The working language; omitted = detected from the mission. */
  language?: OrgLanguage;
}

export interface OrganizationPatchRequest {
  name?: string;
  mission?: string;
  status?: OrgStatus;
  approvalMode?: OrgApprovalMode;
  timezone?: string;
  mentionChainLimit?: number;
  budgetWarnRatio?: number;
  budgetPauseRatio?: number;
  /** null returns to the organization's own `workspace/`. */
  workspace?: string | null;
  /** null returns to the Project default. */
  model?: { provider: string; modelId: string } | null;
  language?: OrgLanguage;
}

/**
 * What a proposed semantic id names. Each kind has its own shape — organization and channel
 * ids carry a `co_` / `ch_` prefix, a non-admin's Project id its owner's `<username>-`, a
 * Benchmark id is kebab-case — and its own set of ids to avoid.
 */
export type SemanticIdKind = "org" | "channel" | "project" | "agent" | "benchmark";

/**
 * A semantic id proposed for a display name — every create dialog that names an object with a
 * semantic id (a Project, an Agent, a Benchmark, an organization, a channel) lets the user name
 * the thing first and derive the id from that name. The server asks the Project's default
 * model for a short English id in the kind's spelling (a Chinese name has no mechanical
 * transliteration), falling back to an ASCII slug of the name when the model is unavailable,
 * and to a dated placeholder when neither can name it. The request never fails for a name it
 * cannot translate: a dialog that asked for an id always gets one back.
 */
export interface SemanticIdSuggestRequest {
  /** The display name typed so far (or the mission / description, when nothing else names the thing). */
  name: string;
  /** What the id is for: decides the id's shape, the prompt's examples and the ids avoided. */
  kind: SemanticIdKind;
  /**
   * Ids already in use in the target scope; the proposal avoids them. For a Project, an Agent or
   * a Benchmark, the server also avoids, on its own, every id that kind's create route refuses
   * as taken, a leftover folder no list shows included.
   */
  taken?: string[];
}

/**
 * Why a proposal fell all the way through to a placeholder — what the client tells the user to
 * explain the id it was just handed. `no_default_model`: the Project has no default model to
 * ask. `model_failed`: it was asked and the request failed (no credential, a rejection, a
 * timeout). `unusable_answer`: it answered twice and neither answer yielded an id.
 * `no_ascii`: no model was consulted at all and the name carries no ASCII to transliterate.
 */
export type SemanticIdSuggestReason =
  "no_default_model" | "model_failed" | "unusable_answer" | "no_ascii";

export interface SemanticIdSuggestResponse {
  /**
   * An id the kind's create route accepts, not in `taken`: `^[a-z][a-z0-9_]{1,63}$` for most
   * kinds, `<username>-<suffix>` for a non-admin's Project, kebab-case for a Benchmark.
   */
  id: string;
  /** Who produced it: the model, the ASCII fallback, or the dated placeholder that names nothing. */
  source: "model" | "fallback" | "placeholder";
  /** Present only with `source: "placeholder"`: why the two real paths produced nothing. */
  reason?: SemanticIdSuggestReason;
}

export interface OrgHireRequest {
  /** Employ an existing Agent … */
  agentId?: string;
  /** … or create one (the two are exclusive). Plugins default to agent-company + agent-development. */
  newAgent?: { agentId: string; name?: string; description?: string; plugins?: string[] };
  /**
   * What the organization calls the employee (any script, one line, no `@`, ≤ 64 characters).
   * Omitted, a new Agent's `name` is used; with neither, the Agent's display name stands in.
   */
  name?: string;
  title: string;
  reportsTo: string;
  workspace?: string;
  budget?: number;
  duties?: string;
  model?: { provider: string; modelId: string };
}

export interface OrgEmployeePatchRequest {
  /** null (or an empty string) clears the name: back to the Agent's display name. */
  name?: string | null;
  title?: string;
  reportsTo?: string;
  workspace?: string;
  /** null clears the budget. */
  budget?: number | null;
  duties?: string;
  /** null clears the model (back to the Project default). */
  model?: { provider: string; modelId: string } | null;
}

export interface OrgCalendarUpsertRequest {
  /** POST only: the employee the event belongs to. */
  agentId?: string;
  /** POST only: the file name. */
  name?: string;
  title?: string;
  prompt: string;
  enabled: boolean;
  startAt: string;
  period?: string;
  endAt?: string;
}

/**
 * What a calendar write answers: the stored event, plus advisory `warnings` — one line each —
 * about the rota: another employee's recurring event on the same start minute, or the same
 * employee already holding a recurring event (desks that fire together compete for the same
 * budget minute and the same tickets). The write succeeds regardless; the CLI prints the
 * lines so the scheduling employee can stagger.
 */
export interface OrgCalendarWriteResponse extends OrgCalendarItem {
  warnings?: string[];
}

export interface OrgTicketCreateRequest {
  title: string;
  /** Overrides the slug derived from the title; lowercase English words joined by hyphens. */
  slug?: string;
  goal?: string;
  acceptanceCriteria?: string;
  /** The whole Markdown body instead of goal + acceptanceCriteria (the frontmatter is still generated). */
  body?: string;
  /**
   * The responsible principal: an employee's `agent:<id>` (or bare Agent id) or a member's
   * `user:<id>`. Default = the caller — the session's employee inside a desk or ticket
   * session, else the token's or cookie's user.
   */
  owner?: string;
  parent?: string;
  notify?: string[];
  priority?: OrgTicketPriority;
  due?: string;
}

export interface OrgTicketUpdateRequest {
  title?: string;
  /** The new responsible principal; never null — a ticket always has an owner. */
  owner?: string;
  parent?: string | null;
  notify?: string[];
  priority?: OrgTicketPriority;
  due?: string | null;
  goal?: string;
  acceptanceCriteria?: string;
  result?: string;
}

export interface OrgTicketMoveRequest {
  status: OrgTicketStatus;
  /** Required when moving into rejected; recorded under Result. */
  reason?: string;
}

export interface OrgTicketBlockRequest {
  reason: string;
  /** A ticket id or a principal. */
  by?: string;
}

export interface OrgTicketProgressRequest {
  text: string;
  /**
   * The calling session (CLI: PENGUIN_SESSION_ID); the session is booked as a contributing
   * session and the history entry is attributed to its employee. Honoured only for a request
   * carrying the local API token — the control environment's credential; a signed-in user's
   * write is attributed to the user.
   */
  sessionId?: string;
  /**
   * The calling employee's Agent id (CLI: PENGUIN_AGENT_ID from the control environment), the
   * identity a write is recorded under; it wins over the session's employee, is honoured only
   * with the local API token, like sessionId, and is ignored — the write falls back to the
   * session's employee, then to the person — when it names no employee.
   */
  agentId?: string;
}

export interface OrgTicketStartRequest {
  /** The employee the ticket session runs as (CLI: PENGUIN_AGENT_ID); defaults to the ticket owner. */
  agentId?: string;
  message?: string;
  /** Another directory inside the shared workspace; defaults to the employee's desk workspace. */
  workspace?: string;
}

export interface OrgTicketStartResponse {
  sessionId: string;
}

export interface OrgTicketAttachRequest {
  sessionId: string;
}

export interface OrgChannelMessageSendRequest {
  text: string;
  refs?: { ticket?: string; session?: string; replyTo?: string };
  /**
   * The calling session (CLI: PENGUIN_SESSION_ID): the message is sent as its Agent and
   * inherits its hop. Honoured only for a request carrying the local API token — the control
   * environment's credential; a signed-in user's message is sent as the user, at hop 0.
   */
  sessionId?: string;
}

export interface OrgChannelReadRequest {
  /** Mark everything up to this message id as read. */
  upTo: string;
}

/** The handbook index (`handbook/README.md`), the file every work run reads first. */
export interface OrgHandbookResponse {
  content: string;
}

/** One file of the organization handbook (`handbook/`, the company's knowledge base); `path` is relative to that directory. */
export interface OrgHandbookFile {
  path: string;
  size: number;
  updatedAt: string;
}

export interface OrgHandbookFilesResponse {
  /**
   * The handbook directory's absolute path on this server: the Web App browses it with the Files
   * panel's own directory-addressed routes, which take the same Project access these do.
   */
  dir: string;
  /** The index first, then the other documents by path. */
  files: OrgHandbookFile[];
}

export interface OrgHandbookFileResponse {
  path: string;
  content: string;
}

export interface OrgHandbookFileWriteRequest {
  content: string;
}

/** Company-mode notifications on the user-level event stream (best effort; the query routes carry the durable state). */
export type CompanyServerEvent =
  /** A work run (desk session) or ticket session was started by the organization scheduler or a ticket start. */
  | {
      type: "org_run";
      projectId: string;
      orgId: string;
      agentId: string;
      sessionId: string;
      kind: OrgTriggerKind;
    }
  /** A new channel message (mentions included, so the client can tell whether it is addressed). */
  | {
      type: "org_channel";
      projectId: string;
      orgId: string;
      channelId: string;
      message: OrgChannelMessage;
    }
  /** A ticket's status, owner, blocked state or contributing sessions changed. */
  | { type: "org_ticket"; projectId: string; orgId: string; ticketId: string; change: string }
  /** Budget warning, pause or resume for an employee. */
  | {
      type: "org_budget";
      projectId: string;
      orgId: string;
      agentId: string;
      state: "warned" | "paused" | "resumed";
      ratio: number;
    };

// ---------------------------------------------------------------------------
// Web contributions (GET /api/contributions)
// ---------------------------------------------------------------------------

/** How the web app renders a contributed surface: a name from its own registry, or an iframe. */
export type RendererRef = { builtin: string } | { iframe: { src: string; namespace: string } };

/** One contribution to a web slot: its id, the contributing module, and the slot's data. */
export interface WebContribution {
  id: string;
  from: string;
  [key: string]: unknown;
}

/**
 * The data of one `WebModule.pages` contribution: its route, where it sits (`main` = the
 * development nav; `org` = a company-mode page — its path is relative to
 * `/org/:projectId/:orgId/` and it gets a nav row after the organization's own; `none` =
 * reachable by URL only), whether it is admin-only, its renderer; its nav row's name in English
 * and Chinese and its glyph (a name in the web UI's icon registry); and the key of the page it
 * sits under, if any — one level only, and a page whose parent is absent is not shown.
 */
export type WebPageData = {
  key: string;
  path: string;
  nav: "main" | "org" | "none";
  admin: boolean;
  renderer: RendererRef;
  parent?: string;
  title?: string;
  titleZh?: string;
  icon?: string;
};

/** A page contribution as GET /api/contributions answers it. */
export type WebPageContribution = WebContribution & WebPageData;

/**
 * The data of one `WebModule.fileRenderers` contribution: the Workspace files it draws, by
 * extension (without the dot, compared case-insensitively), and the renderer that draws one.
 * Where the app shows it is the app's own choice (below a reply's paragraph that links the file).
 */
export type WebFileRendererData = {
  extensions: string[];
  renderer: RendererRef;
};

/** A file renderer contribution as GET /api/contributions answers it. */
export type WebFileRendererContribution = WebContribution & WebFileRendererData;

/**
 * The data of one `WebModule.pageRemovals` contribution: the key of a page the web app drops —
 * one of its own or one another plugin contributed. The app drops the routes under the page's
 * path and the pages under it with it, and keeps the page its catch-all leads to.
 */
export type WebPageRemovalData = {
  key: string;
};

/** A page removal as GET /api/contributions answers it. */
export type WebPageRemovalContribution = WebContribution & WebPageRemovalData;

export interface ContributionsResponse {
  pages: WebPageContribution[];
  fileRenderers: WebFileRendererContribution[];
  pageRemovals: WebPageRemovalContribution[];
  agentTabs: WebContribution[];
  sessionTabs: WebContribution[];
}

/** One command a plugin contributes to the CLI, as GET /api/cli/commands lists it. */
export interface PluginCliCommandInfo {
  /** The plugin package that contributes it — what `penguin exec` names. */
  package: string;
  /** `a.b.c`: the argv segments it answers (`penguin a b c ARGS`). */
  key: string;
  /** Its one-line summary, per language. */
  summary: { en: string; zh: string };
}

/** GET /api/cli/commands: every command the server's plugins contribute, in load order. */
export interface PluginCliCommandsResponse {
  commands: PluginCliCommandInfo[];
}

/** POST /api/cli/commands/run: runs argv against one plugin's commands on the server. */
export interface PluginCliCommandRunRequest {
  /** The plugin package, as the listing names it. */
  package: string;
  /** The arguments, as they would follow the program name. */
  args: string[];
  /** The language the caller resolved, for the summaries and the command's own text. */
  language: "en" | "zh";
  /** The program name usage lines print (`penguin`, or `penguin exec <plugin>`). */
  prog: string;
}

/** What one run printed, and its exit code. */
export interface PluginCliCommandRunResponse {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * One field of a settings group a module declares (its `PluginConfigProvider.groups`
 * contribution's `properties.<name>`): what the Settings dialog draws for it. `secret` is
 * drawn as a password field and masked on the way out; `enum` is a choice among `options`;
 * `list` is a list of strings, drawn one per line; `table` is a fixed set of `rows`, each a
 * value per one of its `columns`, drawn as a table.
 */
export interface PluginConfigField {
  type: "string" | "secret" | "boolean" | "number" | "enum" | "list" | "table";
  title: string;
  titleZh?: string;
  /** What the field means: disclosed behind a "?" beside its title. */
  description?: string;
  descriptionZh?: string;
  /**
   * The shape a value must take ("one absolute path per line"): shown under the field at all
   * times, since it is read while typing.
   */
  hint?: string;
  hintZh?: string;
  placeholder?: string;
  /** The value a package with nothing stored reads; also what an empty field falls back to. */
  default?: string | number | boolean | string[];
  /**
   * Drawn in the card's Advanced fold, collapsed by default, rather than among the basic
   * fields. Presentation only: it is stored, validated and read like any other field.
   */
  advanced?: boolean;
  /** A save that would leave this field empty is refused. */
  required?: boolean;
  /** `enum` only: the values it may take, in display order. */
  options?: PluginConfigOption[];
  /** `list` only: the most entries a save may leave (after trimming and de-duplicating). */
  maxItems?: number;
  /** `number` only: the smallest and largest value a save may store. */
  minimum?: number;
  maximum?: number;
  /** `string` / `list` only: a regular expression every value (every line) must match. */
  pattern?: string;
  /** What a save refused by `pattern` says, after the field's name (e.g. "must be an absolute path"). */
  patternErrorMessage?: string;
  /**
   * `table` only: its columns, in display order, and its rows, in display order. The table
   * has no `default`: the rows' declared cells are its defaults, and what is stored is only
   * the cells that differ from them — `{ [row id]: { [column]: value } }`.
   */
  columns?: PluginConfigTableColumn[];
  rows?: PluginConfigTableRow[];
  /**
   * `table` only: a single choice of one row — the sandbox's default preset. The choice is
   * stored in `field`, an `enum` field of the same group whose options are the row ids (plus,
   * in an `extensible` table, the ids of the rows added to it); the page draws that field only
   * as its title in brackets after the chosen row's name ("(Default)"), and picks it from a
   * row's "…" menu.
   */
  rowChoice?: PluginConfigRowChoice;
  /**
   * `table` only: rows may be added (and only those deleted, from the row's "…" menu) and every
   * row reordered. A new row
   * starts from these values. What is stored, beside the declared rows' changed cells, is the
   * added rows under `"$added"` (`{ [row id]: { [column]: value } }`, every column present) and
   * the row order under `"$order"` (row ids); neither key can be a row id. A save sends either
   * key whole; a document without them reads as the declared rows in declared order.
   */
  extensible?: PluginConfigNewRow;
  /**
   * `table` only: a header drawn over adjacent columns that belong together (the sandbox's
   * Pin, under "Action"). `columns` names them. When the group ends the columns, the row's drag
   * handle and "…" menu join it.
   */
  columnGroup?: PluginConfigColumnGroup;
  /**
   * `table` only: a `boolean` column drawn as a pin toggle rather than a switch — a row pinned
   * to a list (the sandbox presets in the composer's menu). The texts are its tooltip in each
   * state. Declared on the table, not the column, so every column keeps one shape.
   */
  pin?: PluginConfigPinColumn;
}

/** A table's pin column: which boolean column, and its tooltip pinned and not. */
export interface PluginConfigPinColumn {
  column: string;
  on: string;
  onZh?: string;
  off: string;
  offZh?: string;
}

/**
 * A table's single choice of a row: the `enum` field it stores into, and its title, drawn in
 * brackets after the chosen row's name. The choice may name no row (nothing stored, and the
 * group's `derive` gives none): no row is marked and a save is not refused for it. A save that
 * leaves it naming a row the table no longer has is refused.
 */
export interface PluginConfigRowChoice {
  field: string;
  title: string;
  titleZh?: string;
}

/** One column of a `table` field: a scalar field type (`string`, `boolean`, or an `enum` with `options`). */
export interface PluginConfigTableColumn {
  name: string;
  type: "string" | "boolean" | "enum";
  title: string;
  titleZh?: string;
  /** What the column means: disclosed behind a "?" beside its header. */
  description?: string;
  descriptionZh?: string;
  options?: PluginConfigOption[];
}

/** One row of a `table` field: its id and its declared cells. */
export interface PluginConfigTableRow {
  id: string;
  /** Every column's declared value. */
  values: Record<string, string | boolean>;
  /** A string cell's declared value in Chinese, shown until a save changes the cell. */
  valuesZh?: Record<string, string>;
  /** Columns whose cell in this row a save may not change. */
  locked?: string[];
  /** A row added to an `extensible` table (not declared): the only kind that may be deleted. */
  added?: boolean;
  /**
   * What the row is for, disclosed behind a "?" beside its name while its `enum` cells hold
   * their declared values. A row without one, or whose choices changed, gets a "?" listing its
   * `enum` cells' values and what each does (the options' `description`s).
   */
  description?: string;
  descriptionZh?: string;
}

/** A header over adjacent table columns, with its own "?". */
export interface PluginConfigColumnGroup {
  title: string;
  titleZh?: string;
  description?: string;
  descriptionZh?: string;
  columns: string[];
}

/** The values a row added to an `extensible` table starts from. */
export interface PluginConfigNewRow {
  /** The add button's text ("Add preset"). */
  add?: string;
  addZh?: string;
  values: Record<string, string | boolean>;
  /** A string column's starting text in Chinese. */
  valuesZh?: Record<string, string>;
}

/** One choice of an `enum` field. */
export interface PluginConfigOption {
  value: string;
  title: string;
  titleZh?: string;
  /** What picking it does: listed, for a table column's option, in a row's "?" (see the row's `description`). */
  description?: string;
  descriptionZh?: string;
}

/** A declared configuration: a titled group of fields, in declaration order. */
export interface PluginConfiguration {
  title?: string;
  titleZh?: string;
  description?: string;
  descriptionZh?: string;
  /**
   * A `boolean` field that turns the group on (the sandbox's `enabled`). While it is off, as
   * drafted, the card draws that field alone: no other field, notice or action, and none of the
   * groups drawn inside it. Turning it on in a group that reports a `backend` it lacks offers
   * to install one.
   */
  switch?: string;
  properties: Record<string, PluginConfigField>;
}

/** A line of live status a contributed group reports beside its fields (e.g. that nothing can enforce it). */
export interface PluginConfigNotice {
  /**
   * `progress` = work the group started is still running (an install, a download): the page
   * reads the groups again every few seconds while any notice says so, and the text is the
   * step it is on.
   */
  tone: "attention" | "muted" | "progress";
  text: string;
  textZh?: string;
  /** More about the notice, disclosed under it on request; lines separated by `\n`. */
  details?: string;
  detailsZh?: string;
}

/** One settings group (GET /api/admin/plugin-config): its schema and its values, secrets masked. */
export interface PluginConfigEntry {
  /** The group's name — the id of the contribution that declared it; also the store key. */
  name: string;
  configuration: PluginConfiguration;
  /** Stored values merged onto the defaults; a secret arrives masked (`first4…last4` or `***`), never in the clear. */
  values: Record<string, unknown>;
  /** Drawn inside that entry's card and saved with it (a sandbox backend's options inside the sandbox's). */
  parent?: string;
  /** Live status beside the fields; absent when there is none. */
  notices?: PluginConfigNotice[];
  /** What this group can DO once, on the machine, drawn as buttons beneath its notices. */
  actions?: PluginConfigActionDecl[];
  /** Enum options this machine cannot honour now: drawn greyed out with the reason; a save choosing one is refused. */
  unavailable?: PluginConfigUnavailableDecl[];
  /**
   * For a group whose settings a backend plugin enforces (the sandbox): whether one that
   * applies to this machine's OS is installed, and which packages this OS defaults to. The card
   * offers to install `recommended` when the group's switch is turned on and none is installed.
   * Asked per read, like the notices; the client never guesses the OS.
   */
  backend?: PluginConfigBackend;
}

/** Whether a backend that applies to this machine is installed, and this OS's default ones. */
export interface PluginConfigBackend {
  /** A backend for this OS is installed: loaded, or installed and failing its check. */
  installed: boolean;
  /**
   * The npm packages this OS defaults to, installed together; absent on an OS with no default
   * backend. Linux names two: bubblewrap, and sandbox-dsh, which confines files through
   * Landlock where bubblewrap is refused.
   */
  recommended?: string[];
}

/** One enum option (or boolean position) a settings group cannot honour on this machine, and why. */
export interface PluginConfigUnavailableDecl {
  field: string;
  /** A `table` field's column: the option is unavailable in every cell of that column. */
  column?: string;
  /** An enum option, or a boolean field's position: "true" or "false". */
  value: string;
  reason: string;
  reasonZh?: string;
}

/** One button under a settings group: what it is called, and what pressing it will do. */
export interface PluginConfigActionDecl {
  id: string;
  title: string;
  titleZh?: string;
  description?: string;
  descriptionZh?: string;
}

/** POST /api/admin/plugin-config/action — what running one reported. */
export interface PluginConfigActionResponse {
  ok: boolean;
  message: string;
  messageZh?: string;
  /** The groups as they stand after it ran: a setup that worked changes what the page says. */
  plugins: PluginConfigEntry[];
}

export interface PluginConfigResponse {
  plugins: PluginConfigEntry[];
}

/**
 * PUT /api/admin/plugin-config — one group's update. Every named field is validated
 * against its type; an omitted field keeps its stored value; a secret sent as the masked
 * value keeps the stored one, and `null` or `""` clears any field. 400 `plugin_config_invalid`
 * (with `field`) on a value that does not fit or a required field left empty; 404
 * `plugin_config_unknown` for a name no group answers to.
 */
export interface PluginConfigUpdateRequest {
  name: string;
  values: Record<string, unknown>;
}

/**
 * An installed plugin the running build cannot fully run (plugin/unsatisfied.ts): it
 * contributes to a slot, or wires to a module or interface, that this build does not have.
 * Also what a refused push names (`plugins_unsatisfied`) and a confirmed one reports.
 */
export interface UnsatisfiedPlugin {
  /** The package specifier, as the installed-plugins list spells it. */
  specifier: string;
  /** True when the whole plugin is left out of this generation; false when only the contributions this build has no slot for were dropped and the rest of it runs. */
  disabled: boolean;
  /** What this build lacks, in the platform's own words. */
  reason: string;
}

/** One plugin a Project lists (GET /api/projects/:projectId/plugins/installed). */
export interface InstalledPlugin {
  /** The package specifier as written in the file. */
  specifier: string;
  /** Whether the running process holds this package — its modules are in the tree. */
  active: boolean;
  /**
   * Where the package came from: shipped with the build (a hot push's assets, or the
   * installation's own `plugins/`) rather than fetched from npm. A tag on an installed
   * plugin — being shipped is not being installed.
   */
  builtin: boolean;
  /** Module names the package declares it adds. */
  modules: string[];
  /** Node names the package declares it stands in for. */
  replaces: string[];
  /**
   * Why the package is not running: unresolvable, or a load that
   * failed (an import that threw, a module name another plugin already took). Only ever
   * reported for a plugin this server is asked to run (`here`).
   */
  error?: string;
  /**
   * Present when this build cannot fully run the package (see {@link UnsatisfiedPlugin}).
   * With `disabled`, `active` is false and a restart would not load it; without, the package
   * runs minus the contributions this build has no slot for. Only reported for a plugin this
   * server is asked to run (`here`).
   */
  unsatisfied?: Pick<UnsatisfiedPlugin, "disabled" | "reason">;
  /** Listed in the shared `[plugins]` table: every machine runs it. */
  everywhere: boolean;
  /** The machines whose own `[plugins.<machineId>]` table lists it, by machine id. */
  machines: string[];
  /**
   * Whether THIS server is asked to run it — shared, or listed for this server's own id. A
   * plugin listed only for other machines is neither installed nor loaded here, so `active`
   * is false and no `error` is reported for it.
   */
  here: boolean;
}

/** What an install put on this server (POST …/plugins/installed and …/installed/archive). */
export interface PluginInstallOutcome {
  /** The package name npm installed — for a link, the name its package.json carries. */
  name: string;
  version: string | null;
  /** It carries skills, a hook package or MCP servers: the library lists it, and nothing loads it. */
  library: boolean;
  /** It carries server modules: the Project's list loads it. */
  modules: boolean;
  /** The zip held the version already installed: nothing was installed. */
  unchanged?: boolean;
}

/** POST /api/projects/:projectId/plugins/installed/archive (admin): a plugin package zip, base64. */
export interface PluginArchiveImportRequest {
  dataBase64: string;
  /** Replace another installed version of the package (the 409 `plugin_exists` question). */
  overwrite?: boolean;
}

export interface InstalledPluginsResponse {
  plugins: InstalledPlugin[];
  /** After an install: what landed on this server. */
  installed?: PluginInstallOutcome;
  /**
   * Specifiers this build SHIPS (the hot push's assets, or the installation's own
   * `plugins/`): installable without a download, and not installed until listed.
   */
  shipped: string[];
  /** The file the list lives in, named for the page that explains where to edit it by hand. */
  file: string;
  /** This server's own machine id — the key of its `[plugins.<machineId>]` table. */
  machineId: string;
  /** A listed plugin neither runs, nor failed to load, nor is one this build cannot run: the App could not be re-assembled around it (the previous one was restored), so a restart is what applies it. */
  restartPending: boolean;
}

// ---------------------------------------------------------------------------
// The agent browser, two backends behind one link (see builtin-browser/): the desktop's
// built-in browser — Electron <webview> guests in the persist:penguin-browser partition,
// driven over CDP by the shell on the server's behalf — and the user's own Chrome, driven
// through the PenguinHarness Browser extension over a WebSocket the extension opens.
// ---------------------------------------------------------------------------

/** The browser an agent drives: the desktop's built-in one, or the user's own Chrome. */
export type BrowserBackend = "builtin" | "chrome";

/**
 * What a backend's link can do. The shell cannot create tabs (the Web App's <webview> does) and
 * throttles and measures its guests; the extension creates, closes and focuses tabs itself and
 * has no cookie store the server may touch.
 */
export interface BrowserLinkCapabilities {
  /** `open-tab`, `close-tab` and `activate-tab` are answered (chrome). */
  createsTabs: boolean;
  /** `throttle` and the `metrics` events (builtin). */
  throttles: boolean;
  /** `set-cookies` and `clear-data` (builtin). */
  cookieStore: boolean;
}

/**
 * One tab of the agent browser. Built-in: a guest page, `id` its webContents id. Chrome: a tab
 * the extension drives (one it created in the Penguin tab group, or one the user added), `id`
 * Chrome's tab id; `canGoBack`/`canGoForward` are always false there (the tabs API cannot read
 * them).
 */
export interface BuiltinBrowserTab {
  id: number;
  /** The built-in tab belongs to this conversation; absent for pages opened outside a conversation. */
  sessionId?: string;
  /** Electron storage partition, shared only within this tab's Project. */
  partition?: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  favicon?: string;
  /**
   * Present while the page's renderer is gone, with Electron's reason (`crashed`, `oom`,
   * `killed`, …): the panel shows the crash until the page is reloaded, and an agent action on
   * the tab answers 409 `tab_crashed`.
   */
  crashed?: string;
}

/**
 * Why the agent browser cannot be driven. Built-in: not under the desktop shell, a shell too old
 * to host it, or no app window to host a new tab. Chrome: this user has no paired extension, it
 * is paired but not connected now, or an admin switched Chrome connections off server-wide.
 */
export type BuiltinBrowserUnavailableReason =
  | "not_desktop"
  | "shell_unsupported"
  | "no_window"
  | "extension_not_paired"
  | "extension_disconnected"
  | "extension_disabled";

/** One backend as GET /status lists it for the caller. */
export interface BrowserBackendInfo {
  backend: BrowserBackend;
  available: boolean;
  reason?: BuiltinBrowserUnavailableReason;
  /** chrome: the caller's connected extension, else the one seen most recently; absent when none is paired. */
  extension?: {
    id: string;
    name: string;
    version: string;
    connected: boolean;
    lastSeenAt: string | null;
  };
}

/**
 * GET /api/builtin-browser/status: the caller's effective backend (`backend`) — whether it can
 * be driven now, its tabs — and every backend this server offers the caller (`backends`).
 */
export interface BuiltinBrowserStatus {
  /** Whether the effective backend can be driven now. */
  available: boolean;
  reason?: BuiltinBrowserUnavailableReason;
  backend: BrowserBackend;
  backends: BrowserBackendInfo[];
  tabs: BuiltinBrowserTab[];
  activeTabId: number | null;
  /** The shell's latest measurement of the built-in browser's load; absent before its first one, and on chrome. */
  metrics?: BuiltinBrowserMetrics;
}

/** GET / PUT /api/builtin-browser/backend: the caller's backend and the ones they may choose. */
export interface BrowserBackendResponse {
  backend: BrowserBackend;
  choices: BrowserBackend[];
}

/** One Chrome paired to the caller's account (a row of `browser_extensions`). */
export interface BrowserExtensionRecord {
  id: string;
  /** As the extension names itself, e.g. "Chrome 130 on macOS". */
  name: string;
  version: string;
  createdAt: string;
  lastSeenAt: string | null;
  /** Whether this one holds the caller's connection now (one at a time per user). */
  connected: boolean;
}

/** GET /api/builtin-browser/extension. */
export interface BrowserExtensionsResponse {
  paired: BrowserExtensionRecord[];
  /** The id of the connected one, when one is. */
  connected?: string;
  /** The admin's server-wide switch (`ServerSettings.browserExtensionsEnabled`). */
  enabled: boolean;
}

/**
 * POST /api/builtin-browser/extension/pairings: a one-time code for the signed-in user, valid
 * for ten minutes, used once; the dialog shows it beside the server address.
 */
export interface BrowserExtensionPairingResponse {
  /** 43 base64url characters. */
  code: string;
  /** ISO time the code stops working. */
  expiresAt: string;
  /**
   * The address the browser reaches this server at, which the extension pairs with: the public
   * origin (scheme, host and port; from the forwarded headers when the server trusts a proxy).
   * Null only from an older server, which echoed the request's `Origin` and had none to echo for
   * a call that carried no `Origin`.
   */
  origin: string | null;
}

/** POST /api/builtin-browser/extension/pair (no cookie: the extension's own request). */
export interface BrowserExtensionPairRequest {
  code: string;
  /** How the extension names this Chrome, e.g. "Chrome 130 on macOS" (1–80 characters). */
  name: string;
  /** The extension's own version (manifest.version). */
  version: string;
}

/** What /extension/pair answers: the long-lived token, shown once and stored only hashed here. */
export interface BrowserExtensionPairResponse {
  extensionId: string;
  /** Rides the WebSocket's subprotocol list as `token.<token>`; never a URL. */
  token: string;
  /** This server's install id (a stable name for the data root); null when it is unknown. */
  installId: string | null;
  user: { userId: string; displayName: string | null };
  serverVersion: string;
}

/**
 * The extension WebSocket's close codes (`/api/builtin-browser/extension/ws`). Besides these the
 * server closes with 1012 when it restarts or hot-swaps (reconnect with the usual backoff).
 *
 * - 4001 replaced: another extension of the same user connected (last connected wins); do not
 *   auto-retry.
 * - 4003 revoked: the pairing was revoked (or the token was); forget this server.
 * - 4005 protocol_mismatch: no `penguin-browser.1` subprotocol, or a hello the server does not
 *   speak; the extension needs updating.
 * - 4008 ping_timeout: two pings (or the hello) went unanswered.
 * - 4009 disabled: an admin switched Chrome connections off; retry hourly.
 */
export type BrowserExtensionCloseCode = 4001 | 4003 | 4005 | 4008 | 4009;

/** One tab's share of the built-in browser's load, as the shell last measured it. */
export interface BuiltinBrowserTabMetrics {
  tabId: number;
  /** The memory held by the processes behind the page (its own and its cross-site frames'), KB. */
  memoryKB: number;
  /** Their CPU use since the previous measurement, in percent of one core. */
  cpuPercent: number;
}

/** Why the built-in browser should be lighter. */
export type BuiltinBrowserLoadWarning =
  /** Its pages together hold more memory than they should. */
  | "memory"
  /** This computer is running out of memory. */
  | "low_system_memory"
  /** More tabs are open than the browser should hold. */
  | "many_tabs";

/**
 * The built-in browser's load: GET /status's `metrics`, and the `builtin_browser_metrics` event
 * after each of the shell's measurements (every ~10 s while tabs are open, and soon after one
 * closes). The thresholds are the server's; the UI and the CLI only word what it concluded.
 */
export interface BuiltinBrowserMetrics {
  /** When the server received the measurement (epoch ms). */
  at: number;
  tabs: BuiltinBrowserTabMetrics[];
  /** All the pages' memory, a process two tabs share counted once, KB. */
  totalKB: number;
  /**
   * This computer's memory, KB. Absent on macOS, whose free count leaves out the memory it would
   * readily hand back, so that "free" there reads as nearly none on a healthy machine.
   */
  system?: { freeKB: number; totalKB: number };
  /** What to warn about now; empty when all is well. */
  warnings: BuiltinBrowserLoadWarning[];
  /** While a memory warning stands: the tabs holding the most memory, heaviest first. */
  heavyTabIds: number[];
}

/** GET /api/builtin-browser/tabs. */
export interface BuiltinBrowserTabsResponse {
  tabs: BuiltinBrowserTab[];
  activeTabId: number | null;
}

/** POST /api/builtin-browser/tabs/:tab/scan — GenericAgent's web_scan. */
export interface BuiltinBrowserScanResult {
  tab: BuiltinBrowserTab;
  tabs: BuiltinBrowserTab[];
  activeTabId: number | null;
  /** Simplified HTML, or plain text with `textOnly`. */
  content?: string;
  truncated?: boolean;
}

/** POST /api/builtin-browser/tabs/:tab/exec (and click / type) — GenericAgent's web_execute_js. */
export interface BuiltinBrowserExecResult {
  status: "success" | "failed";
  tabId: number;
  /** The script's JSON-safe return value. */
  value?: unknown;
  error?: string;
  /** The page navigated or reloaded while the script ran. */
  reloaded?: boolean;
  /** Tabs opened while the call ran (popups, target=_blank). */
  newTabs?: { id: number; url: string }[];
  /** Text that appeared during the call and may be gone again (toasts, flashes). */
  transients?: string[];
  diff?: { changed: number; topChange?: string };
  suggestion?: string;
  /** click only: where the trusted click landed. */
  clicked?: { x: number; y: number; tag?: string; text?: string };
  /** The page's dialogs the call answered, in order (see BuiltinBrowserDialog). */
  dialogs?: BuiltinBrowserDialog[];
}

/**
 * A dialog the page opened during an exec, click or type, which the call answered so the page
 * would not block: an alert is accepted, and a confirm, prompt or leave-page dialog dismissed
 * unless the request said `acceptDialogs`.
 */
export interface BuiltinBrowserDialog {
  type: "alert" | "confirm" | "prompt" | "beforeunload";
  message: string;
  accepted: boolean;
}

/** POST /api/builtin-browser/tabs/:tab/screenshot. */
export interface BuiltinBrowserScreenshot {
  mime: "image/png";
  /** Base64. */
  data: string;
}

export type BuiltinBrowserImportBrowser =
  "chrome" | "edge" | "brave" | "chromium" | "vivaldi" | "opera" | "arc" | "firefox";

/** One profile of a system browser that can be imported from. */
export interface BuiltinBrowserImportSource {
  /** `<browser>:<profile dir>`, e.g. `chrome:Default`. */
  id: string;
  browser: BuiltinBrowserImportBrowser;
  browserName: string;
  /** The profile's directory name. */
  profile: string;
  /** The profile's display name. */
  profileName: string;
  hasCookies: boolean;
  hasHistory: boolean;
}

export interface BuiltinBrowserImportSourcesResponse {
  sources: BuiltinBrowserImportSource[];
}

/** POST /api/builtin-browser/import. */
export interface BuiltinBrowserImportRequest {
  sessionId?: string;
  projectId?: string;
  sourceId: string;
  cookies?: boolean;
  history?: boolean;
  /** Only cookies of these sites (a domain matches itself and its subdomains). */
  domains?: string[];
}

export interface BuiltinBrowserImportResult {
  sourceId: string;
  cookies?: { found: number; imported: number; skipped: number; failed: number };
  history?: { found: number; imported: number };
  warnings: string[];
}

export interface BuiltinBrowserHistoryEntry {
  url: string;
  title: string;
  visitCount: number;
  /** Epoch ms. */
  lastVisitAt: number;
  /** `builtin` for pages visited in the built-in browser, else the browser it was imported from. */
  source: string;
}

export interface BuiltinBrowserHistoryResponse {
  entries: BuiltinBrowserHistoryEntry[];
}

/**
 * GET / PUT /api/builtin-browser/settings: the browser's own settings, a file of the server's
 * that is read and written without the desktop shell. PUT takes the whole object.
 */
export interface BuiltinBrowserSettings {
  /**
   * The page a new tab opens when it is given no address — the panel's "+", an agent's new tab
   * — and the toolbar's Home button goes to: an http(s) address, or null for none (a new tab is
   * then blank). PUT takes a bare host too and answers the address as stored.
   */
  homepage: string | null;
}

export type BuiltinBrowserAction =
  "navigate" | "scan" | "exec" | "click" | "type" | "screenshot" | "cdp";

/**
 * User-channel events of the agent browser. The built-in backend's go to every admin; a chrome
 * backend's go to the user whose Chrome it is, as do `builtin_browser_backend` and
 * `builtin_browser_extension`.
 */
export type BuiltinBrowserServerEvent =
  /**
   * A backend's whole tab list. `backend` names whose: a desktop admin hears both the built-in
   * browser's and their own Chrome's, and the two lists must not overwrite each other.
   */
  | {
      type: "builtin_browser_tabs";
      tabs: BuiltinBrowserTab[];
      activeTabId: number | null;
      backend: BrowserBackend;
    }
  /** Create a guest for `url`, then POST /tabs/claim with `requestId` once it has a webContents id. */
  | {
      type: "builtin_browser_open";
      partition?: string;
      requestId: string;
      url: string;
      activate: boolean;
      openerTabId?: number;
      sessionId?: string;
    }
  | { type: "builtin_browser_close"; tabId: number }
  /** A draft or healed conversation acquired its permanent id. */
  | { type: "builtin_browser_session"; fromSessionId: string; sessionId: string }
  | {
      type: "builtin_browser_activity";
      tabId: number;
      busy: boolean;
      action: BuiltinBrowserAction;
      sessionId?: string;
    }
  /** The shell measured the browser's load (see BuiltinBrowserMetrics). */
  | { type: "builtin_browser_metrics"; metrics: BuiltinBrowserMetrics }
  /** The user switched backend (PUT /backend); every window of theirs follows. */
  | { type: "builtin_browser_backend"; backend: BrowserBackend }
  /** The user's Chrome connected, went away, was replaced by another Chrome of theirs, or was revoked. */
  | {
      type: "builtin_browser_extension";
      state: "connected" | "disconnected" | "replaced" | "revoked";
      extension?: BrowserExtensionRecord;
    };

/** A cookie as the shell writes it (Electron's CookiesSetDetails). */
export interface DesktopBrowserCookie {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  /** Unix seconds; absent = session cookie. */
  expirationDate?: number;
  sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
}

/**
 * Server → browser link: what the shell (built-in) or the extension (chrome) does with its tabs.
 * Mechanism only — the product logic stays on the server. The names are historical: the same
 * envelopes travel the extension's WebSocket as JSON text frames.
 */
export type DesktopBrowserCommand =
  /** Reply: a BrowserHello. An older shell never answers. */
  | { op: "hello" }
  /** Reply: `{ tabs: BuiltinBrowserTab[] }`. */
  | { op: "tabs" }
  /**
   * Reply: the CDP method's result object. `events` names the tab's CDP events the shell relays
   * from then on, as `cdp-event`s: it replaces the list before (empty relays none), and is set
   * before the command runs, so an event the command itself causes is not missed. Without it
   * the list stays as it is.
   */
  | {
      op: "cdp";
      tabId: number;
      method: string;
      params?: Record<string, unknown>;
      events?: string[];
    }
  /** Reply: `{ set: number; failed: number; errors: string[] }` (at most 10 errors). */
  | { op: "set-cookies"; cookies: DesktopBrowserCookie[]; partition?: string }
  /** Reply: `{}`. */
  | { op: "clear-data"; storages: ("cookies" | "cache" | "storage")[]; partition?: string }
  /**
   * Reply: `{}`. The tabs whose pages may be throttled while out of sight (Electron's background
   * throttling, applied at once); every other tab runs at full speed. It replaces the list
   * before. A tab is unthrottled until a command lists it, so a server that never sends one
   * changes nothing. A shell older than this command answers `unknown_op`.
   */
  | { op: "throttle"; tabIds: number[] }
  /**
   * Chrome only (the shell answers `unknown_op`). Reply: `{ tab: BuiltinBrowserTab }`. A tab at
   * `url` (http(s) or about:blank, checked by the server) in the extension's Penguin tab group;
   * `activate` asks for it to be the selected tab of its window.
   */
  | { op: "open-tab"; url: string; activate: boolean }
  /** Chrome only. Reply: `{}`. Closes a tab the extension drives. */
  | { op: "close-tab"; tabId: number }
  /** Chrome only. Reply: `{}`. Shows the tab in the user's Chrome (selects it, focuses its window). */
  | { op: "activate-tab"; tabId: number }
  /** Chrome only. Reply: `{}`. Sent every 20 s; the traffic keeps the MV3 service worker alive. */
  | { op: "ping" };

/**
 * The `hello` reply. Built-in: `{ version: 1, partition }` (an older shell sends no `backend`).
 * Chrome: `{ version: 1, backend: "chrome", extension }`; any other version is closed 4005.
 */
export interface BrowserHello {
  version: 1;
  backend?: BrowserBackend;
  partition?: string;
  extension?: { version: string; chrome: string; name: string };
}

export interface DesktopBrowserCommandMessage {
  type: "desktop-browser-command";
  id: string;
  command: DesktopBrowserCommand;
}

export interface DesktopBrowserReplyMessage {
  type: "desktop-browser-reply";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export type DesktopBrowserEvent =
  | { kind: "tab"; tab: BuiltinBrowserTab }
  | { kind: "tab-closed"; tabId: number }
  /**
   * window.open / target=_blank inside a guest (the shell denied it and asks for a tab instead),
   * or the context menu's "Open link in new tab". `background`: the tab should open behind the
   * current one, as a middle-click or that menu entry does in Chrome.
   */
  | { kind: "open-request"; url: string; openerTabId: number; background?: boolean }
  /** One of the tab's CDP events a `cdp` command's `events` asked for. */
  | { kind: "cdp-event"; tabId: number; method: string; params: Record<string, unknown> }
  /**
   * The tab's renderer went away (Electron's render-process-gone reason and exit code). The tab
   * stays; its `tab` events carry `crashed` until the page is reloaded, and the shell refuses
   * CDP commands for it meanwhile (`tab_crashed`).
   */
  | { kind: "tab-crashed"; tabId: number; reason: string; exitCode: number }
  /**
   * The shell's measurement of its guests (every ~10 s while there are any, and once more
   * shortly after one closes, empty after the last): each tab's memory and CPU, and the pages'
   * memory together, a process shared by two tabs counted once.
   */
  | { kind: "metrics"; tabs: BuiltinBrowserTabMetrics[]; totalKB: number }
  /**
   * Chrome only: the tab still exists in Chrome but the agent may no longer drive it — the user
   * pressed Cancel on Chrome's debugging bar (`user`), the debugger went away otherwise
   * (`detached`), or the page is one Chrome lets no extension attach to (`restricted`). The
   * extension fails that tab's pending commands with the error `tab_released`.
   */
  | { kind: "tab-released"; tabId: number; reason: "user" | "detached" | "restricted" };

export interface DesktopBrowserEventMessage {
  type: "desktop-browser-event";
  event: DesktopBrowserEvent;
}

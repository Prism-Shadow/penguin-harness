/**
 * The API vocabulary of the setting domain: the theme-pack picker's DTOs, the account's
 * keyboard-shortcut overrides, and the desktop shell relay's wire shapes (the updater
 * snapshot and commands, the tray, the folder-access handshake, the host commands).
 *
 * The server's `api/types.ts` re-exports these so the Web App keeps reading them from the
 * server's own `/api` surface.
 */

/**
 * The Web App's files this server serves: the built-in theme packs travel inside them.
 * The shape lives on the server's UI-runtime holder (workbenches/ui-runtime.ts) — declared
 * here structurally so the theme store needs no import from the server.
 */
export type WebFiles = { kind: "mem"; files: Map<string, Buffer> } | { kind: "dir"; dir: string };

// ---------------------------------------------------------------------------
// Theme packs (per server: an admin imports, every account picks; PRFC-0026)
// ---------------------------------------------------------------------------
//   GET    /api/themes                  → ThemePacksResponse (any user): the imported packs
//                                         only, in the order they were installed; the client
//                                         ships its built-in packs itself
//   GET    /api/themes/:id/files/<path> → one file the pack serves (any user): its `index.css`,
//                                         a font or a drawing; 404 for anything else
//   POST   /api/themes[?replace=1]      → 201 ThemePackImportResponse (admin). The body is the
//                                         raw zip sent as `application/octet-stream`. Refusals:
//                                         400 `theme_invalid` (details: ThemeInvalidDetails),
//                                         400 `theme_id_reserved`, 409 `theme_exists` (details:
//                                         `themeId`) unless `replace=1`, 413 `theme_too_large`,
//                                         422 `theme_api_unsupported`, 503 `themes_unavailable`
//   DELETE /api/themes/:id              → 204 (admin); 400 `theme_builtin`, 404 `theme_not_found`
//   GET    /api/themes/:id/export       → the pack as a zip attachment (any user), built-in or
//                                         imported; 404 `theme_not_found`
// Every write tells every signed-in tab with `themes_changed` on the user event stream.

/** A theme mode, as a manifest names it. */
export type ThemePackMode = "light" | "dark";

/**
 * What a pack builds on: `modern`, Frost's token values and its hook recipes (the root carries
 * `data-theme-base="modern"`); `foundation`, Frost's values only, as the fallback for a name the
 * pack leaves out.
 */
export type ThemePackBase = "modern" | "foundation";

/** The three colours a picker draws for a pack in one mode, as hex. */
export interface ThemePackSwatch {
  canvas: string;
  ink: string;
  accent: string;
}

/** One accent preset a pack offers: the `data-accent` id its `accents.css` declares, and its dot. */
export interface ThemePackAccentPreset {
  id: string;
  swatch: string;
}

/**
 * An imported pack as the picker and the pre-paint cache read it: its normalised manifest
 * (`pack.json`), plus where its stylesheet is served and at which version. `v` is a digest of
 * the pack's content and of the cascade layer order the served Web App build puts in front of its
 * stylesheet, so it changes when a replace changes anything, or a new build changes that order,
 * and a cached stylesheet misses; `href` is `/api/themes/<id>/files/index.css?v=<v>`, which the
 * browser builds from `id` and `v` itself before the first paint.
 */
export interface ThemePackDto {
  /** `^[a-z][a-z0-9-]{1,31}$`, never a built-in pack's id. */
  id: string;
  names: { zh: string; en: string };
  /** The pack's own semver. */
  version: string;
  /** The theme API the pack targets; a build implementing a lower one lists it and never loads it. */
  api: number;
  base: ThemePackBase;
  /** The modes the pack declares; a mode it leaves out renders from the base. */
  modes: ThemePackMode[];
  swatches: Record<ThemePackMode, ThemePackSwatch>;
  accent: {
    /** The theme's own accent per mode: what `neutral` paints. */
    own: Record<ThemePackMode, string>;
    /** The presets, in the picker's order. */
    presets: ThemePackAccentPreset[];
  };
  /** The family each stack puts first. */
  fonts: { sans: string; ui: string; mono: string; cjk: string; display: string };
  /** The built-in Agent-avatar variant the pack shows, when it shows its own. */
  avatar?: string;
  href: string;
  /** Hex, 8–64 characters. */
  v: string;
}

/** GET /api/themes. */
export interface ThemePacksResponse {
  themes: ThemePackDto[];
}

/** POST /api/themes: the pack as it is now installed. */
export interface ThemePackImportResponse {
  theme: ThemePackDto;
}

/** The codes the theme-pack routes refuse with, beside the shared `admin_required`. */
export type ThemePackErrorCode =
  | "theme_invalid"
  | "theme_id_reserved"
  | "theme_exists"
  | "theme_too_large"
  | "theme_api_unsupported"
  | "theme_builtin"
  | "theme_not_found"
  | "themes_unavailable";

/**
 * `details` of a 400 `theme_invalid`: the first thing the validator refused, so a designer can go
 * to it. `file` is the entry's path inside the pack (`recipes.css`, `fonts/hand.woff2`, the
 * entry a zip may not hold); `line` and `column` (1-based, decimal strings) are present when the
 * refusal points into a stylesheet or the manifest.
 */
export interface ThemeInvalidDetails {
  file: string;
  reason: string;
  line?: string;
  column?: string;
}

// ---------------------------------------------------------------------------
// The account's keyboard shortcut overrides (`ui_prefs.keybindings`).
// ---------------------------------------------------------------------------

/**
 * The account's keyboard shortcut overrides, one section per platform (the Web App's `Mod` token
 * is ⌘ on macOS and Ctrl elsewhere, so a deliberate macOS-only binding must not leak to Windows).
 * Each section maps a command id to a chord string ("Mod+Shift+KeyW") or null (explicitly
 * unbound); only rows that differ from the Web App's default are present. Bounded on write by
 * the `./keybindings` validator.
 */
export interface StoredKeybindings {
  v: 1;
  mac?: Record<string, string | null>;
  windows?: Record<string, string | null>;
  linux?: Record<string, string | null>;
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

/** Server → shell command over the utilityProcess message channel (relayed from POST /api/desktop/window). No reply. */
export interface DesktopOpenWindowMessage {
  type: "desktop-open-window";
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

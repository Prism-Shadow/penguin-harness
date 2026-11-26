/**
 * The plugin domain's DTO contract — the shapes the plugin library, its market and registry
 * readers, and its install/uninstall paths name across their interfaces, moved here from the
 * server's api/types.ts (which re-exports them). The Web API contract is unchanged: the server
 * module's exports are the same names, from here.
 *
 * A few DTOs the plugin contract references (the agent-create and task-create shapes) moved
 * along with it because nothing else owns them yet; when their own domain library lands they
 * can move on.
 */

/**
 * One `tools.mcpServers` entry of an Agent, as the Plugins page and the Agent settings read it:
 * identity, target and what keeps it from connecting — never a header, env or oauth value.
 */
export interface AgentMcpServerItem {
  name: string;
  transport: McpTransport;
  /** The URL (http/sse), or `command args…` (stdio): `${PLUGIN_ROOT}` already resolved at install, `${KEY}` references left as written. */
  target: string;
  /** The plugin that installed it; absent for an entry the user added. */
  plugin?: string;
  /** `${KEY}` references of its config that the Agent's vault does not hold (names only); empty = nothing to set up. */
  missingKeys: string[];
  /** It needs an OAuth sign-in, which this version cannot do: skipped at connect time. */
  signIn: boolean;
}

/** An MCP transport, as an entry resolves it (`transport`, else inferred from `command` / `url`). */
export type McpTransport = "stdio" | "http" | "sse";

/** One installed hook package (`agent_state/hooks/<name>/`): its manifest, without the scripts. */
export interface HookItem {
  /** Hook package name — the plugin that shipped it (the identity uninstall addresses it by). */
  name: string;
  description: string;
  descriptionZh?: string;
  /** Version (`YYYY.MM.DD.N`; a copy installed before that spelling still carries `YYYY-MM-DD.N`); an empty string when the manifest carries none. */
  version: string;
  /** The hook points the package answers at, e.g. `["stop"]`. */
  events: string[];
  /** The plugin's icon, written beside the manifest at install time and served at `GET …/agents/:a/hooks/:name/icon`; absent when there is none (the frontend draws the hook glyph). */
  icon?: IconRef;
}

/**
 * An icon, as a listing sends one: where this server serves the image, and how to draw it. An
 * icon never travels as markup. `url` is a path on this server that carries the image's content
 * revision (`?rev=`), so it is cached for good; it serves SVG, PNG, JPEG, WebP, GIF or AVIF under
 * the type its bytes say, sandboxed (`Content-Security-Policy: …; sandbox`, `nosniff`). Draw it
 * with `<img>`, or — when `tint` is set — as a CSS mask filled with the text colour.
 */
export interface IconRef {
  url: string;
  /** A monochrome SVG (every paint `currentColor` or `none`): drawn as a mask in the text colour. Otherwise drawn as itself. */
  tint: boolean;
}

/**
 * How many times each plugin is installed, for the market's 热门 / 飙升 (popular / rising) panel:
 * `installs` in all, `weekly` in the last seven days, by npm package name.
 *
 * PLACEHOLDER: no install count exists across deployments yet, so today's numbers are generated
 * with a fixed seed in the community repository's pipeline and published with
 * `source: "placeholder"`. Replace them with a real install-count API later: it publishes this
 * same shape with `source: "live"`, the switch a reader keys on.
 */
export interface MarketPopularity {
  source: "placeholder" | "live";
  /** The day the numbers were produced (`YYYY-MM-DD`). */
  generatedAt: string;
  items: Record<string, { installs: number; weekly: number }>;
}

/** What the market document says a plugin looks like. Every part is optional. */
export interface PluginArt {
  cover?: MarketImage;
  /**
   * A raster icon, for a plugin whose package is not on this server (an index row has none of its
   * own); once the package is here, the package's own icon is drawn instead.
   */
  icon?: { url: string };
  screenshots?: MarketShot[];
}

/**
 * One picture of the plugin market, named by the route this server serves it at
 * (`GET /api/plugins/market/asset?path=…&rev=…`): the server fetches it from beside the market
 * document, checks its bytes are a WebP, PNG or JPEG picture and keeps a copy, so a page never
 * loads a picture from another host. A picture that cannot be had answers 404.
 */
export interface MarketImage {
  /** The full rendition. */
  url: string;
  /** The small rendition a card draws; absent, a card draws `url`. */
  thumbUrl?: string;
  /** The picture's dominant colour (`#rrggbb`): the field it fades in over. */
  tone?: string;
}

/** A screenshot on a plugin's detail: a picture and what it shows. */
export interface MarketShot extends MarketImage {
  caption?: string;
  captionZh?: string;
}

/** One file a run hands back to the terminal, which saves it under the command's `files.write`. */
export interface PluginCliCommandOutputFile {
  /** A plain file name, no directory. */
  name: string;
  mimeType?: string;
  /** Its bytes, base64. */
  data: string;
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
  /** The caller's Project (an Agent's `PENGUIN_PROJECT_ID`); a member command needs one. */
  projectId?: string;
  /** The caller's Session (an Agent's `PENGUIN_SESSION_ID`): a Session of `projectId`. */
  sessionId?: string;
  /** The local files the terminal read for the command's `files.read` options. */
  files?: PluginCliCommandInputFile[];
}

/** One file the terminal sends with a run. */
export interface PluginCliCommandInputFile {
  /** The option's value as typed: what the command looks the file up by. */
  value: string;
  /** The file's own name, no directory. */
  name: string;
  /** Its bytes, base64. */
  data: string;
}

/** What one run printed, its exit code, and the files it handed back. */
export interface PluginCliCommandRunResponse {
  exitCode: number;
  stdout: string;
  stderr: string;
  files?: PluginCliCommandOutputFile[];
}

/** GET /api/cli/commands: every command the server's plugins contribute, in load order. */
export interface PluginCliCommandsResponse {
  commands: PluginCliCommandInfo[];
}

/** One command a plugin contributes to the CLI, as GET /api/cli/commands lists it. */
export interface PluginCliCommandInfo {
  /** The plugin package that contributes it — what `penguin exec` names. */
  package: string;
  /** `a.b.c`: the argv segments it answers (`penguin a b c ARGS`). */
  key: string;
  /** Its one-line summary, per language. */
  summary: { en: string; zh: string };
  /**
   * Who may run it: the administrator only, or any member of the caller's Project. This server
   * always says; a client reads an absent one (a server from before member commands) as `admin`.
   */
  access?: "admin" | "member";
  /**
   * The local files it exchanges: `read`, the options whose value is a file the terminal sends;
   * `write`, the option naming the directory the terminal saves returned files into.
   */
  files?: { read?: string[]; write?: string };
}

/** Whether a backend that applies to this machine is installed, and this OS's default ones. */
export interface PluginConfigBackend {
  /** A backend for this OS is installed: loaded, or installed and failing its check. */
  installed: boolean;
  /**
   * The npm packages this OS defaults to, installed together: the rows of the index embedded in
   * the server that declare this platform (`PluginIndexEntry.sandboxDefaultFor`), in index order;
   * absent when none does.
   */
  recommended?: string[];
}

/**
 * One published version of a plugin — the index entry format every plugin registry
 * speaks (modeled on the typst/packages `index.json` schema: a flat array of
 * per-version entries; a plugin published at several versions appears once per
 * version). Listing and installing are two faces: an entry's `name` is the package
 * specifier a Project's plugin list names, and an entry that pins a release channel
 * can also be installed from that channel (plugin/install.ts).
 */
export interface PluginIndexEntry {
  /** A downloaded package on the machine serving this listing, compared with the index release. */
  localInstall?: { version: string; libraryOnly: boolean; updateAvailable: boolean };
  /** Package specifier — the string a Project's plugin list names. */
  name: string;
  /** Localized display names; the UI falls back to the package name. */
  title?: string;
  titleZh?: string;
  /** Semantic version of this entry. */
  version: string;
  description: string;
  /** Chinese description (optional; the UI picks per language, English without it). */
  descriptionZh?: string;
  /** One-line descriptions for the card (optional; the card falls back to `description`). */
  shortDescription?: string;
  shortDescriptionZh?: string;
  /**
   * The plugin's icon, served at `GET /api/plugins/registry/icon?name=…` (optional; the card
   * draws the puzzle piece without it). The listing fills these display fields from the
   * package's own card contribution (in its ifaces.json) and icon when the package is on this
   * server, over whatever the index row says. An index document carries an icon as raw SVG text
   * instead, and only the one embedded in this server is believed (plugin/registry.ts).
   */
  icon?: IconRef;
  authors: string[];
  /** SPDX license identifier. */
  license: string;
  /** Source repository URL. */
  repository?: string;
  homepage?: string;
  /** Free-form searchable terms; the Web App renders them as chips (e.g. the target OS). */
  keywords?: string[];
  /** Capability floor(s) the plugin provides on (e.g. "sandbox"). */
  categories?: string[];
  /**
   * For a sandbox backend: the platforms (`process.platform` names: `linux`, `darwin`, `win32`)
   * it is a default backend for, as its package declares them on its `SandboxModule.providers`
   * contribution. A server whose sandbox is turned on with no backend for its platform offers to
   * install the embedded index's defaults for that platform, in index order; an entry without the
   * field is the default for none.
   */
  sandboxDefaultFor?: string[];
  /** Unix timestamp (seconds) of the entry's last update. */
  updatedAt?: number;
  /**
   * The build carries an offline archive of this plugin (05 「插件库」 「安装从不卡住」): it installs
   * with no registry, at this version, and this is what it carries — known before it is on this
   * server. Absent for everything else, and on older servers.
   */
  offline?: { version: string; library: boolean; modules: boolean };
  /**
   * The hash this entry's release asset is pinned by, npm's `integrity` shape:
   * `sha512-<base64>` of the tarball its channel serves. Present when the publisher
   * ships the version through a channel; an entry without it lists but is not
   * installable from a channel — there is nothing to verify the fetched bytes against.
   */
  integrity?: string;
  /** Where this version's release asset can be fetched from. */
  channels?: PluginIndexChannel[];
}

/** One place a version can be installed from. */
export interface PluginIndexChannel {
  /**
   * The kind of source: `github` names a GitHub release asset tarball, the kind the
   * install face fetches and verifies. Other kinds may join; the install face ignores
   * the ones it does not fetch.
   */
  kind: string;
  /**
   * The https URL the asset is served at. Always present on a `github` channel; absent on an
   * `npm` one, which names the npm registry rather than an address.
   */
  url?: string;
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
  /**
   * The plugin whose server module declared the group, by the specifier the plugin list names it
   * with — an npm package name, or for a package installed from a directory, that directory's
   * absolute path; absent for the host's own groups (the sandbox, plugin sources) and from a
   * server older than this field. The Settings dialog draws the group on that plugin's page,
   * keyed `plugin:<specifier>`; a specifier the plugin library does not list (a path) gets a page
   * named by the group's own title.
   */
  plugin?: string;
  /**
   * That plugin's display name, from its card, in both languages — what names its page when the
   * plugin library does not list it (a server-module plugin with no Skill: a sandbox backend).
   */
  pluginTitle?: string;
  pluginTitleZh?: string;
  /**
   * That plugin's version and icon as its package on this server says them, for the same page:
   * the npm version, and the icon (served at `GET /api/admin/plugin-config/icon?plugin=…`); each
   * absent when the package carries none or is not known here.
   */
  pluginVersion?: string;
  pluginIcon?: IconRef;
  /**
   * What the group's status reports in the status page's shape, checked on the way out (a state
   * this build does not know reads as `unknown`, a field of the wrong type is dropped); absent
   * when it reports none, or when its report could not be read.
   */
  report?: PluginStatusReport;
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
  /**
   * A security setting — who may use the plugin, what it may reach: drawn under the plugin
   * page's "Security" heading with a shield. Presentation only, like `advanced`.
   */
  security?: boolean;
  /** A save that would leave this field empty is refused. */
  required?: boolean;
  /** `enum` only: the values it may take, in display order. */
  options?: PluginConfigOption[];
  /** `list` only: the most entries a save may leave (after trimming and de-duplicating). */
  maxItems?: number;
  /**
   * `list` only: how one entry is drawn and chosen. Options present — the entries are picked
   * from a fixed set (a mirror id, say); absent — an entry is a free-text line. Presentation
   * and page interaction only: storage is a string array either way.
   */
  items?: { options?: PluginConfigOption[] };
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

/** One choice of an `enum` field. */
export interface PluginConfigOption {
  value: string;
  title: string;
  titleZh?: string;
  /** What picking it does: listed, for a table column's option, in a row's "?" (see the row's `description`). */
  description?: string;
  descriptionZh?: string;
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

/** The values a row added to an `extensible` table starts from. */
export interface PluginConfigNewRow {
  /** The add button's text ("Add preset"). */
  add?: string;
  addZh?: string;
  values: Record<string, string | boolean>;
  /** A string column's starting text in Chinese. */
  valuesZh?: Record<string, string>;
}

/** A header over adjacent table columns, with its own "?". */
export interface PluginConfigColumnGroup {
  title: string;
  titleZh?: string;
  description?: string;
  descriptionZh?: string;
  columns: string[];
}

/** A table's pin column: which boolean column, and its tooltip pinned and not. */
export interface PluginConfigPinColumn {
  column: string;
  on: string;
  onZh?: string;
  off: string;
  offZh?: string;
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

/** One button under a settings group: what it is called, and what pressing it will do. */
export interface PluginConfigActionDecl {
  id: string;
  title: string;
  titleZh?: string;
  description?: string;
  descriptionZh?: string;
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

/**
 * A settings group's status in the plugin page's shape (its status contributor's `report()`):
 * a summary word, the program the plugin installs beside itself, and the preconditions it
 * checks. `action` and `recheck` name actions of the group's `actions`: an action named here is
 * drawn on its element only; the others are the page's primary actions.
 */
export interface PluginStatusReport {
  summary?: PluginStatusSummary;
  version?: PluginStatusVersion;
  /** Every precondition, in display order. */
  checks?: PluginStatusCheck[];
  /** The action that checks everything again: drawn once, at the checks' heading, and run without asking first (it only reads). */
  recheck?: string;
}

/** Where the plugin stands, in a word or two, drawn as a pill in its state's tone. */
export interface PluginStatusSummary {
  /**
   * `ready` usable now; `attention` something needs a person; `progress` work under way; `off`
   * switched off or not usable here; `unknown` could not be told — also what a state this build
   * does not know reads as (a newer plugin's), so a page never meets a state it cannot draw.
   */
  state: "ready" | "attention" | "progress" | "off" | "unknown";
  text: string;
  textZh?: string;
  /** What the word cannot say, on the pill's hover. */
  hint?: string;
  hintZh?: string;
}

/** A program the plugin installs and runs beside itself (agent-desktop), as its version element shows it. */
export interface PluginStatusVersion {
  /** The program's name as its maker spells it. */
  name: string;
  /**
   * `preparing` = being downloaded or installed now (`progress`, step in `text`); `missing` = not
   * installed yet; `unknown` = could not be told, and what a state this build does not know reads as.
   */
  state: "installed" | "preparing" | "failed" | "missing" | "unsupported" | "unknown";
  version?: string;
  /** The OS and CPU the installed build is for ("linux-x64"). */
  platform?: string;
  /** While preparing: how far, from 0 to 1; absent when the step has no amount. */
  progress?: number;
  /** One line: the step while preparing, why when failed or unsupported, where it runs from. */
  text?: string;
  textZh?: string;
  /** Folded under the element (an install directory, the whole error); lines separated by `\n`. */
  details?: string;
  detailsZh?: string;
  /** The action the element offers as its button (install, retry). */
  action?: string;
}

/** One precondition the plugin checks on this machine. */
export interface PluginStatusCheck {
  id: string;
  /** What is checked, in a few words ("Display", "Accessibility"). */
  label: string;
  labelZh?: string;
  /**
   * `ok` holds; `action` needs a person; `unknown` could not be told yet (and what a state this
   * build does not know reads as); `na` does not apply on this machine.
   */
  state: "ok" | "action" | "unknown" | "na";
  /** One line in the plugin's own words: what was found, or what to do. */
  text?: string;
  textZh?: string;
  /** Folded under the row: a tool's own words, paths; lines separated by `\n`. */
  details?: string;
  detailsZh?: string;
  /** The action drawn on this row (open System Settings). */
  action?: string;
  /**
   * A Settings page this row opens, drawn as a link on the row: `plugin:<specifier>` for a
   * plugin's page (the sandbox lists each backend and links it to its plugin's page). A page
   * the viewer does not have draws no link.
   */
  page?: string;
}

/** One Agent that carries a plugin, as the server-uninstall confirm names it. */
export interface PluginHolder {
  projectId: string;
  projectName: string;
  agentId: string;
  agentName: string;
}

/**
 * GET /api/admin/plugins/holders?package=… (admin): who would lose a plugin if it were uninstalled
 * from this server (05 「插件库」 「安装模型」). `agents` is every Agent of every Project here that
 * carries any part of it; `shared` the Projects whose shared table lists it (the uninstall is then
 * refused); `shipped` a package the build ships (it cannot be uninstalled from the server).
 */
export interface PluginHoldersResponse {
  package: string;
  /** The library plugin the package is; null for a server module alone (no Agent carries it). */
  plugin: string | null;
  /** It is in this server's prefix (installed or linked). */
  onServer: boolean;
  shipped: boolean;
  shared: Array<{ projectId: string; projectName: string }>;
  agents: PluginHolder[];
}

/**
 * One library plugin as the listing describes it: its package.json's npm fields and its card
 * contribution, plus what it ships (skill bodies and scripts are never sent).
 * Every field but the identity, the version and the contents is optional: a field the package
 * does not carry is missing here, and the page says so rather than inventing one.
 */
export interface PluginItem {
  name: string;
  /** Display name (the card's `title`, `titleZh`); absent → the page shows `name`. */
  title?: string;
  titleZh?: string;
  /** English one-liner (package.json `description`); "" when the package carries none. */
  description: string;
  descriptionZh?: string;
  shortDescription?: string;
  shortDescriptionZh?: string;
  /** The plugin's npm version (its package.json, following the release) — what the card shows. Installed copies are compared part by part instead: each skill's `version`, and {@link hookVersion}. */
  version: string;
  /** The npm package the plugin is, e.g. `@penguinharness/a2ui` — what Delete and a server module's row name it by. */
  package: string;
  /** Where the plugin comes from: `builtin` — a package this build ships; `installed` — one an admin installed on the server (by name, link or zip). */
  source: "builtin" | "installed";
  /** The package's npm `author` (a name), `license`, `homepage` and `repository` URL, for the detail dialog. */
  author?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  /** The plugin's skills (metadata only), each with its own dated `version`. */
  skills: SkillMetadataItem[];
  workbenches?: Array<{ name: string; version: string }>;
  /** The hook points the plugin's hook package answers at (`[]` without one). */
  hooks: string[];
  /** The hook package's own dated version (its hooks contribution's `version`, `YYYY.MM.DD.N`); absent without a hook package. */
  hookVersion?: string;
  /** The plugin's icon (`icon.<ext>` at the package root, or the card's `icon` — every built-in plugin ships one; one that will not do is never sent), served at `GET /api/plugins/:plugin/icon`, the icon of everything it ships; the frontend draws the puzzle-piece plugin glyph without it. */
  icon?: IconRef;
  /** The demo the Plugins page's quick start pre-fills (the card's `quickStart`); absent = pre-select its first skill. */
  quickStart?: QuickStartItem;
  /** The card's `composerMode`: an Agent with the hook package gets it as a switch in the composer's "+" menu (sent as `TaskCreateRequest.promptHooks`). */
  composerMode?: true;
  /** Optional slash name contributed by this composer mode. */
  composerCommand?: string;
  /** The card's `defaultInstall`: every new Agent gets the plugin (see `AgentCreateRequest.defaultPlugins`); absent on a server that predates the field, and for a plugin an admin installed. */
  defaultInstall?: true;
  /** The MCP servers the plugin installs into an Agent's `tools.mcpServers` (its mcpServers contributions); `[]` without any. */
  mcpServers: PluginMcpServerItem[];
  /**
   * The package also ships server modules (a hybrid plugin): installing it on an Agent also asks
   * for its modules to run on the Agent's server (PRFC-0031). Absent from a server older than
   * that, read as false.
   */
  modules?: boolean;
}

export interface SkillMetadataItem {
  /** Skill directory name (the identity key for install / uninstall / Prompt addressing). */
  name: string;
  description: string;
  /** Short description for frontend display (frontmatter short_description, optional; falls back to description if missing). */
  shortDescription?: string;
  shortDescriptionZh?: string;
  /**
   * The `icon.<ext>` in the skill's directory: the plugin's icon for a library install (written
   * beside SKILL.md at install time), a custom one for a user-authored skill. Served at
   * `GET …/agents/:a/skills/:name/icon` (a directory Skill's at `GET …/dir-skills/icon`). Only
   * installed and directory lists carry it — the library listing's skills share their plugin's
   * icon, which the plugin item carries once. Absent, the frontend draws the book glyph.
   */
  icon?: IconRef;
  /** The skill's own dated version (`YYYY.MM.DD.N`, frontmatter version; a copy installed before that spelling still carries `YYYY-MM-DD.N`); an empty string when the frontmatter carries none or a malformed one. */
  version: string;
}

/** A quick start: a prompt pre-filled into a new-chat draft — never sent by the page. */
export interface QuickStartItem {
  prompt: string;
  promptZh?: string;
  /** Skills to pre-select (a library plugin's own). */
  skills?: string[];
  /** Open the draft in goal mode. */
  goal?: boolean;
}

export interface TaskCreateRequest {
  input: TaskInputPart[];
  /**
   * Queue instead of 409 when a Task/compaction is already in progress: the input is held
   * server-side and auto-starts as an ordinary next task once the session returns to idle
   * (in queue order, one at a time). The response then carries `queued: true`.
   */
  queueIfBusy?: boolean;
  /**
   * Interrupt, then send: when a Task/compaction is in progress, the input goes to the head of
   * the follow-up queue (behind any earlier interrupt still waiting; the queue's one cap
   * applies) and the run is aborted the way POST /abort aborts it, so this input is the first
   * thing to start once the run settles; the response then carries `queued: true`. The abort
   * leaves its carry-over, which core sends ahead of this input, so the message lands right
   * after the turn it cut. Undelivered steering meets the abort as it meets a Stop: it is
   * handed back to the composer. An idle Session just starts the Task. Exclusive with
   * `queueIfBusy` and `goal` (400).
   */
  interrupt?: boolean;
  /**
   * Steer instead of 409 when a Task is in progress: decided under the Session lock, so one
   * request suffices whatever the Session is doing. Idle starts the Task; a running Task takes
   * the input as steering, as POST /steer gives it (the steering mirror, recall and hand-back
   * apply), and the response carries `steered: true`; a compaction, which has no Task to
   * steer, or a run already settling, which takes no more steering, queues it as
   * `queueIfBusy` does (`queued: true`). Exclusive with `interrupt` and `goal` (400).
   */
  steerIfBusy?: boolean;
  /**
   * Present = goal mode: the input's text becomes the objective (leading `[use_skills]`
   * blocks and the like are stripped from the recorded objective; the round-1 message keeps
   * them) and the Session's installed `goal` hook package drives round after round until the
   * goal reaches a terminal state. `budget` is the token budget (uncached input + output);
   * omitted or -1 = unlimited. Requires the goal plugin installed on the Agent — 409
   * `goal_plugin_not_installed` otherwise; a start hook that fails (its script errs or times
   * out, or the sandbox refuses to run it) is 409 `goal_start_failed` with the reason.
   */
  goal?: { budget?: number };
  /**
   * Hook packages installed on the Agent whose `trigger: "host"` `user_prompt` command this
   * Task runs (the composer's switches, see `PluginItem.composerMode`): each one's `context`
   * follows the user's message, stamped `sender: "harness"`, in the order named. Run when the
   * request is accepted, so a queued or interrupting input waits with its contexts; a steered
   * input takes none. A package that is not installed, or declares no such command, is 409
   * `prompt_hook_not_installed`; one whose command fails is 409 `prompt_hook_failed` with the
   * reason; nothing is started or queued either way. Exclusive with `goal` (400).
   */
  promptHooks?: string[];
}

/**
 * A single Prompt's input parts: text, image (data: / http(s) URL), or an uploaded file.
 * Docs: /docs/server-api § "Session-Level Endpoints".
 */
export type TaskInputPart =
  | { type: "text"; text: string }
  /**
   * An image that rides the conversation inline, as a base64 `data:` URL or an http(s) URL.
   * A data URL is capped at 20MB (413 `image_too_large`) — a fixed limit that does NOT follow
   * the admin-settable attachment cap, because an inline image is written into the Trace and
   * read back on every history page and every resume.
   */
  | { type: "image_url"; imageUrl: string }
  /**
   * File attachment (the composer's "+" menu): `dataUrl` is a base64 `data:` URL of the
   * file's bytes, capped per file and per message by the admin-settable upload limits
   * (defaults 100MB / 120MB; 413 `file_too_large` / `payload_too_large` / `too_many_files`,
   * and the request as a whole still has to fit the body cap those limits derive). The
   * server writes it into the Session scratchpad under a sanitized name and appends an
   * `[attached file: <path>]` line to the message text — the bytes never enter the
   * conversation, the model opens the file by path. `fileName` is the original name (no path
   * separators, no `..`).
   */
  | { type: "file"; fileName: string; dataUrl: string };

export interface AgentCreateRequest {
  /** Semantic id, specified by the creator: `^[a-z][a-z0-9_-]{1,63}$`, unique within the Project, immutable after creation. */
  agentId: string;
  /** Display name; defaults to agentId. */
  name?: string;
  description?: string;
  /**
   * Who is creating the Agent; omitted = `user`. The Web App's dialog sends `user`, the CLI
   * sends `agent` when it runs inside a Session. Written into the new Agent's config. (An
   * imported Agent keeps the `author` its package carries: the import moves an Agent.)
   */
  author?: AgentAuthor;
  /**
   * Library plugin names installed into the new Agent, seeding it at creation — each plugin's
   * skills and hook package. Every name must exist in the library (404 `unknown_plugin`
   * otherwise, before anything is created). The library's default-install plugins join them
   * unless `defaultPlugins` is false.
   */
  plugins?: string[];
  /**
   * Whether the library's default-install plugins (those whose card sets `defaultInstall`)
   * join `plugins`; omitted = true. A client that sends the complete list it
   * showed the user, as the Web App's create dialog does, sends false with it.
   */
  defaultPlugins?: boolean;
  /**
   * Skills imported from a directory on disk instead of the library. `skillsDirectory` is the
   * absolute path the user picked and `directorySkills` are the names to install from it, read
   * back from `.agents/skills` / `.claude/skills` at creation time. Both are required together,
   * and every name must still be there (404 `unknown_skill` otherwise, before anything is
   * created) — the client sends names, never Skill content.
   */
  skillsDirectory?: string;
  directorySkills?: string[];
}

/**
 * Who made an Agent (`author` in system_config.yaml): a person in the Web App (`user`), an
 * agent working in a Session (`agent`), or company mode creating an organization's CEO or a new
 * hire (`company`). A config without the field, or with any other value, reads as `user`.
 */
export type AgentAuthor = "user" | "agent" | "company";

/** A plugin's MCP server as the library lists it: identity and target only — no header, env or oauth value. */
export interface PluginMcpServerItem {
  name: string;
  transport: McpTransport;
  /** The URL (http/sse), or `command args…` (stdio), as written: `${PLUGIN_ROOT}` and `${KEY}` references unresolved. */
  target: string;
  /** Every vault key the server's config references, declared ones first. */
  setup: PluginSetupKeyItem[];
  /** The server offers OAuth sign-in (`config.oauth`). */
  oauth: boolean;
  /** It needs that sign-in — OAuth and no `Authorization` header of its own — which this version cannot do: an Agent skips it. */
  signIn: boolean;
}

/** One vault key a plugin's MCP server needs before it can connect: declared in the manifest, or only referenced (then the key is all there is to show). */
export interface PluginSetupKeyItem {
  key: string;
  label?: string;
  labelZh?: string;
  /** Where to get the value (a URL), or one sentence. */
  help?: string;
}

/**
 * GET /api/plugins/market: the market's curation — which plugins are selected, which of them
 * may lead the selected carousel, and the art of the plugins that have any — keyed by npm package
 * name (a library plugin's `package`, an index entry's `name`). A name this server does not list
 * is simply not drawn. `source` says which document answered: the one shipped with this build, or
 * the published one (plugin/market.ts). Selection is an editorial choice, not a ranking; the only
 * numbers are the optional `popularity` block, placeholders until a real install-count API exists.
 */
export interface PluginMarketResponse {
  /** Package names allowed to lead the selected carousel, in turn order; each is also in `selected`. */
  hero: string[];
  /** Package names of the selected plugins, in display order. */
  selected: string[];
  art: Record<string, PluginArt>;
  source: "embedded" | "published";
  /**
   * The document's install counts, as it carries them; absent when it carries none, or a block
   * that does not read (the rest of the document still answers). Placeholder numbers today
   * (`source: "placeholder"`), to be replaced by a real install-count API: see MarketPopularity.
   */
  popularity?: MarketPopularity;
}

/** What one install, or one explicit ask, did about a plugin's server module. */
export interface PluginModuleAction {
  plugin: string;
  /**
   * `enabled`: listed for this Project on this server, and running (or waiting for a restart);
   * `requested`: an administrator is asked; `blocked`: the administrator stopped this module;
   * `failed`: listed, and the module did not start (`reason`) — when the App would not boot with
   * it, the listing was undone.
   */
  action: "enabled" | "requested" | "blocked" | "failed";
  reason?: string;
}

/** One row of the ledger of module requests and decisions, for the administrator. */
export interface PluginModuleRequest {
  package: string;
  plugin: string;
  /** The Project whose table lists it, or will; null when that Project is gone, and for a preinstalled module's own row (PRFC-0030) — `preinstalled` tells the two apart. */
  projectId: string | null;
  /** That Project's display name (its id when it has none); null when there is none. */
  projectName: string | null;
  agentId: string | null;
  /** The user who asked; "" when no person was behind it (company mode's reconcile, a preinstalled module's one-time listing). */
  requestedBy: string;
  /** That user's display name; null when it has none or the user is gone. */
  requestedByName: string | null;
  requestedAt: string;
  /** null = pending. */
  decision: "enabled" | "declined" | null;
  decidedBy: string | null;
  decidedAt: string | null;
  /** How it was enabled: `builtin` (automatic), `admin` (the administrator's own act), `approval` (a member's request approved). */
  via: "builtin" | "admin" | "approval" | null;
  builtin: boolean;
  /**
   * A preinstalled module (PRFC-0030): every Project's rather than one's. Its row names no
   * Project (`projectId` null without the Project being gone), and enabling it after a stop
   * lists it in every Project. Absent from a server older than PRFC-0030.
   */
  preinstalled?: boolean;
  /**
   * A preinstalled module behind a system app of the App Center: it always runs. A stop of it,
   * and any plugin-table write that would unlist it, answers 409 `system_app_module_locked`.
   * Absent from a server older than that rule.
   */
  systemApp?: boolean;
  state: PluginModuleState;
  /**
   * The package is on this server (installed, linked or shipped). False for a member's request of
   * a package not here yet: enabling it means installing it on the server first.
   */
  onServer: boolean;
}

/** How a library plugin's server module stands on this server (PRFC-0031). */
export type PluginModuleState =
  /** Loaded in this server's module tree. */
  | "running"
  /** Loaded, and this build cannot run it, or runs it without part of itself (`reason`). */
  | "unsatisfied"
  /** Some Project lists it for this server and the load failed (`reason`). */
  | "failed"
  /** Listed for this server, neither loaded nor failed: waiting for a restart. */
  | "restart"
  /** No Project lists it for this server. */
  | "off";

/** GET /api/admin/plugin-modules, and the answer to a decision (administrator only). */
export interface PluginModuleRequestsResponse {
  requests: PluginModuleRequest[];
  /** How many rows wait for a decision. */
  pending: number;
  /**
   * After stopping a module: the Projects whose shared table still lists it, so it keeps running
   * here until it is removed from them on the Plugins page. Absent when nothing else lists it.
   */
  stillListedBy?: Array<{ projectId: string; projectName: string }>;
}

/** One library plugin that carries server modules, on this server and for this Project. */
export interface PluginModuleStatus {
  /** The library plugin's name: what `names` installs. */
  plugin: string;
  /** The npm package name: the specifier a plugin table lists. */
  package: string;
  /** Resolves from a prefix this build ships and only adds modules: the automatic path applies. */
  builtin: boolean;
  state: PluginModuleState;
  /** Whether this Project lists it for this server (its shared table, or this server's own). */
  listed: boolean;
  /** Why, for `failed` and `unsatisfied`. */
  reason?: string;
  request?: PluginModuleRequestView;
}

/** The standing ask to run a module on this server, as a Project member sees it. */
export interface PluginModuleRequestView {
  /** `pending`: waiting for the administrator; `declined`: the administrator stopped it, and installs do not bring it back. */
  status: "pending" | "declined";
  /** Whether the caller made it. */
  mine: boolean;
  requestedAt: string;
}

/**
 * DELETE /api/admin/plugins?package=… (admin): uninstalls the plugin from every Agent here, then
 * from this server. 409 `plugin_shipped`, 404 `plugin_not_installed`, 409 `plugin_shared` (a
 * Project's shared table lists it), 409 `module_failed`, 500 `plugin_remove_failed`.
 */
export interface PluginServerUninstallResponse {
  package: string;
  plugin: string | null;
  /** Each Agent it was uninstalled from, with the parts that could not be removed. */
  agents: Array<PluginHolder & { failed?: PluginUninstallResponse["failed"] }>;
}

/**
 * DELETE /api/projects/:p/agents/:a/plugins/:name: uninstall a whole plugin from the Agent, on
 * the server, in one request (owner only). Removed in order: the Workbenches whose install
 * receipt names the plugin, its `tools.mcpServers` entries (`plugin` field), its hook package
 * (`agent_state/hooks/<name>/`), and every Skill whose name the library plugin contributes (none
 * when the plugin has left the library). A part that fails is reported in `failed` and the rest
 * are still removed; nothing is rolled back. Nothing to remove is 404 `plugin_not_installed`.
 */
export interface PluginUninstallResponse {
  removed: {
    skills: string[];
    hooks: string[];
    mcpServers: string[];
    workbenches: string[];
  };
  failed?: Array<{
    kind: "skill" | "hook" | "mcpServer" | "workbench";
    name: string;
    error: string;
  }>;
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

/** GET /api/plugins: the library by category (any logged-in user). */
export interface PluginLibraryResponse {
  groups: PluginGroupItem[];
}

export interface PluginGroupItem {
  id: string;
  title: string;
  /** Chinese category title (optional; the UI displays it per language). */
  titleZh?: string;
  plugins: PluginItem[];
}

/**
 * GET /api/plugins/:plugin/files: everything a library plugin ships, for the detail view's file
 * browser — each skill's installable SKILL.md and auxiliary files under `skills/<name>/`, the
 * hook package's scripts under `hooks/` — keyed by path relative to the plugin directory. The
 * manifest and the icon are not among them: the listing already carries both.
 */
export interface PluginFilesResponse {
  files: Record<string, string>;
}

/**
 * POST /api/projects/:p/agents/:a/plugins: install library plugins by name — each one's skills
 * and hook package; already-installed ones are overwritten with library content (i.e. updated).
 * Every name must be in the library (404 `unknown_plugin`, nothing written). 201 returns the
 * refreshed installed lists.
 */
export interface PluginInstallRequest {
  names: string[];
  /**
   * Install the Agent part only and leave every plugin table alone (PRFC-0031): what the Web App
   * sends to a machine, whose plugin list the hub owns. `modules` still says how each module
   * stands there. A server older than this ignores the field.
   */
  skipModules?: boolean;
}

export interface AgentPluginsInstallResponse {
  workbenches?: Array<{ name: string; plugin: string; version: string }>;
  skills: SkillMetadataItem[];
  hooks: HookItem[];
  /** The Agent's MCP servers after the install (a plugin's servers join its `tools.mcpServers`). A server name the Agent already has from someone else is 409 `mcp_server_name_taken`, nothing installed. */
  mcpServers: AgentMcpServerItem[];
  /** Every library plugin that ships server modules, as it stands on this server for this Project (PRFC-0031); absent from a server older than that. */
  modules?: PluginModuleStatus[];
  /** POST only: what this install did about each installed plugin's server module; a plugin it left alone is not listed. Absent from a server older than PRFC-0031. */
  moduleActions?: PluginModuleAction[];
}

/** POST /api/projects/:p/plugins/modules `{ plugin }` (any member): enable a plugin's server module, or ask the administrator to. */
export interface PluginModuleAskRequest {
  /** A library plugin's name: enable its server module, or ask for it. */
  plugin?: string;
  /**
   * Instead of `plugin`: a package that is not on this server yet, asked for by a member's
   * 「安装到 Agent」 (05 「插件库」 「安装模型」) — recorded as a request for the administrator,
   * whose enable installs it on the server first. With the Agent the member was installing on.
   */
  package?: string;
  agentId?: string;
}

/** The answer to an explicit ask: every module's state for this Project, and what the ask did. */
export interface PluginModuleAskResponse {
  modules: PluginModuleStatus[];
  moduleActions: PluginModuleAction[];
}

/** POST /api/admin/plugin-modules/decide (administrator only). `decline` on an enabled row stops the module on this server. */
export interface PluginModuleDecideRequest {
  package: string;
  decision: "enable" | "decline";
}

/** GET /api/plugins/registry: the merged index of every configured registry (currently the builtin one). */
export interface PluginIndexResponse {
  plugins: PluginIndexEntry[];
  /**
   * Sources that could not be read, by `source` and reason. Present and empty when every
   * source answered. A remote index that is down shortens the listing rather than emptying
   * it, so the page needs to be able to say so instead of silently showing less.
   */
  failures: { source: string; error: string }[];
  /**
   * Sources the server was still reading when it answered, by `source`. Present and empty when
   * every source answered. The listing does not wait long for a published index, so one on a slow
   * or unreachable network is named here and its entries are missing; a later read lists them
   * once they have arrived, or names the source under `failures` once it has failed.
   */
  pending: string[];
}

/**
 * A plugin's long-form docs: the README.md at its package root, as npm ships it.
 * GET /api/plugins/registry/readme?name= answers for an index entry, with `readme` null when
 * the package is not on this server or has none; GET /api/plugins/:plugin/readme answers for a
 * library plugin, 404 when it ships none.
 */
export interface PluginReadmeResponse {
  name: string;
  /** Markdown, rendered by the Web App. Null when this entry has no readme. */
  readme: string | null;
}

// ---------------------------------------------------------------------------
// Plugin-contributed languages
// ---------------------------------------------------------------------------

/** POST /api/admin/plugin-config/action — what running one reported. */
export interface PluginConfigActionResponse {
  ok: boolean;
  message: string;
  messageZh?: string;
  /** The groups as they stand after it ran: a setup that worked changes what the page says. */
  plugins: PluginConfigEntry[];
}

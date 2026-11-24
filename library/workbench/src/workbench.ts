/**
 * The workbenches domain vocabulary: what a workbench is as the server holds it and shows
 * it (the listing's WorkbenchInfo, the App Center's shapes), the request/response pair its
 * main handler speaks, the host surface a workbench's SDK calls, and the icon reference
 * everything names. Declared apart from what implements them — the server's Workbenches
 * mechanism implements the reads and writes these name.
 */

/**
 * One workbench as the server holds it. One that does not run (its own switch or the Agent-wide
 * one is off) is listed from its folder alone, never loaded for the listing: `revision` and
 * `uiRev` are its source's as it stands on disk (so history still marks the current version),
 * `tabs` and `hints` are empty, `error` is null (nothing was tried) and `loadedAt` is null;
 * `appCenter` and `icon` are read from its package.json as for one that runs.
 */
export interface WorkbenchInfo {
  id: string;
  name: string;
  version: string | null;
  /**
   * The page id this workbench's Sessions record as their source (`PageSource`):
   * `page-YYYY-MM-DD-HH-mm-ss-<8 hex>`, minted the first time the folder was read. Absent only
   * from a server that predates page ids, or for a folder that would not take one.
   */
  pageId?: string;
  /** git's tree id (12 hex) of the folder's source: what history records. */
  revision: string;
  /** Content revision of `ui/`: the cache key of the workbench's pages. Null when it has no `ui/`. */
  uiRev: string | null;
  /** The tabs of the instance that is SERVING — the previous one's while `error` is set. */
  tabs: WorkbenchTab[];
  /**
   * When the serving instance (or the failed attempt, with none serving) was loaded; null while
   * the workbench does not run.
   */
  loadedAt: string | null;
  /** The boot error when the current files do not load (the previous instance, if any, keeps serving). */
  error: string | null;
  /**
   * What loaded but is probably not what its author meant, each with the edit that settles it
   * — pages under `ui/` that no tab shows, say. Never a failure: `error` is that.
   */
  hints: string[];
  /**
   * What the current package.json declares for the App Center, with `show` as it takes effect: a
   * manifest that declares nothing, or no `show`, reads `show: true`. Absent when the declaration
   * does not hold up (a hint says why), and from a server that predates the default.
   */
  appCenter?: WorkbenchAppCenter;
  /**
   * The icon that declaration names, shown in the App Center or not: the same `IconRef` its
   * shortcut carries (the icon route with the image's revision). Absent without one that reads clean.
   */
  icon?: IconRef;
  /**
   * Its own switch: false while a `.disabled` marker sits in its folder. It runs only while this
   * and the Agent-wide switch (`WorkbenchesResponse.enabled`) are both on; a disabled one is not
   * loaded, serves nothing and shows no tab, but is still listed here. Absent from a server that
   * predates the switches, which the Web reads as "no switch to show".
   */
  enabled?: boolean;
  /**
   * Whether this installation is listed in its Agent's sidebar: false while a
   * `.hidden-from-sidebar` marker sits in its folder. The marker belongs to the installation, so
   * every member of the Project sees the same list. Absent from a server that predates the
   * setting, which the Web reads as "no switch to show".
   */
  showInSidebar?: boolean;
}

/** How the Web App draws a contributed tab: a page of the workbench, or a renderer it carries. */
export type WorkbenchTabRenderer =
  | {
      iframe: {
        src: string;
        /** Let a user gesture capture relative mouse movement in this tab. */
        pointerLock?: boolean;
      };
    }
  | { builtin: string };

/**
 * One tab beside Chat, as the workbench contributed it (`WebModule.sessionTabs`). In a
 * manifest `renderer.iframe.src` is a path inside the workbench folder, under `ui/`; in a
 * `WorkbenchInfo` it is the URL that file is served from.
 */
/** A tab's app icon: an SVG's markup, or a PNG's bytes base64-encoded — the manifest picks the media type. */
export interface WorkbenchTabIcon {
  kind: "svg" | "png";
  data: string;
}

export interface WorkbenchTab {
  id: string;
  /** Unique within the workbench; the tab's stable name (it appears in the full-page URL). */
  key: string;
  title: string;
  titleZh?: string;
  /**
   * The launcher label when this tab installs as its own app (`/app/…/<key>` and its own
   * manifest): shown under the home-screen icon. Falls back to the tab's `title` when
   * absent — a blank declaration means that fallback, never an empty label.
   */
  shortName?: string;
  renderer: WorkbenchTabRenderer;
  /**
   * The tab's app icon (what the manifest contributed): the first tab that names one is the
   * workbench's PWA app icon. The tab strip draws no icon.
   */
  icon?: WorkbenchTabIcon;
}

/**
 * How a workbench appears in its Project's App Center: `penguin.appCenter` in its own
 * package.json, beside `penguin.version` and `penguin.modules`. Only `show: false` keeps it off;
 * absent, or without `show`, the workbench has a shortcut there.
 */
export interface WorkbenchAppCenter {
  /** As read, the effective value; the manifest may leave it out, which reads `true`. */
  show: boolean;
  /** At most 60 characters; the first tab's title, else the package name, when absent. */
  title?: string;
  /** At most 60 characters; the first tab's `titleZh` when absent. */
  titleZh?: string;
  /**
   * An image file under `ui/`, at most 256 KB: SVG, PNG, JPEG, WebP, GIF or AVIF, its extension
   * naming the format its bytes are, and an SVG holding no script, handler or outside reference.
   * A letter tile when absent.
   */
  icon?: string;
  /** The key of the tab the shortcut opens; the first tab when absent. */
  tab?: string;
}

/** One tile of the App Center: a workbench whose manifest does not keep it off. */
export interface AppCenterShortcut {
  agentId: string;
  agentName: string;
  workbenchId: string;
  title: string;
  titleZh?: string;
  /**
   * The declared icon: `url` is its route under the workbench with the image's content revision
   * (`…/app-center/icon?rev=<hash>`), so a changed icon is a new URL, and `tint` says whether it
   * is a monochrome SVG drawn in the text colour. Absent without a declared icon that reads clean.
   */
  icon?: IconRef;
  /**
   * The library plugin that installed the workbench, by its name (the folder's `.plugin.json`
   * receipt); absent for one the Agent or a person wrote. The App Center links such a tile to its
   * plugin in the market.
   */
  plugin?: string;
  /** The full page the tile opens: /app/<projectId>/<agentId>/<workbenchId>[/<tab>]. */
  path: string;
  /** The tab the shortcut opens when the declaration names one; else the workbench's first. */
  tab?: string;
  /**
   * Where its build stands on this server: "building" while a load of its files is under way or
   * queued, "failed" when the last load recorded in `.build/status.json` failed, else "ready"
   * (a workbench this process has not loaded yet is ready: opening it loads it).
   */
  build: "ready" | "building" | "failed";
  /** With build "failed": the load error `.build/status.json` records. */
  error?: string;
  /**
   * Whether the installation is listed in its Agent's sidebar (`WorkbenchInfo.showInSidebar`):
   * what a tile's checkable "Show in the sidebar" reads. Absent from a server that predates the
   * setting, which the Web reads as "no switch to show".
   */
  showInSidebar?: boolean;
}

/**
 * What the HTML of a compiled page is served with: the page runtime's import map and its
 * stylesheet, each a file of the runtime (`…/workbenches/:id/sdk/ui/<file>`).
 */
export interface WorkbenchUiRuntime {
  /** Bare specifier → the runtime file it loads. */
  imports: Record<string, string>;
  stylesheet: string;
}

/** A file of this server's page runtime, with a strong validator of its bytes. */
export interface WorkbenchUiRuntimeFile {
  body: Uint8Array;
  etag: string;
}

/** A file of a workbench's pages, as `uiFile` finds it. */
export interface WorkbenchUiFile {
  /** Absolute path: a file under `ui/`, or the `.js` a TSX page compiled to under `.build/`. */
  path: string;
  /**
   * Set on an HTML page of a workbench whose pages are compiled: the runtime its import map
   * names. Null on every file served exactly as it is on disk.
   */
  compiled: WorkbenchUiRuntime | null;
}

/** A version of a workbench: a commit of the Agent State repository that changed its folder. */
export interface WorkbenchVersion {
  /** The folder's revision at that commit (`WorkbenchInfo.revision` when it was loaded). */
  revision: string;
  /** The commit (12 hex) in `<agentDir>/agent_state.git`. */
  commit: string;
  savedAt: string;
}

/** A request the workbench's handler receives (the HTTP shape, minus the transport). */
export interface WorkbenchRequest {
  method: string;
  /** Path below the workbench's `api/` mount, always starting with `/`. */
  path: string;
  query: Record<string, string>;
  /** Request headers, names lower-cased. The app's own credentials (`cookie`, `authorization`) are withheld. */
  headers: Record<string, string>;
  /** The parsed body of a JSON request; `null` otherwise (GET/HEAD, no body, another content type). */
  body: unknown;
  /** The body as sent, when there is one and it is not JSON: a form, an upload, plain text. */
  bytes?: Uint8Array;
}

export interface WorkbenchResponse {
  /** HTTP status; 200 when absent. */
  status?: number;
  /**
   * Response headers. Naming a `content-type` is what makes the response something other than
   * JSON; `location` with a 3xx status redirects. `set-cookie` is dropped — a workbench does not
   * write the app's cookies.
   */
  headers?: Record<string, string>;
  /** JSON by default (`null` when absent); with a `content-type` header, a string sent as written. */
  body?: unknown;
  /** A binary body (an image, a font, a download); wins over `body`. */
  bytes?: Uint8Array;
  /**
   * A body sent as it is produced — server-sent events, a model's answer token by token, a
   * large download — each chunk written to the client when the iterator yields it; wins over
   * `bytes` and `body`. A client that goes away ends the iteration: `return()` is called, so
   * a `finally` in the generator is where an upstream request is aborted — but a generator
   * suspended inside an `await` receives it only once that await settles, so a relay whose
   * upstream can hang should carry its own deadline rather than rely on the disconnect.
   */
  stream?: AsyncIterable<Uint8Array | string>;
}

/**
 * One item of what `WorkbenchHost.run` sends: the SDK builds these with `userText("…")`, but a
 * workbench has no package to import that from — its types come from the harness, and so does
 * nothing at run time. An object, so an image or a file is a new optional member later.
 */
export interface WorkbenchInput {
  text: string;
}

/** The latest task's final answer; idle alone does not mean a task succeeded. */
export interface WorkbenchResult {
  status: "running" | "completed" | "failed";
  text: string;
  error: string | null;
}

/**
 * One AMSP record as `WorkbenchHost.subscribe` hands it over: the envelope every Trace line and
 * every unnamed event of a Session's stream is. `type` is `session_meta`, `model_msg` or
 * `event_msg`; `payload.type` names the record (`task_begin`, `partial_text`, `tool_call`,
 * `task_end`, …; a `session_meta` payload has none); `origin` is the chain of child Session ids
 * a subagent's record came through, outer to inner, and is absent on the main Session's own.
 *
 * Typed by its envelope rather than by every payload AMSP defines: a workbench keeps the types
 * it was written against (`.harness/`), and a record type that grew with each new payload would
 * stop fitting them.
 */
export interface WorkbenchRecord {
  /** ISO 8601 UTC. */
  timestamp: string;
  type: string;
  payload: { type?: string; [key: string]: unknown };
  origin?: string[];
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

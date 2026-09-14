/**
 * The UI workbench panel's pure half: which address the preview points at, how a load failure is
 * named, what the probe of a candidate port can conclude, and what the guest's signals mean. Everything
 * here is a decision made from values — no DOM, no network — so the branches the panel apologizes for
 * are the branches a test can reach. The panel, `dev-server-probe.ts` and `element-picker.ts` supply
 * the values.
 */
import type { ElementFacts, PageFacts } from "./element-picker";
import { externalSourceMapUrlOf } from "./sourcemap";

/** The address the panel starts on: Vite's default, which is also what most of this user's projects use. */
export const DEFAULT_ADDRESS = "http://localhost:5173";

/** Where the last-used address is remembered, per browser profile (the app is origin-scoped). */
export const ADDRESS_KEY = "penguin.workbench.previewUrl";

/**
 * The ports worth probing for a dev server on the user's machine. Vite's 5173 and its
 * occupied-fallback 5174, then the two frameworks' defaults that are still common enough to
 * guess (CRA/Next on 3000, a plain static server on 8080).
 */
export const PORT_CANDIDATES: readonly number[] = [5173, 5174, 3000, 8080];

/**
 * Turn what the user typed into a URL to load, or null when it cannot be one. A bare
 * `localhost:5173` is the common case and is not a URL as typed, so it gets the scheme; a bare
 * `5173` is a port and gets both, because "the thing on 5173" is what the user means.
 */
export function normalizeAddress(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : /^\d+$/.test(trimmed)
      ? `http://localhost:${trimmed}`
      : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  // Only http(s): `file:` and friends would have the guest read the local disk, and the preview
  // exists to talk to a server the user is running.
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname === "") return null;
  return url.origin + (url.pathname === "/" ? "/" : url.pathname) + url.search;
}

/** The address to open the panel with: the last one used, else the default. */
export function initialAddress(stored: string | null): string {
  return stored !== null && normalizeAddress(stored) !== null ? stored : DEFAULT_ADDRESS;
}

/**
 * Why a `<webview>` load failed, in the panel's own words. Chromium's `did-fail-load` carries a
 * net error code; naming the handful that actually happen here is what keeps the status line from
 * collapsing every failure into one sentence — a port with nothing on it reads nothing like a
 * page that timed out, and each suggests a different next move.
 *
 * `-3` (ABORTED) is ours, not a failure: it is what a `stop()`/navigation mid-flight reports.
 */
export type LoadFailure =
  "refused" | "timeout" | "dns" | "blocked" | "http-error" | "crashed" | "aborted" | "other";

export function classifyLoadFailure(errorCode: number): LoadFailure {
  switch (errorCode) {
    // ABORTED is ours, not a failure: it is what a stop() or a navigation mid-flight reports.
    case -3:
      return "aborted";
    case -7:
    case -118:
      return "timeout";
    case -6:
      return "http-error";
    // ERR_BLOCKED_BY_RESPONSE: the host refused to be embedded (X-Frame-Options / frame-ancestors).
    case -27:
      return "blocked";
    case -105:
    case -137:
      return "dns";
    case -100:
    case -101:
    case -102:
    case -104:
    case -106:
    case -109:
    case -324:
      return "refused";
    default:
      return "other";
  }
}

/**
 * What the status line shows — the guest's state, and the signals that move it.
 *
 * The signals are folded through `reduceGuest` rather than assigned one by one, because their
 * *order* carries meaning the panel would otherwise lose (see that function).
 */
export type GuestState =
  | { kind: "idle" }
  | { kind: "loading"; url: string }
  | { kind: "ready"; url: string }
  | { kind: "unsupported-guest" }
  | { kind: "failed"; failure: LoadFailure; code: number; description: string };

export type GuestSignal =
  /** A navigation is under way: the panel pointed the guest at an address, or the guest started a load. */
  | { kind: "navigating"; url: string }
  /** `dom-ready` — some document finished loading. */
  | { kind: "ready"; url: string }
  /** `did-fail-load` on the main frame; `code` is Chromium's net error. */
  | { kind: "failed"; code: number; description: string }
  /** The element in the document is not a working guest (no shell, or `webviewTag` off). */
  | { kind: "unsupported" };

/**
 * Fold one guest signal into the state the status line shows.
 *
 * Electron's signals do not arrive in the order of their meaning: a main-frame load that fails still
 * commits Chromium's error page, and `dom-ready` follows `did-fail-load` within a few milliseconds —
 * measured on a port with nothing listening (-102, ERR_CONNECTION_REFUSED): failed at 22ms, ready at
 * 25ms, and `getURL()` afterwards answers the URL that never loaded. Believing the last signal draws
 * the one picture this panel must never draw — a dead port reported as "已连接". A failure therefore
 * stands until a new navigation starts.
 */
export function reduceGuest(state: GuestState, signal: GuestSignal): GuestState {
  switch (signal.kind) {
    case "navigating":
      return { kind: "loading", url: signal.url };
    case "ready":
      return state.kind === "failed" ? state : { kind: "ready", url: signal.url };
    case "unsupported":
      return { kind: "unsupported-guest" };
    case "failed": {
      const failure = classifyLoadFailure(signal.code);
      // ABORTED is ours, not a failure to show: it is a navigation we replaced mid-flight.
      if (failure === "aborted") return state;
      return { kind: "failed", failure, code: signal.code, description: signal.description };
    }
  }
}

/**
 * The picker's state as the panel shows it, and the events that move it — including the ones the
 * guest sends back about itself.
 *
 * It is three facts rather than one mode, because they answer different questions and only one of
 * them survives a page load: the switch is the user's (`wanted`, remembered across pages so that a
 * reload does not undo it), `暂离` is a moment (`paused`), and `live` says whether there is a picker
 * in the page at all. Collapsing them into a single mode is how a switch gets silently turned back on
 * by the next navigation.
 */
export interface PickState {
  /** The panel's switch. On by default: picking is what the panel is for. */
  wanted: boolean;
  /** `暂离` — the page is the user's until they come back from it. */
  paused: boolean;
  /** Whether a picker is installed in the guest on screen right now. */
  live: boolean;
  /** The element under the cursor, for the panel's "candidate" line. */
  hovered: ElementFacts | null;
  /** The element the last click locked onto. Outlives a pause on purpose: `暂离` is not "forget". */
  selected: ElementFacts | null;
  /**
   * Where the last picked element was found — the page's URL and viewport, read in the page at pick
   * time rather than reconstructed from the address box afterwards (a route change inside the page
   * would make the panel's own copy a lie). It travels with the selection because a payload is a
   * pair — the element *and* the page it came from — and an element with no page is not one.
   */
  page: PageFacts | null;
}

export type PickMode = "off" | "picking" | "paused";

/** What the picker in the page should be doing, given all three facts. */
export function pickMode(state: PickState): PickMode {
  if (!state.live || !state.wanted) return "off";
  return state.paused ? "paused" : "picking";
}

export const NO_PICK: PickState = {
  wanted: true,
  paused: false,
  live: false,
  hovered: null,
  selected: null,
  page: null,
};

/**
 * Which selection a resolution belongs to — the name the panel tags an answer with.
 *
 * A selection is a pair: an element, on a page. Those are exactly the two halves the identity is
 * built from. The page URL is read in the page at pick time (`PickState.page`), so a route change
 * inside the page moves it; the selector is the DOM path the picker built for that element as the
 * page is right now. Two picks that differ in either are two selections, and the file and line
 * resolved for one must never be shown for the other.
 *
 * `\u0000` separates them because neither half can contain it — a URL and a selector are both text a
 * page could in principle print, and a separator they could print too would let two different pairs
 * collide on one identity. (M5.1, `实测脚本/m54-卡片归属/`: the panel showed a new element with the
 * previous element's file and line for one painted frame.)
 */
export function selectionIdentity(pageUrl: string, cssSelector: string): string {
  return `${pageUrl}\u0000${cssSelector}`;
}

/** A resolved source, tagged with the selection it was resolved for. */
export interface ResolvedSource<S> {
  /** A `selectionIdentity` — what the source half is only true of. */
  identity: string;
  source: S;
}

/**
 * The source to show for `identity`: the resolution tagged with it, or nothing.
 *
 * "Nothing" is the honest answer in both of the cases this refuses — a resolution that belongs to
 * another selection (the panel's state is one step behind the pick), and no selection at all. The
 * caller reads the null as `pending` and says so, rather than showing a location that is not this
 * element's.
 */
export function sourceFor<S>(
  resolved: ResolvedSource<S> | null,
  identity: string | null,
): S | null {
  if (resolved === null || identity === null) return null;
  return resolved.identity === identity ? resolved.source : null;
}

export type PickEvent =
  /** A picker is installed in a freshly loaded page. */
  | { kind: "installed" }
  /** The guest is gone (a new address, or the panel unmounted): nothing is being picked anywhere. */
  | { kind: "guest-gone" }
  /** The panel's own switch. */
  | { kind: "toggle" }
  | { kind: "pause" }
  | { kind: "resume" }
  /** Esc, pressed in the panel or in the page — both arrive here and mean the same. */
  | { kind: "escape" }
  | { kind: "hover"; target: ElementFacts; page: PageFacts }
  | { kind: "selected"; target: ElementFacts; page: PageFacts }
  /** The page's own picker dropped the selection (Esc in the page). */
  | { kind: "cleared" }
  /** The page's own picker left pick mode (a second Esc in the page). */
  | { kind: "exited" };

/**
 * Fold one picker event into the state the panel and the guest share.
 *
 * `escape` is two-step, and the step is the whole rule: with something selected it clears the
 * selection and stays in pick mode, with nothing selected it leaves pick mode. Clearing a selection
 * that was never made is what would make Esc feel like it did nothing; leaving pick mode while an
 * element is held is what would make it feel like it threw work away.
 */
export function reducePick(state: PickState, event: PickEvent): PickState {
  switch (event.kind) {
    case "installed":
      // The switch is deliberately not reset here: a reload or a new address must not turn picking
      // back on behind a user who switched it off. The page facts *are* dropped: this is a new
      // document, and the old page's URL would be the one thing a payload must never carry.
      return { ...state, live: true, paused: false, hovered: null, selected: null, page: null };
    case "guest-gone":
      return { ...NO_PICK, wanted: state.wanted };
    case "toggle":
      return { ...state, wanted: !state.wanted, paused: false };
    case "pause":
      return { ...state, paused: true };
    case "resume":
      return { ...state, paused: false };
    case "escape":
      if (state.selected !== null) return { ...state, selected: null };
      return { ...state, wanted: false, paused: false };
    case "exited":
      return { ...state, wanted: false, paused: false, hovered: null };
    case "cleared":
      // The selection goes; the page it was found on stays, because the page has not changed.
      return { ...state, selected: null };
    case "hover":
      return { ...state, hovered: event.target, page: event.page };
    case "selected":
      return { ...state, selected: event.target, page: event.page };
  }
}

/** What is on a probed port — enough to offer it, not enough to promise anything. */
export type DevServerKind =
  /** A Vite dev server: it answers with CORS, so the page itself can be read. */
  | "vite"
  /** Some other server that answers with CORS and serves HTML. */
  | "page"
  /** Something is listening but will not let another origin read it. */
  | "listening"
  /** Nothing answered. */
  | "none";

/**
 * The first module script of a page's HTML, resolved against the page URL — the entry Vite's dev
 * server serves as a module with an inline source map, and the cheapest way to find out whether
 * this dev server can locate elements at all. Null when the page has no module script (a
 * production build or a non-app page).
 */
export function entryModuleUrl(html: string, pageUrl: string): string | null {
  const match = html.match(/<script[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/i);
  const src = match?.[1];
  if (src === undefined) return null;
  try {
    return new URL(src, pageUrl).href;
  } catch {
    return null;
  }
}

/**
 * Whether a served module carries a map the resolver can read — the thing the precise tier depends on.
 * Both forms count, because both are read (`source-resolution.ts`'s `sourceMapOf`): a map inlined as a
 * `data:` URL, and one the module *names* (`//# sourceMappingURL=index-abc.js.map`) which is fetched
 * beside it. Measured in M3.3, Vite 7 serves both forms in one page — inline for its small pre-bundled
 * chunks, side-car for the large ones — so answering "this page cannot be located" because the entry
 * module happens to name its map would be wrong in exactly the case the feature exists for.
 */
export function hasSourceMap(moduleText: string): boolean {
  const text = String(moduleText);
  if (/\/\/#\s*sourceMappingURL=data:application\/json/.test(text)) return true;
  return externalSourceMapUrlOf(text) !== null;
}

/**
 * A tab's page size (`resize`): fixed at a width and height, or fitting the Browser panel.
 *
 * A fixed size is the tab's real size, not a picture of one. It is recorded in the tab registry
 * (tabs.ts), which every tab list carries to the windows, and then made true on the far side:
 *
 * - Built-in: the window's browser layer lays the page's `<webview>` out at the size and scales it
 *   down to fit the panel (geometry.ts in the web half), so the page's viewport, its screenshots
 *   and DevTools all read the size, on screen or parked. Nothing is asked of the shell.
 * - Chrome: the extension moves the tab into a window of its own and sizes that window
 *   (`set-window-size`). When Chrome cannot give the size — beyond the screen, under its smallest
 *   window, or an extension too old to size windows — the size is emulated over the debugger
 *   instead (`emulated`): the agent's screenshots and actions see it, the window does not.
 *
 * A device pixel ratio (`scale`) and an emulated size are CDP overrides, which a debugger that
 * attaches again has lost (the extension detaches after a minute of quiet; DevTools takes the
 * built-in one over), so they are sent again before every action in the tab (`reassert`).
 * Fitting the panel clears every override, an agent's own raw `Emulation.*` left behind included.
 *
 * The answer waits until the page itself reports the size asked for, so a screenshot right after
 * is taken at it; it then gives the size the page reports, which says so when it did not take.
 */
import type {
  BrowserBackend,
  BuiltinBrowserViewport,
  DesktopBrowserCommand,
} from "@prismshadow/penguin-server/api";
import { HttpError } from "@prismshadow/penguin-server/plugin";
import type { BrowserDriver } from "./driver.js";
import { BrowserLinkError } from "./link.js";
import type { TabRegistry } from "./tabs.js";

/** The smallest and largest page edge a tab may be given, CSS px. */
export const VIEWPORT_MIN = 200;
export const VIEWPORT_MAX = 4096;
/** The device pixel ratios a tab may be given. */
export const SCALE_MIN = 1;
export const SCALE_MAX = 4;

/** What a resize asks: a fixed size, the panel's again, or only what the page reports now. */
export type ViewportRequest =
  | { kind: "fixed"; width: number; height: number; scale?: number }
  | { kind: "fit" }
  | { kind: "read" };

/** The page's viewport as the page reports it. */
export interface MeasuredViewport {
  width: number;
  height: number;
  scale: number;
}

export interface ViewportSizerDeps {
  backend: BrowserBackend;
  driver: BrowserDriver;
  tabs: TabRegistry;
  /** A command to the far side about one tab, its failure mapped as the routes answer it. */
  command(command: DesktopBrowserCommand, tabId: number): Promise<unknown>;
  /** The registry changed: the windows are sent the tab list. */
  changed(): void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** How long the page gets to report the size asked for. */
  settleMs?: number;
}

/** How long the page gets to report a new size before the answer gives what it reports. */
const SETTLE_MS = 3_000;
const POLL_MS = 50;
const MEASURE_SCRIPT = "return [innerWidth, innerHeight, devicePixelRatio];";

/** The CDP override a fixed size needs, or null when it needs none. */
function overrideOf(viewport: BuiltinBrowserViewport): Record<string, unknown> | null {
  if (viewport.emulated === true) {
    return {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.scale ?? 0,
      mobile: false,
    };
  }
  // Width and height 0 leave the size to the page's real box; only the pixel ratio is set.
  if (viewport.scale !== undefined) {
    return { width: 0, height: 0, deviceScaleFactor: viewport.scale, mobile: false };
  }
  return null;
}

export class ViewportSizer {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly settleMs: number;

  constructor(private readonly deps: ViewportSizerDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = deps.now ?? Date.now;
    this.settleMs = deps.settleMs ?? SETTLE_MS;
  }

  /** Applies a request to an open tab and answers with what the page then reports. */
  async resize(tabId: number, request: ViewportRequest): Promise<MeasuredViewport> {
    if (request.kind === "read") return this.measure(tabId);
    const before = this.deps.tabs.get(tabId)?.viewport;
    if (request.kind === "fit") {
      if (this.deps.tabs.setViewport(tabId, null)) this.deps.changed();
      await this.deps.driver.cdp(tabId, "Emulation.clearDeviceMetricsOverride");
      // The panel's size is the window's to say: wait for the page to leave the fixed one.
      return this.settle(tabId, (seen) =>
        before === undefined ? true : seen.width !== before.width || seen.height !== before.height,
      );
    }
    const { width, height } = request;
    const scale = request.scale;
    const emulated = this.deps.backend === "chrome" && !(await this.sizeWindow(tabId, request));
    const viewport: BuiltinBrowserViewport = {
      width,
      height,
      ...(scale !== undefined ? { scale } : {}),
      ...(emulated ? { emulated: true as const } : {}),
    };
    if (this.deps.tabs.setViewport(tabId, viewport)) this.deps.changed();
    await this.override(tabId, viewport);
    return this.settle(
      tabId,
      (seen) =>
        seen.width === width &&
        seen.height === height &&
        (scale === undefined || seen.scale === scale),
    );
  }

  /** Before an action: the overrides a debugger attached again would have lost. */
  async reassert(tabId: number): Promise<void> {
    const viewport = this.deps.tabs.get(tabId)?.viewport;
    if (viewport === undefined) return;
    const override = overrideOf(viewport);
    if (override !== null) {
      await this.deps.driver.cdp(tabId, "Emulation.setDeviceMetricsOverride", override);
    }
  }

  /**
   * Chrome: the extension's window for the tab, sized to it. True when Chrome gave the content
   * area asked for; false when it gave another (the screen, its smallest window) or the extension
   * is too old to size windows, and the size is to be emulated.
   */
  private async sizeWindow(
    tabId: number,
    size: { width: number; height: number },
  ): Promise<boolean> {
    let answer: unknown;
    try {
      answer = await this.deps.command(
        { op: "set-window-size", tabId, width: size.width, height: size.height },
        tabId,
      );
    } catch (err) {
      if (unknownOp(err)) return false;
      throw err;
    }
    const given = answer as { width?: unknown; height?: unknown } | null;
    return given?.width === size.width && given?.height === size.height;
  }

  private async override(tabId: number, viewport: BuiltinBrowserViewport): Promise<void> {
    const override = overrideOf(viewport);
    if (override === null) {
      await this.deps.driver.cdp(tabId, "Emulation.clearDeviceMetricsOverride");
    } else {
      await this.deps.driver.cdp(tabId, "Emulation.setDeviceMetricsOverride", override);
    }
  }

  /** Measures until `done` holds or the settle time runs out; the last measurement either way. */
  private async settle(
    tabId: number,
    done: (seen: MeasuredViewport) => boolean,
  ): Promise<MeasuredViewport> {
    const deadline = this.now() + this.settleMs;
    for (;;) {
      const seen = await this.measure(tabId);
      if (done(seen) || this.now() >= deadline) return seen;
      await this.sleep(POLL_MS);
    }
  }

  private async measure(tabId: number): Promise<MeasuredViewport> {
    const outcome = await this.deps.driver.evaluate(tabId, MEASURE_SCRIPT, { timeoutMs: 5_000 });
    const value = "value" in outcome ? outcome.value : undefined;
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      !value.every((n) => typeof n === "number" && Number.isFinite(n))
    ) {
      // Between documents: the next poll reads the new one.
      return { width: 0, height: 0, scale: 0 };
    }
    const [width, height, scale] = value as [number, number, number];
    return { width, height, scale };
  }
}

/**
 * The far side does not know the command: an extension older than window sizing, which the
 * mapped error calls outdated.
 */
function unknownOp(err: unknown): boolean {
  if (err instanceof BrowserLinkError)
    return err.kind === "refused" && err.message === "unknown_op";
  return err instanceof HttpError && err.code === "extension_outdated";
}

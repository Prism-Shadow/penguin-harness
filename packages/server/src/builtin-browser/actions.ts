/**
 * What the agent does with a tab, each over the driver: GenericAgent's web_scan and
 * web_execute_js, plus the trusted input, screenshots and raw CDP its SOP reaches for its CDP
 * bridge to do.
 *
 * exec, click and type share execute_js_rich's shape: take a baseline and start the transient
 * monitor, act, give the page a second (or wait out a reload), then report the new tabs the
 * action opened, the transient texts, and the change against the baseline — with a note when
 * nothing visible happened. `noMonitor` skips the measuring for a read that changes nothing.
 */
import type { BuiltinBrowserExecResult, BuiltinBrowserScreenshot } from "../api/types.js";
import { HttpError } from "../http/errors.js";
import { PageScriptError } from "./driver.js";
import type { BrowserDriver, EvaluateOutcome } from "./driver.js";
import type { TabRegistry } from "./tabs.js";
import { execExpression, parseExecOutcome } from "./page-scripts/exec.js";
import {
  DISPATCH_INPUT_EVENTS_SCRIPT,
  clickTargetScript,
  focusScript,
  pointTargetScript,
} from "./page-scripts/input.js";
import {
  MONITOR_BEGIN_SCRIPT,
  MONITOR_END_SCRIPT,
  MONITOR_STOP_SCRIPT,
} from "./page-scripts/monitor.js";
import { scanScript } from "./page-scripts/simplify.js";

/** web_scan's content budget. The text form defaults to a third of it, as GenericAgent's does. */
export const DEFAULT_SCAN_MAX_CHARS = 35_000;
export const DEFAULT_EXEC_TIMEOUT_MS = 15_000;

export interface ActionTiming {
  /** The pause after an action before the page is measured (execute_js_rich's sleep(1)). */
  settleMs: number;
  /** How long a reload an action caused is waited out. */
  reloadWaitMs: number;
  /** How long navigate waits for the page to load. */
  loadWaitMs: number;
  /** How long a popup's tab gets to be claimed before a call reports its new tabs without it. */
  popupClaimMs: number;
  /** The gap between the mouse events of one click (the SOP's 50–100 ms). */
  clickGapMs: number;
  /** The monitor scripts and the element lookups. */
  helperTimeoutMs: number;
  scanTimeoutMs: number;
  screenshotTimeoutMs: number;
}

export const DEFAULT_ACTION_TIMING: ActionTiming = {
  settleMs: 1_000,
  reloadWaitMs: 10_000,
  loadWaitMs: 15_000,
  popupClaimMs: 3_000,
  clickGapMs: 70,
  helperTimeoutMs: 10_000,
  scanTimeoutMs: 30_000,
  screenshotTimeoutMs: 20_000,
};

/** The tallest full-page screenshot taken, in CSS pixels (Chromium's texture limit). */
const MAX_FULL_PAGE_HEIGHT = 16_384;

const NEW_TABS_NOTE = "New tabs opened while this ran; address one by its id to work in it.";
const NO_CHANGE_NOTE = "No visible change on the page.";

/** What an action did before it is measured. */
interface ActOutcome {
  ok: boolean;
  value?: unknown;
  error?: string;
  reloaded?: boolean;
}

interface MonitorEnd {
  lost?: boolean;
  transients?: string[];
  changed?: number;
  topChange?: string;
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** A page script of ours that threw is the caller's `script_error`, with the page's message. */
function scriptError(err: unknown): Error {
  return err instanceof PageScriptError
    ? new HttpError(422, "script_error", err.message)
    : (err as Error);
}

export interface ActionDeps {
  driver: BrowserDriver;
  tabs: TabRegistry;
  timing?: Partial<ActionTiming>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class BrowserActions {
  private readonly driver: BrowserDriver;
  private readonly tabs: TabRegistry;
  private readonly timing: ActionTiming;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(deps: ActionDeps) {
    this.driver = deps.driver;
    this.tabs = deps.tabs;
    this.timing = { ...DEFAULT_ACTION_TIMING, ...deps.timing };
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = deps.now ?? Date.now;
  }

  /** web_scan: the simplified page (HTML, or text with `textOnly`). */
  async scan(
    tabId: number,
    opts: { textOnly?: boolean; maxChars?: number; instruction?: string },
  ): Promise<{ content: string; truncated: boolean }> {
    const textOnly = opts.textOnly === true;
    const maxChars =
      opts.maxChars ?? (textOnly ? Math.floor(DEFAULT_SCAN_MAX_CHARS / 3) : DEFAULT_SCAN_MAX_CHARS);
    const script = scanScript({
      textOnly,
      maxChars,
      ...(opts.instruction !== undefined ? { instruction: opts.instruction } : {}),
    });
    // A page caught between documents is scanned again once it has loaded.
    for (let attempt = 0; ; attempt++) {
      let outcome: EvaluateOutcome;
      try {
        outcome = await this.driver.evaluate(tabId, script, {
          timeoutMs: this.timing.scanTimeoutMs,
        });
      } catch (err) {
        throw scriptError(err);
      }
      if ("value" in outcome) {
        const value = (outcome.value ?? {}) as { content?: unknown; truncated?: unknown };
        return {
          content: typeof value.content === "string" ? value.content : "",
          truncated: value.truncated === true,
        };
      }
      if (attempt > 0) {
        throw new HttpError(
          422,
          "script_error",
          "The page kept navigating; scan it again once it settles.",
        );
      }
      await this.driver.waitForLoad(tabId, this.timing.reloadWaitMs);
    }
  }

  /** web_execute_js. */
  async exec(
    tabId: number,
    script: string,
    opts: { noMonitor?: boolean; timeoutMs?: number } = {},
  ): Promise<BuiltinBrowserExecResult> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    return this.observed(tabId, opts.noMonitor === true, async () => {
      let outcome: EvaluateOutcome;
      try {
        outcome = await this.driver.evaluate(tabId, `return ${execExpression(script)};`, {
          timeoutMs,
        });
      } catch (err) {
        if (err instanceof HttpError && err.code === "timeout") {
          return {
            ok: false,
            error: `No result within ${Math.round(timeoutMs / 1000)}s; the script may still be running.`,
          };
        }
        if (err instanceof PageScriptError) return { ok: false, error: err.message };
        throw err;
      }
      if ("reloaded" in outcome) return { ok: true, reloaded: true };
      const result = parseExecOutcome(outcome.value);
      if (!result.ok) {
        return { ok: false, error: `${result.error.name}: ${result.error.message}` };
      }
      return { ok: true, ...(result.data !== undefined ? { value: result.data } : {}) };
    });
  }

  /**
   * A trusted click: the element's centre (scrolled into view first) or a viewport point, then
   * mouseMoved → mousePressed → mouseReleased with a short gap — the full sequence, since
   * hover-driven components ignore a press that no move preceded.
   */
  async click(
    tabId: number,
    target: { selector: string; index?: number } | { x: number; y: number },
  ): Promise<BuiltinBrowserExecResult> {
    let clicked: { x: number; y: number; tag?: string; text?: string };
    if ("selector" in target) {
      const found = await this.helper(tabId, clickTargetScript(target.selector, target.index ?? 0));
      clicked = found as { x: number; y: number; tag?: string; text?: string };
    } else {
      const found = (await this.helper(tabId, pointTargetScript(target.x, target.y))) as {
        tag?: string;
        text?: string;
      };
      clicked = { x: target.x, y: target.y, ...found };
    }
    const { x, y } = clicked;
    const result = await this.observed(tabId, false, async () => {
      try {
        await this.driver.cdp(tabId, "Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x,
          y,
          button: "none",
        });
        await this.sleep(this.timing.clickGapMs);
        await this.driver.cdp(tabId, "Input.dispatchMouseEvent", {
          type: "mousePressed",
          x,
          y,
          button: "left",
          buttons: 1,
          clickCount: 1,
        });
        await this.sleep(this.timing.clickGapMs);
        await this.driver.cdp(tabId, "Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x,
          y,
          button: "left",
          buttons: 0,
          clickCount: 1,
        });
      } catch (err) {
        if (err instanceof HttpError && err.code === "no_such_tab") throw err;
        return { ok: false, error: messageOf(err) };
      }
      return { ok: true };
    });
    return { ...result, clicked };
  }

  /**
   * Typing: into the field `selector` names (focused, its content selected so the text
   * replaces it) or wherever focus already is; CDP insertText, then input and change events
   * for controlled components; Enter (keyDown / keyUp) with `submit`.
   */
  async type(
    tabId: number,
    opts: { text: string; selector?: string; submit?: boolean },
  ): Promise<BuiltinBrowserExecResult> {
    if (opts.selector !== undefined) await this.helper(tabId, focusScript(opts.selector));
    return this.observed(tabId, false, async () => {
      try {
        if (opts.text !== "") {
          await this.driver.cdp(tabId, "Input.insertText", { text: opts.text });
        }
        await this.driver.evaluate(tabId, DISPATCH_INPUT_EVENTS_SCRIPT, {
          timeoutMs: this.timing.helperTimeoutMs,
        });
        if (opts.submit === true) {
          const enter = {
            key: "Enter",
            code: "Enter",
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13,
          };
          await this.driver.cdp(tabId, "Input.dispatchKeyEvent", {
            type: "keyDown",
            ...enter,
            text: "\r",
            unmodifiedText: "\r",
          });
          // The keyDown is the submit; a page that navigates on it may not take the keyUp.
          await this.driver
            .cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...enter })
            .catch(() => undefined);
        }
      } catch (err) {
        if (err instanceof HttpError && err.code === "no_such_tab") throw err;
        return { ok: false, error: messageOf(err) };
      }
      return { ok: true };
    });
  }

  /** A PNG of the viewport, or of the whole page (up to Chromium's texture height). */
  async screenshot(
    tabId: number,
    opts: { fullPage?: boolean } = {},
  ): Promise<BuiltinBrowserScreenshot> {
    const params: Record<string, unknown> = { format: "png" };
    if (opts.fullPage === true) {
      const metrics = (await this.driver.cdp(tabId, "Page.getLayoutMetrics")) as {
        cssContentSize?: { width: number; height: number };
        contentSize?: { width: number; height: number };
      };
      const size = metrics.cssContentSize ?? metrics.contentSize;
      if (size !== undefined) {
        params.captureBeyondViewport = true;
        params.clip = {
          x: 0,
          y: 0,
          width: Math.max(1, Math.ceil(size.width)),
          height: Math.max(1, Math.min(MAX_FULL_PAGE_HEIGHT, Math.ceil(size.height))),
          scale: 1,
        };
      }
    }
    const shot = (await this.driver.cdp(
      tabId,
      "Page.captureScreenshot",
      params,
      this.timing.screenshotTimeoutMs,
    )) as { data?: unknown };
    if (typeof shot.data !== "string") {
      throw new HttpError(502, "cdp_error", "The page returned no screenshot.");
    }
    return { mime: "image/png", data: shot.data };
  }

  /** Raw CDP, GenericAgent's bridge: trusted input, file inputs, cross-origin frames, … */
  cdp(tabId: number, method: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.driver.cdp(tabId, method, params);
  }

  /**
   * Loads a URL in the tab and waits (up to the load budget) for it; a slow page is not an
   * error, the tab is simply still loading. A page that cannot be reached is.
   */
  async navigate(tabId: number, url: string): Promise<void> {
    const deadline = this.now() + this.timing.loadWaitMs;
    let answer: { errorText?: unknown };
    try {
      answer = (await this.driver.cdp(tabId, "Page.navigate", { url }, this.timing.loadWaitMs)) as {
        errorText?: unknown;
      };
    } catch (err) {
      if (err instanceof HttpError && err.code === "timeout") return;
      throw err;
    }
    // A download aborts the navigation and leaves the page where it was; that is not a failure.
    if (
      typeof answer.errorText === "string" &&
      answer.errorText !== "" &&
      answer.errorText !== "net::ERR_ABORTED"
    ) {
      throw new HttpError(
        502,
        "navigation_failed",
        `${url} could not be opened: ${answer.errorText}.`,
      );
    }
    await this.driver.waitForLoad(tabId, Math.max(0, deadline - this.now()));
  }

  /** Runs one of our lookup scripts; its throw is the caller's script_error. */
  private async helper(tabId: number, script: string): Promise<unknown> {
    let outcome: EvaluateOutcome;
    try {
      outcome = await this.driver.evaluate(tabId, script, {
        timeoutMs: this.timing.helperTimeoutMs,
      });
    } catch (err) {
      throw scriptError(err);
    }
    if ("reloaded" in outcome) {
      throw new HttpError(
        422,
        "script_error",
        "The page navigated while the element was being found; try again.",
      );
    }
    return outcome.value;
  }

  /** execute_js_rich: measure around `act` (see the module doc). */
  private async observed(
    tabId: number,
    noMonitor: boolean,
    act: () => Promise<ActOutcome>,
  ): Promise<BuiltinBrowserExecResult> {
    const before = new Set(this.tabs.ids());
    const since = this.now();
    // Whether the monitor runs in the page the action starts on. Without it the result goes
    // unmeasured, as GenericAgent's goes without a diff when it has no baseline.
    let monitoring = false;
    if (!noMonitor) {
      try {
        const begin = await this.driver.evaluate(tabId, MONITOR_BEGIN_SCRIPT, {
          timeoutMs: this.timing.helperTimeoutMs,
        });
        monitoring = "value" in begin;
      } catch {
        // A page too busy to answer may still have started it; it is stopped below.
      }
      if (!monitoring) this.stopMonitor(tabId);
    }
    let outcome: ActOutcome;
    try {
      outcome = await act();
    } catch (err) {
      if (monitoring) this.stopMonitor(tabId);
      throw err;
    }
    let reloaded = outcome.reloaded === true;
    if (reloaded) await this.driver.waitForLoad(tabId, this.timing.reloadWaitMs);
    else await this.sleep(this.timing.settleMs);

    const newTabs = await this.newTabs(tabId, before, since);
    const result: BuiltinBrowserExecResult = {
      status: outcome.ok ? "success" : "failed",
      tabId,
      ...(outcome.value !== undefined ? { value: outcome.value } : {}),
      ...(outcome.error !== undefined ? { error: outcome.error } : {}),
    };
    if (newTabs.length > 0) {
      result.newTabs = newTabs;
      result.suggestion = NEW_TABS_NOTE;
    }
    if (monitoring && !reloaded) {
      let end: EvaluateOutcome | null = null;
      try {
        end = await this.driver.evaluate(tabId, MONITOR_END_SCRIPT, {
          timeoutMs: this.timing.helperTimeoutMs,
        });
      } catch {
        // Unmeasurable (the page is busy or gone): the result simply carries no measurements.
      }
      const measured = end !== null && "value" in end ? ((end.value ?? {}) as MonitorEnd) : null;
      if ((end !== null && "reloaded" in end) || measured?.lost === true) {
        // The document the monitor started in is gone: the action navigated after all.
        reloaded = true;
        await this.driver.waitForLoad(tabId, this.timing.reloadWaitMs);
      } else if (measured !== null) {
        result.transients = Array.isArray(measured.transients) ? measured.transients : [];
        if (newTabs.length === 0 && typeof measured.changed === "number") {
          result.diff = {
            changed: measured.changed,
            ...(typeof measured.topChange === "string" ? { topChange: measured.topChange } : {}),
          };
          if (measured.changed === 0 && result.transients.length === 0) {
            result.suggestion = NO_CHANGE_NOTE;
          }
        }
      }
    }
    if (reloaded) result.reloaded = true;
    return result;
  }

  /** Stops a monitor that will not be read (best effort: the page may be gone). */
  private stopMonitor(tabId: number): void {
    void this.driver
      .evaluate(tabId, MONITOR_STOP_SCRIPT, { timeoutMs: this.timing.helperTimeoutMs })
      .catch(() => undefined);
  }

  /**
   * The tabs an action opened: the popups its tab asked for since it started (each given a
   * moment to be claimed, so it has an id), plus any tab that appeared meanwhile.
   */
  private async newTabs(
    tabId: number,
    before: ReadonlySet<number>,
    since: number,
  ): Promise<{ id: number; url: string }[]> {
    const found = new Map<number, string>();
    for (const request of this.tabs.opensFrom(tabId, since)) {
      const id =
        request.claimedTabId ??
        (await this.tabs.waitForClaim(request.requestId, this.timing.popupClaimMs));
      if (id !== null) found.set(id, this.tabs.get(id)?.url || request.url);
    }
    for (const tab of this.tabs.list()) {
      if (!before.has(tab.id) && !found.has(tab.id)) found.set(tab.id, tab.url);
    }
    return [...found].map(([id, url]) => ({ id, url }));
  }
}

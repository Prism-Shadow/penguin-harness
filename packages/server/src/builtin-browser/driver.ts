/**
 * The built-in browser's driver: GenericAgent's TMWebDriver, over CDP instead of an extension's
 * WebSocket. Every call is a raw CDP command the shell relays to one guest's
 * `webContents.debugger`; what this adds is the JavaScript evaluation contract the actions are
 * written against, and the mapping from the ways a page can fail to the errors the routes speak.
 *
 * - A script is wrapped as `(async () => { <code> })()` and evaluated with the promise awaited
 *   and the value returned by value, as a user gesture (so a script may open a popup or write
 *   the clipboard). It returns what it `return`s.
 * - A page that navigated or reloaded under the script ("Execution context was destroyed", …)
 *   is not an error: the call reports `{ reloaded: true }`, as TMWebDriver's `closed` does.
 * - A script that throws is a PageScriptError carrying the page's own message.
 */
import { HttpError } from "../http/errors.js";
import { ShellLinkError } from "./shell-link.js";
import type { ShellLink } from "./shell-link.js";

/** How long a raw CDP command may take when its caller names no timeout. */
export const CDP_TIMEOUT_MS = 30_000;
/** Beyond the in-page evaluation timeout, how long the link waits for the answer to travel back. */
const EVALUATE_LINK_MARGIN_MS = 2_000;
const LOAD_POLL_MS = 250;
/** After `readyState` reaches complete: a beat for the scripts a page starts on load. */
const LOAD_SETTLE_MS = 300;

/** The texts CDP answers with when the page's context went away under a call. */
const CONTEXT_LOST =
  /Execution context was destroyed|Inspected target navigated or closed|Cannot find context/i;

/** A script the page threw from; the message is the page's own. */
export class PageScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageScriptError";
  }
}

export type EvaluateOutcome = { value: unknown } | { reloaded: true };

interface RemoteObject {
  type?: string;
  value?: unknown;
  unserializableValue?: string;
  description?: string;
}

interface ExceptionDetails {
  text?: string;
  exception?: RemoteObject;
}

/** The page's message for a thrown exception: the first line of its description (`Error: …`), else what CDP says. */
export function exceptionMessage(details: ExceptionDetails): string {
  const description = details.exception?.description;
  if (typeof description === "string" && description !== "") return description.split("\n")[0]!;
  const value = details.exception?.value;
  if (value !== undefined)
    return `Uncaught ${typeof value === "string" ? value : JSON.stringify(value)}`;
  return details.text ?? "The page script failed.";
}

/** What a failed link request means to the route that asked. */
export function mapLinkError(err: unknown, tabId: number): Error {
  if (!(err instanceof ShellLinkError)) return err instanceof Error ? err : new Error(String(err));
  switch (err.kind) {
    case "timeout":
      return new HttpError(504, "timeout", err.message);
    case "closed":
      return new HttpError(
        503,
        "browser_unavailable",
        "The built-in browser's link closed; retry.",
      );
    case "refused":
      if (err.message === "no_such_tab") {
        return new HttpError(
          404,
          "no_such_tab",
          `Tab ${tabId} is not open in the built-in browser.`,
        );
      }
      return new HttpError(422, "cdp_error", err.message);
  }
}

export interface DriverOptions {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class BrowserDriver {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(
    private readonly link: ShellLink,
    opts: DriverOptions = {},
  ) {
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = opts.now ?? Date.now;
  }

  /**
   * One raw CDP command on a tab; resolves with CDP's result object. `events`, when given, is
   * the list of the tab's CDP events the shell relays from then on (`onCdpEvent` hears them).
   */
  async cdp(
    tabId: number,
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = CDP_TIMEOUT_MS,
    events?: string[],
  ): Promise<unknown> {
    try {
      return await this.link.request(
        {
          op: "cdp",
          tabId,
          method,
          ...(params !== undefined ? { params } : {}),
          ...(events !== undefined ? { events } : {}),
        },
        timeoutMs,
      );
    } catch (err) {
      throw mapLinkError(err, tabId);
    }
  }

  /** The CDP events the shell relays for one tab. Returns the unsubscribe. */
  onCdpEvent(
    tabId: number,
    listener: (method: string, params: Record<string, unknown>) => void,
  ): () => void {
    return this.link.onEvent((event) => {
      if (event.kind === "cdp-event" && event.tabId === tabId) listener(event.method, event.params);
    });
  }

  /** Evaluates `code` as the body of an async function in the tab's page (see the module doc). */
  async evaluate(
    tabId: number,
    code: string,
    opts: { timeoutMs?: number } = {},
  ): Promise<EvaluateOutcome> {
    const timeoutMs = opts.timeoutMs ?? CDP_TIMEOUT_MS;
    let raw: unknown;
    try {
      raw = await this.link.request(
        {
          op: "cdp",
          tabId,
          method: "Runtime.evaluate",
          params: {
            // The newlines keep a trailing `// comment` in the code from swallowing the close.
            expression: `(async () => {\n${code}\n})()`,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true,
            timeout: timeoutMs,
          },
        },
        timeoutMs + EVALUATE_LINK_MARGIN_MS,
      );
    } catch (err) {
      if (
        err instanceof ShellLinkError &&
        err.kind === "refused" &&
        CONTEXT_LOST.test(err.message)
      ) {
        return { reloaded: true };
      }
      throw mapLinkError(err, tabId);
    }
    const res = (raw ?? {}) as { result?: RemoteObject; exceptionDetails?: ExceptionDetails };
    if (res.exceptionDetails !== undefined) {
      const message = exceptionMessage(res.exceptionDetails);
      if (CONTEXT_LOST.test(message)) return { reloaded: true };
      throw new PageScriptError(message);
    }
    const result = res.result;
    if (result === undefined) return { value: undefined };
    if ("value" in result) return { value: result.value };
    if (result.unserializableValue !== undefined) return { value: result.unserializableValue };
    return { value: undefined };
  }

  /**
   * Waits until the tab's document is complete (plus a short settle), or `timeoutMs` passes.
   * A page between documents answers nothing useful, so failures other than a closed tab only
   * mean "not yet". Resolves whether the load finished in time.
   */
  async waitForLoad(tabId: number, timeoutMs: number): Promise<boolean> {
    const deadline = this.now() + timeoutMs;
    for (;;) {
      const left = deadline - this.now();
      if (left <= 0) return false;
      try {
        const outcome = await this.evaluate(tabId, "return document.readyState;", {
          timeoutMs: Math.max(100, Math.min(5_000, left)),
        });
        if ("value" in outcome && outcome.value === "complete") {
          await this.sleep(LOAD_SETTLE_MS);
          return true;
        }
      } catch (err) {
        if (err instanceof HttpError && err.code === "no_such_tab") throw err;
      }
      await this.sleep(Math.max(0, Math.min(LOAD_POLL_MS, deadline - this.now())));
    }
  }
}

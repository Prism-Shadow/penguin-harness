/**
 * The two routes only the hosted backend has, mounted with the rest of /api/builtin-browser
 * (routes.ts): how a person sees a tab of the server's Chrome and acts in it.
 *
 *   GET  /tabs/:id/view?width=&height=   an event stream; each `frame` event is a
 *                                        HostedBrowserFrame (a base64 JPEG and its size). The
 *                                        optional size lays the page out to the viewer's panel.
 *   POST /tabs/:id/input                 a HostedBrowserInputRequest: a batch of mouse, wheel,
 *                                        key, text and toolbar events, and optionally the
 *                                        panel's size; 204
 *
 * `:id` is a tab id. Both are the admins' (403 `admin_required`) and the hosted backend's: a
 * caller whose backend is another gets 405 `not_supported`. The stream is an ordinary SSE
 * response — the same headers and heartbeat as the event channels (http/sse.ts) — so whatever
 * relays those relays it. It ends when the tab closes or Chrome exits.
 */
import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type {
  HostedBrowserInputEvent,
  HostedBrowserInputRequest,
  HostedBrowserViewport,
} from "../api/types.js";
import type { AppEnv } from "../auth/middleware.js";
import type { SseRevocation } from "../http/sse.js";
import { badRequest } from "../http/validate.js";
import type { Actor, BuiltinBrowser } from "./service.js";

/** The revocation wiring of an authenticated stream (http/sse.ts's streamRevocation). */
export type ViewRevocation = (c: Context<AppEnv>) => SseRevocation;

const HEARTBEAT_MS = 20_000;
/** The most events one input request may carry. */
const MAX_INPUT_EVENTS = 200;
/** The longest text one `text` event inserts (a paste). */
const MAX_TEXT_CHARS = 100_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const tabIdOf = (c: Context<AppEnv>): number => {
  const raw = c.req.param("tab") ?? "";
  return /^\d{1,15}$/.test(raw) ? Number(raw) : Number.NaN;
};

function viewportOf(width: unknown, height: unknown): HostedBrowserViewport {
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw badRequest("The viewport is a width and a height in CSS pixels.");
  }
  return { width, height };
}

/** One event of an input batch, checked field by field; `at` is its place, for the error. */
function inputEvent(raw: unknown, at: number): HostedBrowserInputEvent {
  const bad = (what: string) => badRequest(`events[${at}]: ${what}`);
  if (!isRecord(raw)) throw bad("an input event is an object.");
  const number = (key: string): number => {
    const value = raw[key];
    if (typeof value !== "number" || !Number.isFinite(value)) throw bad(`${key} must be a number.`);
    return value;
  };
  const optNumber = (key: string): number | undefined =>
    raw[key] === undefined ? undefined : number(key);
  const string = (key: string, max: number): string => {
    const value = raw[key];
    if (typeof value !== "string" || value.length > max) {
      throw bad(`${key} must be a string of at most ${max} characters.`);
    }
    return value;
  };
  const oneOf = <T extends string>(key: string, values: readonly T[]): T => {
    const value = raw[key];
    if (typeof value !== "string" || !values.includes(value as T)) {
      throw bad(`${key} must be one of ${values.join(", ")}.`);
    }
    return value as T;
  };
  const modifiers = optNumber("modifiers");
  const withModifiers = modifiers !== undefined ? { modifiers } : {};
  switch (raw.type) {
    case "mouse": {
      const buttons = optNumber("buttons");
      const clickCount = optNumber("clickCount");
      return {
        type: "mouse",
        action: oneOf("action", ["move", "down", "up"] as const),
        x: number("x"),
        y: number("y"),
        ...(raw.button !== undefined
          ? { button: oneOf("button", ["none", "left", "middle", "right"] as const) }
          : {}),
        ...(buttons !== undefined ? { buttons } : {}),
        ...(clickCount !== undefined ? { clickCount } : {}),
        ...withModifiers,
      };
    }
    case "wheel":
      return {
        type: "wheel",
        x: number("x"),
        y: number("y"),
        deltaX: number("deltaX"),
        deltaY: number("deltaY"),
        ...withModifiers,
      };
    case "key": {
      const keyCode = optNumber("keyCode");
      return {
        type: "key",
        action: oneOf("action", ["down", "up"] as const),
        key: string("key", 64),
        code: string("code", 64),
        ...(keyCode !== undefined ? { keyCode } : {}),
        ...(raw.text !== undefined ? { text: string("text", 16) } : {}),
        ...(raw.repeat === true ? { repeat: true } : {}),
        ...withModifiers,
      };
    }
    case "text":
      return { type: "text", text: string("text", MAX_TEXT_CHARS) };
    case "nav":
      return {
        type: "nav",
        action: oneOf("action", ["back", "forward", "reload", "stop"] as const),
      };
    default:
      throw bad("type must be one of mouse, wheel, key, text, nav.");
  }
}

function inputRequest(body: unknown): HostedBrowserInputRequest {
  if (!isRecord(body)) throw badRequest("The body must be a JSON object.");
  const events = body.events ?? [];
  if (!Array.isArray(events) || events.length > MAX_INPUT_EVENTS) {
    throw badRequest(`events is a list of at most ${MAX_INPUT_EVENTS} input events.`);
  }
  const viewport = body.viewport;
  if (viewport !== undefined && !isRecord(viewport)) {
    throw badRequest("The viewport is a width and a height in CSS pixels.");
  }
  return {
    events: events.map(inputEvent),
    ...(viewport !== undefined ? { viewport: viewportOf(viewport.width, viewport.height) } : {}),
  };
}

export function mountHostedRoutes(
  app: Hono<AppEnv>,
  browser: BuiltinBrowser,
  actorOf: (c: Context<AppEnv>) => Actor,
  revocation?: ViewRevocation,
): void {
  app.get("/tabs/:tab/view", (c) => {
    const hosted = browser.hostedFor(actorOf(c));
    const width = c.req.query("width");
    const height = c.req.query("height");
    const viewport =
      width === undefined && height === undefined
        ? undefined
        : viewportOf(Number(width), Number(height));
    // Looked up before the stream starts, so a tab that is not open is a plain 404.
    const view = hosted.viewOf(tabIdOf(c), viewport);
    const guard = revocation?.(c);
    c.header("X-Accel-Buffering", "no");
    c.header("Cache-Control", "no-cache");
    return streamSSE(c, async (stream) => {
      let finish: () => void = () => {};
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      // Held for exactly as long as the connection lives, as http/sse.ts holds its own.
      const release = guard?.streams.add(guard.userId, finish) ?? (() => {});
      let leave: () => void = () => {};
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      try {
        leave = view.watch({
          write: (frame) => stream.writeSSE({ event: "frame", data: JSON.stringify(frame) }),
          end: finish,
        });
        heartbeat = setInterval(() => {
          if (guard !== undefined && !guard.sessionIsLive()) {
            finish();
            return;
          }
          stream.write(": ping\n\n").catch(() => finish());
        }, HEARTBEAT_MS);
        stream.onAbort(() => finish());
        await done;
      } finally {
        if (heartbeat !== null) clearInterval(heartbeat);
        leave();
        release();
      }
    });
  });

  app.post("/tabs/:tab/input", async (c) => {
    const hosted = browser.hostedFor(actorOf(c));
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw badRequest("The body is not valid JSON.");
    }
    await hosted.input(tabIdOf(c), inputRequest(body));
    return c.body(null, 204);
  });
}

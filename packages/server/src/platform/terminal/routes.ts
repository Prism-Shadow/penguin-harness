/**
 * Terminal control plane: `/api/terminals`, served by the PLATFORM through the HTTP seam.
 *
 * A Hono app on the seam contract (see ../hono-seam.ts): unknown paths and methods fall
 * to notFound, which declines to whatever is next in line — so this app owns exactly the
 * six routes below and nothing else under its prefix. The identity gate is attached
 * per-route, not as a prefix middleware, so a request nothing here serves declines
 * BEFORE authentication, same as a request outside the prefix.
 *
 * Identity is resolved through a runtime capability, not re-implemented here: the seam
 * runs BEFORE the auth middleware (app.ts mounts it there on purpose, so a push can
 * decide its own authentication), and "who is this request from" is exactly what the
 * runtime layer owns — it boots, transports and authenticates. Body limits and the
 * JSON-only rule for writes DO apply already: both middlewares sit above the seam.
 *
 * Split the way this server is built: JSON over HTTP for control, and a separate binary
 * WebSocket for the byte stream (the runtime's terminal/ws.ts hands the socket over; its
 * `/:id/stream` path is deliberately not a route here, so it declines).
 *
 *   GET    /api/terminals            list the caller's terminals
 *   POST   /api/terminals            create one (cwd defaults to the home directory)
 *   GET    /api/terminals/:id        one terminal's metadata
 *   DELETE /api/terminals/:id        kill it
 *   GET    /api/terminals/:id/capture   plain-text screen contents
 *   POST   /api/terminals/:id/keys      send text or key tokens
 *
 * `capture` and `keys` exist because a terminal should be readable and drivable by things
 * that are not a rendering client — the e2e check for reload fidelity uses them, and they
 * are the same two primitives an agent needs to run a command and read the result.
 */
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { HttpError } from "../../http/errors.js";
import { badRequest } from "../../http/validate.js";
import { declined, seamHttp } from "../hono-seam.js";
import type { TerminalManager } from "./manager.js";
import type { IdentifiedUser, Identity } from "./identity.js";

/**
 * Key tokens accepted by POST /keys, so a caller can send Enter or Ctrl-C without
 * hand-encoding control bytes.
 */
const KEY_TOKENS: Record<string, string> = {
  Enter: "\r",
  Tab: "\t",
  Escape: "\x1b",
  Backspace: "\x7f",
  Space: " ",
  Up: "\x1b[A",
  Down: "\x1b[B",
  Right: "\x1b[C",
  Left: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
  Delete: "\x1b[3~",
};

/** Resolves `keys` into bytes: literal text, or `Enter` / `C-c`-style tokens. */
export function resolveKeys(keys: string, literal: boolean): string {
  if (literal) return keys;
  if (keys in KEY_TOKENS) return KEY_TOKENS[keys] as string;
  const ctrl = /^C-([a-z@[\]\\^_])$/i.exec(keys);
  if (ctrl) {
    const ch = (ctrl[1] as string).toUpperCase();
    return String.fromCharCode(ch.charCodeAt(0) & 0x1f);
  }
  return keys;
}

function optionalInt(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value)) throw badRequest(`${field} must be an integer.`);
  return value as number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=UTF-8" },
  });
}

/** The App's error body shape, so a platform failure reads like every other API error. */
function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return json({ error: { code: err.code, message: err.message } }, err.status);
  }
  const message = err instanceof Error ? err.message : String(err);
  return json({ error: { code: "internal", message } }, 500);
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

type TerminalEnv = { Variables: { user: IdentifiedUser } };

/**
 * Serves the terminal API, or returns null for a request this platform does not own.
 * `identity` is the runtime's capability; a request it cannot attribute is 401 here rather
 * than falling through, because falling through would hand an unauthenticated caller
 * whatever older handler sits behind the seam.
 */
export function terminalHttp(
  manager: TerminalManager,
  identity: Identity,
): (request: Request) => Promise<Response | null> {
  const app = new Hono<TerminalEnv>();
  app.notFound(() => declined());
  app.onError((err) => errorResponse(err));

  const gate: MiddlewareHandler<TerminalEnv> = async (c, next) => {
    const user = await identity(c.req.raw);
    if (user === null) {
      return json({ error: { code: "unauthorized", message: "Not signed in." } }, 401);
    }
    c.set("user", user);
    await next();
  };

  app.get("/api/terminals", gate, (c) => json({ terminals: manager.listInfo(c.var.user.userId) }));
  app.post("/api/terminals", gate, async (c) =>
    json(await create(c.req.raw, manager, c.var.user.userId), 201),
  );
  app.get("/api/terminals/:id", gate, (c) =>
    json(manager.require(c.req.param("id"), c.var.user.userId).info()),
  );
  app.delete("/api/terminals/:id", gate, (c) => {
    manager.kill(c.req.param("id"), c.var.user.userId);
    return new Response(null, { status: 204 });
  });
  app.get("/api/terminals/:id/capture", gate, (c) => {
    const session = manager.require(c.req.param("id"), c.var.user.userId);
    const start = c.req.query("start");
    const end = c.req.query("end");
    return json(
      session.capture({
        ...(start !== undefined ? { start: Number.parseInt(start, 10) } : {}),
        ...(end !== undefined ? { end: Number.parseInt(end, 10) } : {}),
      }),
    );
  });
  app.post("/api/terminals/:id/keys", gate, async (c) => {
    const session = manager.require(c.req.param("id"), c.var.user.userId);
    const body = await readBody(c.req.raw);
    if (typeof body.keys !== "string") throw badRequest("keys must be a string.");
    if (!session.alive) {
      throw new HttpError(409, "terminal_exited", "This terminal's shell has exited.");
    }
    session.write(resolveKeys(body.keys, body.literal === true));
    return json({ ok: true });
  });

  return seamHttp(app);
}

async function create(request: Request, manager: TerminalManager, ownerUserId: string) {
  const body = await readBody(request);
  const cwd = typeof body.cwd === "string" && body.cwd.trim() ? body.cwd.trim() : "~";
  const name = typeof body.name === "string" ? body.name : undefined;
  // Optional shell override (default: the user's login shell). Not an escalation — the
  // terminal already runs arbitrary commands as the server's account.
  const shell = typeof body.shell === "string" && body.shell.trim() ? body.shell.trim() : undefined;
  const session = await manager.create({
    cwd,
    ownerUserId,
    ...(name !== undefined ? { name } : {}),
    ...(shell !== undefined ? { shell } : {}),
    ...(optionalInt(body.cols, "cols") !== undefined ? { cols: body.cols as number } : {}),
    ...(optionalInt(body.rows, "rows") !== undefined ? { rows: body.rows as number } : {}),
  });
  return session.info();
}

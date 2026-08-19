/**
 * Terminal control plane: `/api/terminals`, served by the PLATFORM through the HTTP seam.
 *
 * The seam's contract is a plain `Request -> Response | null` (hmr/http-seam.ts): null
 * declines and the runtime's own routes get the request. That is why this is a small
 * matcher rather than a Hono sub-app — a router mounted at a path claims everything under
 * it, including paths a future push has not taught it yet.
 *
 * Identity is resolved through a runtime capability, not re-implemented here: the seam
 * runs BEFORE the auth middleware (app.ts mounts it there on purpose, so a push can
 * decide its own authentication), and "who is this request from" is exactly what the
 * runtime layer owns — it boots, transports and authenticates. Body limits and the
 * JSON-only rule for writes DO apply already: both middlewares sit above the seam.
 *
 * Split the way this server is built: JSON over HTTP for control, and a separate binary
 * WebSocket for the byte stream (the runtime's terminal/ws.ts hands the socket over).
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
import { HttpError } from "../../http/errors.js";
import { badRequest } from "../../http/validate.js";
import type { TerminalManager } from "./manager.js";
import type { Identity } from "./identity.js";

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

const PREFIX = "/api/terminals";

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

/**
 * Serves the terminal API, or returns null for a request this platform does not own.
 * `identity` is the runtime's capability; a request it cannot attribute is 401 here rather
 * than falling through, because falling through would hand an unauthenticated caller the
 * runtime's own (older) handler.
 */
export function terminalHttp(
  manager: TerminalManager,
  identity: Identity,
): (request: Request) => Promise<Response | null> {
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return null;
    const rest = url.pathname.slice(PREFIX.length).replace(/^\//, "");
    const [id, action] = rest.split("/");
    // The byte stream upgrades on this path and never reaches the seam (a Response cannot
    // carry a socket); the runtime's ws.ts owns that handshake.
    if (action === "stream") return null;
    if (rest !== "" && (id === undefined || id === "")) return null;
    if (action !== undefined && action !== "capture" && action !== "keys") return null;

    const user = await identity(request);
    if (user === null) {
      return json({ error: { code: "unauthorized", message: "Not signed in." } }, 401);
    }

    try {
      const method = request.method.toUpperCase();
      if (rest === "") {
        if (method === "GET") return json({ terminals: manager.listInfo(user.userId) });
        if (method === "POST") return json(await create(request, manager, user.userId), 201);
        return null;
      }
      if (action === undefined) {
        if (method === "GET") return json(manager.require(id!, user.userId).info());
        if (method === "DELETE") {
          manager.kill(id!, user.userId);
          return new Response(null, { status: 204 });
        }
        return null;
      }
      if (action === "capture" && method === "GET") {
        const session = manager.require(id!, user.userId);
        const start = url.searchParams.get("start");
        const end = url.searchParams.get("end");
        return json(
          session.capture({
            ...(start !== null ? { start: Number.parseInt(start, 10) } : {}),
            ...(end !== null ? { end: Number.parseInt(end, 10) } : {}),
          }),
        );
      }
      if (action === "keys" && method === "POST") {
        const session = manager.require(id!, user.userId);
        const body = await readBody(request);
        if (typeof body.keys !== "string") throw badRequest("keys must be a string.");
        if (!session.alive) {
          throw new HttpError(409, "terminal_exited", "This terminal's shell has exited.");
        }
        session.write(resolveKeys(body.keys, body.literal === true));
        return json({ ok: true });
      }
      return null;
    } catch (err) {
      return errorResponse(err);
    }
  };
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

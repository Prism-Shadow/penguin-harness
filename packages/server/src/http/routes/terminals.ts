/**
 * Terminal control plane: `/api/terminals`.
 *
 * Modelled on Paseo's terminal operations (`list_terminals` / `create_terminal` /
 * `kill_terminal` / `capture_terminal` / `send_terminal_keys`), but split the way this
 * server is built: JSON over HTTP for control, and a separate binary WebSocket for the byte
 * stream (terminal/ws.ts).
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
import type { AppEnv } from "../../auth/middleware.js";
import { HttpError } from "../errors.js";
import { badRequest, pathParam } from "../validate.js";
import type { TerminalManager } from "../../terminal/manager.js";

/**
 * Key tokens accepted by POST /keys, so a caller can send Enter or Ctrl-C without
 * hand-encoding control bytes (Paseo's `send_terminal_keys`).
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

export function terminalsRoutes(manager: TerminalManager): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", (c) => c.json({ terminals: manager.listInfo(c.var.user.userId) }));

  app.post("/", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const cwd = typeof body.cwd === "string" && body.cwd.trim() ? body.cwd.trim() : "~";
    const name = typeof body.name === "string" ? body.name : undefined;
    // Optional shell override (default: the user's login shell). Not an escalation — the
    // terminal already runs arbitrary commands as the server's account.
    const shell = typeof body.shell === "string" && body.shell.trim() ? body.shell.trim() : undefined;
    const session = await manager.create({
      cwd,
      ownerUserId: c.var.user.userId,
      ...(name !== undefined ? { name } : {}),
      ...(shell !== undefined ? { shell } : {}),
      ...(optionalInt(body.cols, "cols") !== undefined ? { cols: body.cols as number } : {}),
      ...(optionalInt(body.rows, "rows") !== undefined ? { rows: body.rows as number } : {}),
    });
    return c.json(session.info(), 201);
  });

  app.get("/:id", (c) => c.json(manager.require(pathParam(c, "id"), c.var.user.userId).info()));

  app.delete("/:id", (c) => {
    manager.kill(pathParam(c, "id"), c.var.user.userId);
    return c.body(null, 204);
  });

  app.get("/:id/capture", (c) => {
    const session = manager.require(pathParam(c, "id"), c.var.user.userId);
    const start = c.req.query("start");
    const end = c.req.query("end");
    const result = session.capture({
      ...(start !== undefined ? { start: Number.parseInt(start, 10) } : {}),
      ...(end !== undefined ? { end: Number.parseInt(end, 10) } : {}),
    });
    return c.json(result);
  });

  app.post("/:id/keys", async (c) => {
    const session = manager.require(pathParam(c, "id"), c.var.user.userId);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.keys !== "string") throw badRequest("keys must be a string.");
    if (!session.alive) {
      throw new HttpError(409, "terminal_exited", "This terminal's shell has exited.");
    }
    session.write(resolveKeys(body.keys, body.literal === true));
    return c.json({ ok: true });
  });

  return app;
}

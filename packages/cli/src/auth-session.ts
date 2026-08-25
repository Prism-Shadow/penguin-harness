/**
 * Signing in to a PenguinHarness server from a terminal, and remembering it.
 *
 * Everything else this CLI does works on the data root directly — `config`, `run`, `chat` all
 * open files, never a socket. This is the one place that talks to a running server as a
 * client, so the two things that make that awkward live here rather than in the command.
 *
 * THE SESSION FILE. `<root>/cli-session.json`, mode 0600, holding the token a login issued.
 * It is a credential with an expiry, so it is written like one: 0600 on create AND on
 * overwrite (the mode option only applies when the file is new), and never printed unless
 * asked for.
 */
import fs from "node:fs";
import path from "node:path";
import { writeSecretFile } from "@prismshadow/penguin-server/secret-file";

/** Where a login is remembered, beside the data root it belongs to. */
export function sessionFile(root: string): string {
  return path.join(root, "cli-session.json");
}

/** A remembered login. `expiresAt` is the server's, so `status` can say it has run out. */
export interface StoredSession {
  server: string;
  userId: string;
  token: string;
  expiresAt?: string;
}

export function readSession(root: string): StoredSession | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(sessionFile(root), "utf8"));
    if (parsed === null || typeof parsed !== "object") return null;
    const row = parsed as Record<string, unknown>;
    if (typeof row.server !== "string" || typeof row.token !== "string") return null;
    return {
      server: row.server,
      userId: typeof row.userId === "string" ? row.userId : "admin",
      token: row.token,
      ...(typeof row.expiresAt === "string" ? { expiresAt: row.expiresAt } : {}),
    };
  } catch {
    return null;
  }
}

export function writeSession(root: string, session: StoredSession): void {
  const file = sessionFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Holds a bearer token; writeSecretFile makes the write refuse a symlink parked at the path.
  writeSecretFile(file, JSON.stringify(session, null, 2) + "\n");
}

export function clearSession(root: string): boolean {
  try {
    fs.unlinkSync(sessionFile(root));
    return true;
  } catch {
    return false;
  }
}

/** The server a login defaults to: the one running on this data root, from its own lock. */
export function localServerUrl(root: string): string | null {
  try {
    const lock: unknown = JSON.parse(fs.readFileSync(path.join(root, "server.lock"), "utf8"));
    const port = (lock as { port?: unknown }).port;
    return typeof port === "number" ? `http://localhost:${port}` : null;
  } catch {
    return null;
  }
}

// The one hand-rolled HTTP client (canonical Host header) lives beside the server's own
// loopback redemption; re-exported so command code keeps a single import site.
export { call } from "@prismshadow/penguin-server/auth-token";
export type { HttpAnswer } from "@prismshadow/penguin-server/auth-token";

/** The session token out of a login's Set-Cookie lines. */
export function tokenFromSetCookie(lines: string[] | undefined, name: string): string | null {
  for (const line of lines ?? []) {
    const pair = String(line).split(";")[0]?.trim() ?? "";
    const at = pair.indexOf("=");
    if (at > 0 && pair.slice(0, at) === name) return pair.slice(at + 1);
  }
  return null;
}

/**
 * Reads one echoed line from the terminal, for answers that are not secret.
 *
 * `fallback` is what an empty answer means, so the common case is a bare Enter rather than
 * retyping what the prompt already suggested.
 */
export function promptLine(prompt: string, fallback: string): Promise<string> {
  return new Promise((resolve) => {
    process.stderr.write(prompt);
    const stdin = process.stdin;
    const onData = (chunk: Buffer) => {
      stdin.pause();
      stdin.removeListener("data", onData);
      const value = chunk
        .toString("utf8")
        .replace(/\r?\n$/, "")
        .trim();
      resolve(value === "" ? fallback : value);
    };
    stdin.resume();
    stdin.on("data", onData);
  });
}

/**
 * Reads a password from the terminal without echoing it.
 *
 * Falls back to a plain read when stdin is not a TTY, so a password can be piped in — the
 * echo is the only thing being suppressed, not the ability to script.
 */
export function promptPassword(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stderr.write(prompt);
    const stdin = process.stdin;
    const raw = stdin.isTTY === true;
    let value = "";
    const done = (out: string) => {
      if (raw) {
        stdin.setRawMode(false);
        process.stderr.write("\n");
      }
      stdin.pause();
      stdin.removeListener("data", onData);
      resolve(out);
    };
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (!raw) {
        done(text.replace(/\r?\n$/, ""));
        return;
      }
      for (const ch of text) {
        // Enter ends it; Ctrl-C is an abort, not an empty password.
        if (ch === "\r" || ch === "\n") return done(value);
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          reject(new Error("cancelled"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    if (raw) stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

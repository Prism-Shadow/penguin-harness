/**
 * Signing in to a PenguinHarness server from a terminal, and remembering it.
 *
 * Everything else this CLI does works on the data root directly — `config`, `run`, `chat` all
 * open files, never a socket. This is the one place that talks to a running server as a
 * client, so the two things that make that awkward live here rather than in the command.
 *
 * THE HOST HEADER. The API answers only under its canonical app host; a request as
 * `Host: 127.0.0.1:<port>` is refused as the preview surface. So `call()` connects to the
 * address while the header says the canonical name — which fetch cannot express, node:http can.
 *
 * THE SESSION FILE. `<root>/cli-session.json`, mode 0600, holding the token a login issued.
 * It is a credential with an expiry, so it is written like one: 0600 on create AND on
 * overwrite (the mode option only applies when the file is new), and never printed unless
 * asked for.
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { sessionFile, type StoredSession } from "@prismshadow/penguin-library-cli/stored-sign-in";
import { writeSecretFile } from "../secret-file.js";

// The reader lives in the CLI face, where the client reads it for its one sign-in retry; the
// writer below stays with the commands that sign in.
export {
  readSession,
  sessionFile,
  type StoredSession,
} from "@prismshadow/penguin-library-cli/stored-sign-in";

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

export interface HttpAnswer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
}

/**
 * One request with the Host header set to the target's canonical app host (see module doc).
 * Both schemes: a login target may be a TLS deployment as easily as a loopback port. Loopback
 * connects by address (`localhost` may resolve to ::1 where the server bound 127.0.0.1 only)
 * while the header keeps the name — the spelling the API accepts.
 */
export function call(
  url: string,
  options: { method: string; path: string; cookie?: string },
  body?: unknown,
): Promise<HttpAnswer> {
  return new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      reject(new Error(`not a URL: ${url}`));
      return;
    }
    const secure = target.protocol === "https:";
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const port = target.port !== "" ? Number(target.port) : secure ? 443 : 80;
    const host = target.hostname === "localhost" ? "127.0.0.1" : target.hostname;
    const req = (secure ? https : http).request(
      {
        host,
        port,
        path: options.path,
        method: options.method,
        headers: {
          host: target.host,
          ...(options.cookie !== undefined ? { cookie: options.cookie } : {}),
          ...(payload === null
            ? {}
            : { "content-type": "application/json", "content-length": String(payload.length) }),
        },
        timeout: 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("the server did not answer in time"));
    });
    req.on("error", reject);
    if (payload === null) req.end();
    else req.end(payload);
  });
}

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
 * retyping what the prompt already suggested. `stdin` is the input to read: the caller's
 * terminal input (console-input.ts), which the caller releases.
 */
export function promptLine(
  prompt: string,
  fallback: string,
  stdin: NodeJS.ReadStream = process.stdin,
): Promise<string> {
  return new Promise((resolve) => {
    process.stderr.write(prompt);
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
 * Reads a password from the terminal without echoing it: raw mode, on stdin or on the console's
 * input alike.
 *
 * Falls back to a plain read when the input is not a TTY, so a password can be piped in — the
 * echo is the only thing being suppressed, not the ability to script. `stdin` as for
 * `promptLine`.
 *
 * Echo goes off BEFORE the prompt is shown. libuv applies raw mode with `tcsetattr(TCSADRAIN)`,
 * which on macOS takes effect only once the terminal has read what is still queued for it — the
 * prompt, had it been written first — and reading the prompt is what tells the person (or a
 * test) to type. Keys typed in that window were echoed by the terminal, password included.
 */
export function promptPassword(
  prompt: string,
  stdin: NodeJS.ReadStream = process.stdin,
): Promise<string> {
  return new Promise((resolve, reject) => {
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
    process.stderr.write(prompt);
    stdin.resume();
    stdin.on("data", onData);
  });
}

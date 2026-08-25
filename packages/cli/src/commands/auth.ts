/**
 * `penguin auth` — signing in to a PenguinHarness server from a terminal.
 *
 *   penguin auth login  [--server <url>] [--user-id <id>] [--password <pw>] [--print] [--root <dir>]
 *   penguin auth status [--root <dir>]
 *   penguin auth logout [--root <dir>]
 *   penguin auth token  [--user-id <id>] [--ttl-seconds <n>] [--root <dir>]
 *
 * `login` takes a password and asks a RUNNING server, so it works against a remote URL too.
 * `token` takes none: it mints from the data root on THIS machine, authorized by being able
 * to read it — for a hand-set admin password, a script that must not carry one, or a
 * controller reaching a managed machine over ssh (`--mark`).
 *
 * The session lands in `<root>/cli-session.json` (0600) rather than a shell's history.
 * Docs: /docs/cli § "penguin auth".
 */
import { mintApiToken } from "@prismshadow/penguin-server/auth-token";
import { liveServerLock } from "@prismshadow/penguin-server/lock";
import type { Command } from "commander";
import {
  call,
  clearSession,
  promptLine,
  promptPassword,
  readSession,
  sessionFile,
  tokenFromSetCookie,
  writeSession,
} from "../auth-session.js";
import { resolveRootOption } from "../root-option.js";
import type { Messages } from "../i18n.js";

/** Must match the server's SESSION_COOKIE — it is the name a login's Set-Cookie carries. */
const SESSION_COOKIE = "penguin_session";

/** The built-in account every server has; on a personal or desktop server it is the only one. */
const DEFAULT_USER = "admin";

/**
 * The line `--mark` prints before the token. A caller reading the token out of a remote shell
 * anchors on this rather than on position, so nothing the shell prints on its own can be
 * mistaken for a credential.
 */
export const TOKEN_MARK = "---penguin-auth-token---";

/**
 * What the server said about a refusal, as one line. The API's own error body is quoted in
 * full; anything else (a proxy's HTML page) is collapsed and bounded with the cut MARKED, so a
 * fragment is never presented as the whole message.
 */
function serverSaid(text: string): string {
  try {
    const body: unknown = JSON.parse(text);
    const message = (body as { error?: { message?: unknown } })?.error?.message;
    if (typeof message === "string") return message;
  } catch {
    // Not the API's shape; fall through to the bounded raw form.
  }
  const line = text.replace(/\s+/g, " ").trim();
  if (line === "") return "(no message)";
  return line.length <= 500 ? line : `${line.slice(0, 500)}… (truncated)`;
}

/** Writes an error line and marks the run failed; `return fail(msg)` ends the action. */
function fail(message: string): void {
  process.stderr.write(message + "\n");
  process.exitCode = 1;
}

export function registerAuthCommand(program: Command, t: Messages): void {
  const auth = program.command("auth").description(t.auth.desc);

  auth
    .command("login")
    .description(t.auth.loginDesc)
    .option("--server <url>", t.auth.server)
    .option("--user-id <id>", t.auth.userId)
    .option("--password <pw>", t.auth.password)
    .option("--print", t.auth.print, false)
    .option("--root <dir>", t.common.root)
    .action(
      async (opts: {
        server?: string;
        userId?: string;
        password?: string;
        print: boolean;
        root?: string;
      }) => {
        const root = resolveRootOption(opts.root);
        // A password is about to be sent here, so the default target comes from a VERIFIED
        // live lock (PID + port): a stale one from a crashed server may name a port another
        // process now holds. An explicit --server is the caller's own responsibility.
        let server: string | null = opts.server ?? null;
        if (server === null) {
          const lock = await liveServerLock(root);
          server = lock === null ? null : `http://localhost:${lock.port}`;
        }
        if (server === null) return fail(t.auth.noServer(root));
        // A script cannot answer a prompt, so a non-interactive password suppresses both
        // questions; the account is only asked for when the password will be too.
        const given = opts.password ?? process.env.PENGUIN_PASSWORD;
        const userId =
          opts.userId ??
          (given === undefined && process.stdin.isTTY === true
            ? await promptLine(t.auth.accountPrompt(DEFAULT_USER), DEFAULT_USER)
            : DEFAULT_USER);
        // Env before prompt, but never argv by default: a command line is world-readable
        // through ps. The prompt names the account, so one account's password is not typed
        // at another's.
        const password = given ?? (await promptPassword(t.auth.prompt(userId)));
        if (password === "") return fail(t.auth.emptyPassword);

        let answer;
        try {
          answer = await call(
            server,
            { method: "POST", path: "/api/auth/login" },
            { userId, password },
          );
        } catch (err) {
          return fail(t.auth.unreachable(server, err instanceof Error ? err.message : String(err)));
        }
        if (answer.status !== 200) {
          return fail(t.auth.refused(answer.status, serverSaid(answer.text)));
        }
        const setCookie = answer.headers["set-cookie"];
        const token = tokenFromSetCookie(
          Array.isArray(setCookie) ? setCookie : setCookie === undefined ? [] : [setCookie],
          SESSION_COOKIE,
        );
        if (token === null) return fail(t.auth.noCookie);
        writeSession(root, { server, userId, token });
        process.stderr.write(t.auth.loggedIn(userId, server, sessionFile(root)) + "\n");
        // STDOUT and only on request, so it pipes cleanly and never lands in a log by accident.
        if (opts.print) process.stdout.write(token + "\n");
      },
    );

  auth
    .command("status")
    .description(t.auth.statusDesc)
    .option("--root <dir>", t.common.root)
    .action((opts: { root?: string }) => {
      const root = resolveRootOption(opts.root);
      const session = readSession(root);
      if (session === null) {
        process.stdout.write(t.auth.notLoggedIn(sessionFile(root)) + "\n");
        return;
      }
      process.stdout.write(t.auth.statusLine(session.userId, session.server) + "\n");
      if (session.expiresAt !== undefined) {
        const over = Date.parse(session.expiresAt) <= Date.now();
        process.stdout.write(
          (over ? t.auth.expired(session.expiresAt) : t.auth.expires(session.expiresAt)) + "\n",
        );
      }
    });

  auth
    .command("logout")
    .description(t.auth.logoutDesc)
    .option("--root <dir>", t.common.root)
    .action(async (opts: { root?: string }) => {
      const root = resolveRootOption(opts.root);
      const session = readSession(root);
      if (session === null) {
        process.stdout.write(t.auth.notLoggedIn(sessionFile(root)) + "\n");
        return;
      }
      // Server first: a token deleted only locally stays valid for whoever else holds a copy.
      // An unreachable server does not block the local clear.
      let revoked = false;
      try {
        const answer = await call(session.server, {
          method: "POST",
          path: "/api/auth/logout",
          cookie: `${SESSION_COOKIE}=${session.token}`,
        });
        revoked = answer.status >= 200 && answer.status < 300;
      } catch {
        revoked = false;
      }
      clearSession(root);
      process.stdout.write(
        (revoked ? t.auth.loggedOut(session.server) : t.auth.loggedOutLocally(session.server)) +
          "\n",
      );
    });

  auth
    .command("token")
    .description(t.authToken.desc)
    .option("--user-id <id>", t.authToken.userId, DEFAULT_USER)
    // Number, not parseInt: parseInt("3600abc") is 3600, and a lifetime silently taken from
    // a typo is worse than a rejected flag.
    .option("--ttl-seconds <n>", t.authToken.ttlSeconds, (raw: string) => Number(raw))
    .option("--mark", t.authToken.mark, false)
    .option("--root <dir>", t.common.root)
    .action(async (opts: { userId: string; ttlSeconds?: number; mark: boolean; root?: string }) => {
      const ttl = opts.ttlSeconds;
      if (ttl !== undefined && (!Number.isSafeInteger(ttl) || ttl <= 0)) {
        return fail(t.authToken.badTtl);
      }
      const root = resolveRootOption(opts.root);
      // A session row written straight into web.db (auth-token.ts); no server needed, and safe
      // while one runs. PENGUIN_WEB_DB honored as everywhere else, or the token would be
      // minted into a file the live server never reads.
      const result = mintApiToken(root, {
        userId: opts.userId,
        ...(process.env.PENGUIN_WEB_DB ? { dbPath: process.env.PENGUIN_WEB_DB } : {}),
        ...(ttl === undefined ? {} : { ttlMs: ttl * 1000 }),
      });
      if (result.outcome === "no_server") {
        return fail(t.authToken.noServer(root));
      }
      if (result.outcome === "failed") {
        return fail(t.authToken.failed(result.detail));
      }
      // The session file says where a later `logout` goes, so the URL comes from a live lock
      // — a stale one would hand the token to whatever now holds that port.
      const lock = await liveServerLock(root);
      const server = lock === null ? null : `http://localhost:${lock.port}`;
      if (server !== null) {
        writeSession(root, {
          server,
          userId: result.userId,
          token: result.token,
          expiresAt: result.expiresAt,
        });
      }
      // Bare so `TOKEN=$(penguin auth token)` works. `--mark` prefixes a fixed line for a
      // caller parsing this out of a shell whose banner would otherwise be the last line.
      if (opts.mark) process.stdout.write(TOKEN_MARK + "\n");
      process.stdout.write(result.token + "\n");
    });
}

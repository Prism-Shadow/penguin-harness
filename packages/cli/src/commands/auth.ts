/**
 * `penguin auth` — signing in to a PenguinHarness server from a terminal.
 *
 *   penguin auth login  [--server <url>] [--user-id <id>] [--password <pw>] [--print] [--root <dir>]
 *   penguin auth status [--root <dir>]
 *   penguin auth logout [--root <dir>]
 *   penguin auth token  [--user-id <id>] [--ttl-seconds <n>] [--root <dir>]
 *
 * TWO WAYS IN, and which one is right depends on where you are standing.
 *
 * `login` is the one that takes a password: it asks a RUNNING server, over HTTP, exactly as
 * the browser's login page does, and the session it gets back is an ordinary one. Use it
 * against a server you have the password for — including a remote deployment, since the
 * target is a URL.
 *
 * `token` takes no password at all. It mints a session straight from the data root on THIS
 * machine, and what authorizes it is the fact that you can read that root — which already
 * contains every credential the token could reach. Use it where there is no password to give:
 * a machine whose admin password somebody set by hand, or a script that must not hold one.
 * It is also what a controller runs over ssh to reach a machine it manages, which is what
 * `--mark` exists for.
 *
 * The session is written to `<root>/cli-session.json` at mode 0600. Nothing else in this CLI
 * reads it yet — `config`, `run` and `chat` all work on the data root directly and never open
 * a socket — so today it is for `status`, `logout`, and for handing to something else with
 * `--print`. It is stored rather than only printed so that a shell's history is not where a
 * credential ends up.
 * Docs: /docs/cli § "penguin auth".
 */
import { mintApiToken } from "@prismshadow/penguin-server/auth-token";
import type { Command } from "commander";
import {
  call,
  clearSession,
  localServerUrl,
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
 * What the server said about a refusal, as one line.
 *
 * The API's own error body is the normal case and is quoted in full — a truncated reason is
 * worse than no reason, since there is no way to tell which you got. Anything else is not the
 * API answering (a proxy's HTML page, a gateway's plain text), so it is collapsed to a single
 * line and bounded, with the cut MARKED: a wall of markup helps nobody, and silently keeping
 * the first N characters would present a fragment as the whole message.
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
        // Defaults to the server running on this data root: the overwhelmingly common case is
        // signing in to your own, and reading its port from its lock beats retyping it.
        const server = opts.server ?? localServerUrl(root);
        if (server === null) {
          process.stderr.write(t.auth.noServer(root) + "\n");
          process.exitCode = 1;
          return;
        }
        // A password given non-interactively means a script, and a script must not be stopped
        // to answer a question it has no way to answer. Only when we are going to ask for the
        // password anyway is the account asked for too — otherwise it defaults, as it always did.
        const given = opts.password ?? process.env.PENGUIN_PASSWORD;
        const userId =
          opts.userId ??
          (given === undefined && process.stdin.isTTY === true
            ? await promptLine(t.auth.accountPrompt(DEFAULT_USER), DEFAULT_USER)
            : DEFAULT_USER);
        // Env before prompt so this scripts, but never as an ARGUMENT by default: argv is
        // world-readable through ps, and --password is offered only because a caller who has
        // already accepted that (a CI runner, a private box) should not be forced into a TTY.
        // The prompt names the account, so nobody types one account's password at another's.
        const password = given ?? (await promptPassword(t.auth.prompt(userId)));
        if (password === "") {
          process.stderr.write(t.auth.emptyPassword + "\n");
          process.exitCode = 1;
          return;
        }

        let answer;
        try {
          answer = await call(
            server,
            { method: "POST", path: "/api/auth/login" },
            { userId, password },
          );
        } catch (err) {
          process.stderr.write(
            t.auth.unreachable(server, err instanceof Error ? err.message : String(err)) + "\n",
          );
          process.exitCode = 1;
          return;
        }
        if (answer.status !== 200) {
          process.stderr.write(t.auth.refused(answer.status, serverSaid(answer.text)) + "\n");
          process.exitCode = 1;
          return;
        }
        const setCookie = answer.headers["set-cookie"];
        const token = tokenFromSetCookie(
          Array.isArray(setCookie) ? setCookie : setCookie === undefined ? [] : [setCookie],
          SESSION_COOKIE,
        );
        if (token === null) {
          process.stderr.write(t.auth.noCookie + "\n");
          process.exitCode = 1;
          return;
        }
        writeSession(root, { server, userId, token });
        process.stderr.write(t.auth.loggedIn(userId, server, sessionFile(root)) + "\n");
        // The token itself goes to STDOUT and only when asked, so it can be piped without the
        // surrounding prose, and cannot end up in a log by accident.
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
      // Told to the server first, so the session is revoked THERE and not merely forgotten
      // here — a token deleted only locally stays valid for whoever else has a copy. A server
      // that cannot be reached does not block the local clear: the file goes either way.
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
    .option("--ttl-seconds <n>", t.authToken.ttlSeconds, (raw: string) => Number.parseInt(raw, 10))
    .option("--mark", t.authToken.mark, false)
    .option("--root <dir>", t.common.root)
    .action(async (opts: { userId: string; ttlSeconds?: number; mark: boolean; root?: string }) => {
      const ttl = opts.ttlSeconds;
      if (ttl !== undefined && (!Number.isFinite(ttl) || ttl <= 0)) {
        process.stderr.write(t.authToken.badTtl + "\n");
        process.exitCode = 1;
        return;
      }
      const root = resolveRootOption(opts.root);
      // Stateless: the token is signed against the root's key, so there is no database to
      // need — a root whose server has never run mints for the admin its first boot seeds.
      const result = await mintApiToken(root, {
        userId: opts.userId,
        ...(ttl === undefined ? {} : { ttlMs: ttl * 1000 }),
      });
      if (result.outcome === "no_server") {
        process.stderr.write(t.authToken.noServer(root) + "\n");
        process.exitCode = 1;
        return;
      }
      if (result.outcome === "failed") {
        process.stderr.write(t.authToken.failed(result.detail) + "\n");
        process.exitCode = 1;
        return;
      }
      const server = localServerUrl(root);
      if (server !== null) {
        writeSession(root, {
          server,
          userId: result.userId,
          token: result.token,
          expiresAt: result.expiresAt,
        });
      }
      // Bare by default, so `TOKEN=$(penguin auth token)` is the obvious thing. `--mark`
      // prefixes a fixed line for a caller reading this out of a shell it does not control:
      // a login profile that prints a banner would otherwise put its own text on the same
      // stream, and a reader taking "the last line" would take the banner.
      if (opts.mark) process.stdout.write(TOKEN_MARK + "\n");
      process.stdout.write(result.token + "\n");
    });
}

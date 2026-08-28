/**
 * Getting a session on a machine by asking its own CLI for one.
 *
 * The older way (signin.ts) reads that machine's SEEDED admin password off its disk and logs
 * in over loopback. It works exactly until somebody sets a real admin password there — which
 * is what a person setting a machine up properly does — and then never again, leaving a
 * machine that is connected, healthy, and impossible for this server to configure.
 *
 * This asks instead: `penguin auth token` mints a short-lived session from the data
 * root the ssh account already owns. What authorizes it is that access, not a secret — anyone
 * who can run it can already read every credential on that machine by hand. And the token is
 * the better artifact in every direction: an hour long, one row to revoke, and it leaves the
 * admin password where it belongs.
 *
 * ONE COMMAND over the shared connection, where the password path needed a scratch directory,
 * two scp'd files and a Node process. That is why this is tried first even on a machine where
 * both would work.
 */
import { execFailureText } from "./exec.js";
import { REMOTE_PENGUIN } from "./commands.js";
import type { RemoteTarget } from "./commands.js";
import type { ExecResult } from "./exec.js";

/** Precedes the token on its own line — the same mark the CLI prints (cli/commands/auth.ts). */
const TOKEN_MARK = "---penguin-auth-token---";

export type RemoteTokenOutcome =
  | { kind: "minted"; token: string }
  /**
   * The machine could not mint one — most often an installed build older than the command.
   * Separate from a failure because the caller has another way to try (signin.ts).
   */
  | { kind: "unsupported"; detail: string }
  | { kind: "failed"; detail: string };

/**
 * The command that asks for a token. `--ttl-seconds` is deliberately short: this is used
 * immediately, and a token still lying in a log an hour from now is worth nothing.
 */
export function authTokenCommand(ttlSeconds = 3600): string {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) throw new Error(`bad ttl ${ttlSeconds}`);
  // `--mark` is what makes the output parseable: without it the CLI prints the bare token,
  // and parseToken has no anchor to find it by in a shell that may print a banner of its own.
  return `${REMOTE_PENGUIN} auth token --ttl-seconds ${ttlSeconds} --mark 2>&1`;
}

/**
 * Reads the token out of the CLI's output.
 *
 * Anchored on the marker and taking the FIRST non-empty line after it: the command runs
 * through a shell whose profile may print anything it likes, and a banner is not a credential.
 */
export function parseToken(output: string): string | null {
  const at = output.indexOf(TOKEN_MARK);
  if (at === -1) return null;
  for (const line of output.slice(at + TOKEN_MARK.length).split("\n")) {
    const value = line.trim();
    if (value !== "") return value;
  }
  return null;
}

/** Asks a machine's CLI for a session token, over the connection that is already open. */
export async function mintTokenOnRemote(
  target: RemoteTarget,
  runOn: (target: RemoteTarget, command: string) => Promise<ExecResult>,
  ttlSeconds = 3600,
): Promise<RemoteTokenOutcome> {
  // `runOn` rides the machine's shared ssh connection, which can be gone by the time this
  // asks — and it REJECTS rather than answering when it is. Every other way of not getting a
  // token is a returned outcome, and the caller reads outcomes: letting this one throw skips
  // the password fallback below it entirely and reaches the route as a 500, so a machine
  // whose connection dropped answers "internal error" instead of "could not sign in there".
  let result: ExecResult;
  try {
    result = await runOn(target, authTokenCommand(ttlSeconds));
  } catch (err) {
    return { kind: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
  const token = parseToken(result.stdout);
  if (token !== null) return { kind: "minted", token };
  if (result.timedOut) {
    return { kind: "failed", detail: execFailureText(result, "it did not answer in time") };
  }
  // No marker: an older install whose CLI has no such command, a missing binary, or a data
  // root with no database. All of them mean "ask another way", which is the caller's move.
  return {
    kind: "unsupported",
    detail: result.stdout.trim().split("\n").slice(-1)[0] ?? "no token came back",
  };
}

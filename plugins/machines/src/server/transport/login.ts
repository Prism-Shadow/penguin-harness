/**
 * How an ssh child signs in to a machine: with this account's keys (the default, BatchMode), or
 * with a password this server stores for the machine's alias (../ssh-passwords.ts).
 *
 * A PASSWORD REACHES SSH THROUGH SSH_ASKPASS ALONE. Never argv (any account on this computer can
 * read a process's arguments), never a file ssh reads, never a log: the askpass helper holds no
 * secret and prints the value of PASSWORD_ENV, which is set on that one ssh child's environment
 * and nowhere else. ssh runs the helper instead of reading a terminal when told to
 * (`SSH_ASKPASS_REQUIRE=force`, OpenSSH 8.4 and later); before 8.4 it does so only when it has
 * no terminal to open and DISPLAY is set, which a child started in a session of its own
 * (`detached`, i.e. setsid) never has. Windows has no such session: an older ssh there would
 * prompt on the server's console, so a password is refused instead, naming the version.
 *
 * A REFUSED PASSWORD IS NOT TRIED AGAIN. A server that keeps a machine connected retries on its
 * own, and an account that locks after a few failures would be locked by it. So the first refusal
 * of a stored password is remembered — by the password's hash, in memory — and every later spawn
 * for that alias answers with the same refusal without dialling, until a password is saved for it
 * again (forgetRefusal). A restart forgets it, which costs one attempt.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import type { RemoteTarget } from "../commands.js";
import { explainSshFailure, sshFailureText } from "../ssh-failure.js";

/** The variable the helper prints: set on the ssh child that needs it, and on nothing else. */
export const PASSWORD_ENV = "PENGUIN_SSH_PASSWORD";

/** The first OpenSSH that asks the helper whatever terminal it has (`SSH_ASKPASS_REQUIRE`). */
const ASKPASS_REQUIRE_SINCE = { major: 8, minor: 4 };

/** `ssh -V`'s version, read from its banner (`OpenSSH_9.6p1 …`, `OpenSSH_for_Windows_8.1p1 …`). */
export function parseOpenSshVersion(said: string): { major: number; minor: number } | null {
  const found = /OpenSSH_(?:for_Windows_)?(\d+)\.(\d+)/.exec(said);
  return found === null ? null : { major: Number(found[1]), minor: Number(found[2]) };
}

/** Whether this computer's ssh can be made to ask the helper, and how — or why not. */
export type AskpassPlan =
  { ok: true; detached: boolean } | { ok: false; detail: string; ssh: string };

/** The plan for an ssh whose `-V` said `said`, on `platform`. */
export function askpassPlan(said: string, platform: NodeJS.Platform): AskpassPlan {
  const version = parseOpenSshVersion(said);
  const { major, minor } = ASKPASS_REQUIRE_SINCE;
  if (
    version !== null &&
    (version.major > major || (version.major === major && version.minor >= minor))
  ) {
    return { ok: true, detached: false };
  }
  if (version !== null && platform !== "win32") return { ok: true, detached: true };
  const ssh = said.trim().split(/\r?\n/)[0] ?? "";
  return {
    ok: false,
    ssh,
    detail:
      `Signing in with a password needs OpenSSH ${major}.${minor} or later on this computer; ` +
      (ssh === "" ? "its ssh did not say its version." : `its ssh is ${ssh}.`),
  };
}

/** `ssh -V`, asked once per PATH: the PATH decides which ssh every spawn here runs. */
let versionAsked: { path: string | undefined; said: Promise<string> } | null = null;

function localSshVersion(): Promise<string> {
  const pathNow = process.env.PATH;
  if (versionAsked === null || versionAsked.path !== pathNow) {
    versionAsked = {
      path: pathNow,
      said: new Promise((resolve) => {
        execFile("ssh", ["-V"], { timeout: 10_000, windowsHide: true }, (_err, stdout, stderr) =>
          resolve(`${String(stderr)}${String(stdout)}`.trim()),
        );
      }),
    };
  }
  return versionAsked.said;
}

/** Whether a password can be used on this computer: what saving one asks first. */
export async function passwordSignIn(): Promise<AskpassPlan> {
  return askpassPlan(await localSshVersion(), process.platform);
}

/**
 * The environment of an ssh child that signs in with `secret`: the parent's, plus the helper,
 * the order to use it, the DISPLAY an older OpenSSH insists on (no display is ever opened: the
 * session's options leave X11 off), and the password the helper prints.
 */
export function passwordEnv(
  base: NodeJS.ProcessEnv,
  askpass: string,
  secret: string,
): NodeJS.ProcessEnv {
  return {
    ...base,
    SSH_ASKPASS: askpass,
    SSH_ASKPASS_REQUIRE: "force",
    DISPLAY: base.DISPLAY !== undefined && base.DISPLAY !== "" ? base.DISPLAY : ":0",
    [PASSWORD_ENV]: secret,
  };
}

/** What a spawn of ssh (or scp) for a machine takes beyond its argv. */
export interface SignIn {
  /** The child's environment; undefined to inherit this process's, as a key sign-in does. */
  env?: NodeJS.ProcessEnv;
  /** Start it in a session of its own, with no terminal to prompt on (OpenSSH before 8.4). */
  detached: boolean;
  /** The password it signs in with, to remember if it is refused; null for keys. */
  secret: string | null;
}

/** The password refused per alias: its hash, and what ssh said, which every later answer repeats. */
const refused = new Map<string, { hash: string; said: string }>();

const hashOf = (secret: string) => createHash("sha256").update(secret, "utf8").digest("hex");

/**
 * How to spawn ssh for `target`, or why not to: no password left to sign in with, a password
 * already refused, or an ssh that cannot be made to ask the helper. The refusals read the way
 * ssh's own would, led by the same sentence, so a caller tells them apart from nothing else.
 */
export async function signInFor(
  target: RemoteTarget,
): Promise<{ ok: true; signIn: SignIn } | { ok: false; detail: string }> {
  const password = target.password;
  if (password === undefined) return { ok: true, signIn: { detached: false, secret: null } };
  const secret = password.read();
  if (secret === null) {
    return {
      ok: false,
      detail: `No password is saved for ${target.alias} any more; enter it again in this machine's SSH settings.`,
    };
  }
  const known = refused.get(target.alias);
  if (known !== undefined && known.hash === hashOf(secret)) {
    return {
      ok: false,
      detail: sshFailureText(known.said, target.alias, { password: true }) ?? known.said,
    };
  }
  const plan = await passwordSignIn();
  if (!plan.ok) return { ok: false, detail: plan.detail };
  return {
    ok: true,
    signIn: {
      env: passwordEnv(process.env, password.askpass, secret),
      detached: plan.detached,
      secret,
    },
  };
}

/**
 * Reads what a password sign-in's ssh said as it failed: a refused password (or a host that
 * takes none) is remembered, so nothing dials that alias with it again. True when it was one.
 * Only words from before a session came up count — a session's later stderr is not ssh's verdict.
 */
export function noteSignIn(target: RemoteTarget, signIn: SignIn, said: string): boolean {
  if (signIn.secret === null) return false;
  const reason = explainSshFailure(said, target.alias, { password: true })?.reason;
  if (reason !== "password-rejected" && reason !== "password-not-offered") return false;
  refused.set(target.alias, { hash: hashOf(signIn.secret), said });
  return true;
}

/** Lets an alias dial again with whatever password it has now — a password was saved or removed. */
export function forgetRefusal(alias: string): void {
  refused.delete(alias);
}

/**
 * What the elevated setup left behind, and how both halves of this backend find it.
 *
 * The setup script creates the accounts and writes ONE file (`%ProgramData%\penguin\
 * sandbox-winuser.json`) naming them and holding their passwords. The plugin reads it to
 * decide whether it can serve; the launcher reads it to log a command in as one of them.
 * The file's permissions are the secret's protection — the setup script grants only
 * Administrators, SYSTEM and the account that runs the harness — so neither half ever
 * passes a password through an argument, where every process on the machine could read it.
 */
import fs from "node:fs";
import path from "node:path";

/** Where the setup script writes what it created. Fixed: both halves resolve it the same way. */
export function stateFile(env: NodeJS.ProcessEnv = process.env): string {
  const programData = env.ProgramData ?? "C:\\ProgramData";
  return path.win32.join(programData, "penguin", "sandbox-winuser.json");
}

/** The home the confined command gets: the sandbox accounts have no profile of their own. */
export function sandboxHome(env: NodeJS.ProcessEnv = process.env): string {
  const programData = env.ProgramData ?? "C:\\ProgramData";
  return path.win32.join(programData, "penguin", "sandbox-home");
}

/** One account the setup created: its name, and the password only the launcher needs. */
export interface SandboxAccount {
  user: string;
  password: string;
}

/** The setup's result: the group holding the accounts, and the two accounts themselves. */
export interface WinUserState {
  /** The local group every grant names, so a path is opened to both accounts at once. */
  group: string;
  /** Blocked outbound by the firewall rules the setup added, for `network: "none"`. */
  offline: SandboxAccount;
  /** Unrestricted network, for a policy that does not ask for isolation. */
  online: SandboxAccount;
}

/** Everything the state must carry to be usable, checked rather than assumed. */
function isState(value: unknown): value is WinUserState {
  const s = value as Partial<WinUserState> | null;
  const account = (a: Partial<SandboxAccount> | undefined) =>
    typeof a?.user === "string" && a.user !== "" && typeof a.password === "string";
  return (
    s !== null &&
    typeof s === "object" &&
    typeof s.group === "string" &&
    s.group !== "" &&
    account(s.offline) &&
    account(s.online)
  );
}

/**
 * The setup's state, or null when this host has none (never set up, or the file was removed).
 * A malformed file counts as no setup: the backend then declines with the setup instructions
 * rather than failing every command with a parse error.
 */
export function readState(file: string = stateFile()): WinUserState | null {
  let parsed: unknown;
  try {
    // Windows PowerShell writes UTF-8 WITH a byte-order mark, and JSON.parse refuses one — so
    // the setup would leave a perfectly good file that this read reported as no setup at all.
    parsed = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
  return isState(parsed) ? parsed : null;
}

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

/** The base directory the setup and both halves share (state file, temp, transcript). */
export function sandboxBase(env: NodeJS.ProcessEnv = process.env): string {
  const programData = env.ProgramData ?? "C:\\ProgramData";
  return path.win32.join(programData, "penguin");
}

/**
 * The writable temp every sandbox account shares. The confined command's HOME is left real
 * (see the setup's profile grant); this is the one directory redirected, so a shell has
 * somewhere to write. Fixed, like the state file, so setup and launcher agree without the
 * state having to carry it.
 */
export function sandboxTemp(env: NodeJS.ProcessEnv = process.env): string {
  return path.win32.join(sandboxBase(env), "sandbox-temp");
}

/** One account the setup created: its name, and the password only the launcher needs. */
export interface SandboxAccount {
  user: string;
  password: string;
}

/**
 * The setup's result: the group every grant names, the real home it opened to the accounts,
 * and the four accounts — the network axis (open / blocked) crossed with the filesystem axis
 * (the home read-only, or writable for full access).
 */
export interface WinUserState {
  /** The local group every Workspace grant names, so a path is opened to every account at once. */
  group: string;
  /** The real profile the setup granted the accounts (read for all, modify for the full ones). */
  home: string;
  /** Network open, home read-only: read-only and workspace-write commands that keep the net. */
  online: SandboxAccount;
  /** Network blocked, home read-only: the same, with `network: "none"`. */
  offline: SandboxAccount;
  /** Network open, home writable: a full-access command that still needs confining (masked paths). */
  fullOnline: SandboxAccount;
  /** Network blocked, home writable: full access with `network: "none"`. */
  fullOffline: SandboxAccount;
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
    typeof s.home === "string" &&
    s.home !== "" &&
    account(s.online) &&
    account(s.offline) &&
    account(s.fullOnline) &&
    account(s.fullOffline)
  );
}

/**
 * The setup's state, or null when this host has none (never set up, or the file was removed).
 * A malformed file counts as no setup: the backend then declines with the setup instructions
 * rather than failing every command with a parse error. A file from before this backend grew
 * its full-access accounts also reads as no setup, so the Sandbox card asks for a re-run
 * rather than the launcher failing on a missing account.
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

/**
 * The passwords this server signs in to machines with: one per ssh alias, for a machine whose
 * host was set to password sign-in on the Machines page. A stored password IS that setting —
 * there is no other record of it — so a machine without one signs in with keys, exactly as before
 * passwords existed.
 *
 * WHERE. `<root>/machines/ssh-passwords/<alias as hex>`: one file per alias holding the password
 * and nothing else, 0600 in a 0700 directory (secret-file.ts) — the protection the Project config
 * gives the API keys it holds. Hex, so no alias can name a path (`..`, a slash). Never the ssh
 * config (a person's own file, read by every ssh on this computer), never the database, an API
 * answer, a log, a job's log or a command line.
 *
 * THE HELPER. `<root>/machines/ssh-askpass/askpass` (`askpass.cmd` on Windows): what ssh runs to
 * ask for a password (transport/login.ts). It holds no secret — it prints the variable that one
 * ssh child's environment carries — and is written once, in a 0700 directory. It answers only
 * what a password answers: a yes/no question (a host key ssh has not seen) or a key's passphrase
 * is declined, which ssh reads as no, so a password is never typed into a question it does not
 * belong to.
 */
import fs from "node:fs";
import path from "node:path";
import { writeSecretFile } from "../secret-file.js";
import { PASSWORD_ENV } from "./transport/index.js";

/** The longest password kept: far past any real one, short enough to refuse a pasted file. */
const MAX_PASSWORD = 1024;

/** What is wrong with a password as typed, or null: one line of text, not empty. */
export function passwordProblem(password: string): "required" | "invalid" | null {
  if (password === "") return "required";
  if (/[\0\r\n]/.test(password) || password.length > MAX_PASSWORD) return "invalid";
  return null;
}

/** The askpass helper for `platform`: its file name and its text. */
export function askpassScript(platform: NodeJS.Platform): { name: string; text: string } {
  if (platform === "win32") {
    // Delayed expansion prints the value as it is: `%VAR%` would let a `&` or a `|` in the
    // password run as a command. `echo(` prints an empty or `on`/`off` value as itself.
    return {
      name: "askpass.cmd",
      text: [
        "@echo off",
        "setlocal EnableDelayedExpansion",
        "if defined SSH_ASKPASS_PROMPT exit /b 1",
        'set "question=%~1"',
        'if not "!question:yes/no=!"=="!question!" exit /b 1',
        `if not "!question:'yes'=!"=="!question!" exit /b 1`,
        'if not "!question:assphrase=!"=="!question!" exit /b 1',
        `echo(!${PASSWORD_ENV}!`,
        "",
      ].join("\r\n"),
    };
  }
  return {
    name: "askpass",
    text: [
      "#!/bin/sh",
      "# ssh runs this for each thing it would have asked at a terminal; $1 is the question.",
      "# A yes/no question or a key's passphrase is declined (ssh reads that as no); anything",
      "# else is the password, printed from the environment ssh was started with.",
      '[ -n "$SSH_ASKPASS_PROMPT" ] && exit 1',
      'case "$1" in',
      `  *yes/no*|*"'yes'"*|*assphrase*) exit 1 ;;`,
      "esac",
      `printf '%s\\n' "$${PASSWORD_ENV}"`,
      "",
    ].join("\n"),
  };
}

/** A directory only this account may enter, made so even when it was already there. */
function privateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdir's mode is masked by the umask and leaves an existing directory as it was.
  if (process.platform !== "win32") fs.chmodSync(dir, 0o700);
}

export class SshPasswords {
  readonly #dir: string;
  readonly #helperDir: string;
  readonly #platform: NodeJS.Platform;
  /** The helper's path once it is known to be on disk as this build writes it. */
  #helper: string | null = null;

  /** `machinesDir` is `<root>/machines`. */
  constructor(machinesDir: string, platform: NodeJS.Platform = process.platform) {
    this.#dir = path.join(machinesDir, "ssh-passwords");
    this.#helperDir = path.join(machinesDir, "ssh-askpass");
    this.#platform = platform;
  }

  #file(alias: string): string {
    return path.join(this.#dir, Buffer.from(alias, "utf8").toString("hex"));
  }

  /** Whether a password is stored for `alias` — whether that machine signs in with one. */
  has(alias: string): boolean {
    return fs.existsSync(this.#file(alias));
  }

  /** Every alias a password is stored for, read in one listing. */
  aliases(): Set<string> {
    try {
      return new Set(
        fs
          .readdirSync(this.#dir)
          .filter((name) => /^(?:[0-9a-f]{2})+$/.test(name))
          .map((name) => Buffer.from(name, "hex").toString("utf8")),
      );
    } catch {
      return new Set();
    }
  }

  /** The stored password, or null. */
  read(alias: string): string | null {
    try {
      const text = fs.readFileSync(this.#file(alias), "utf8");
      return text === "" ? null : text;
    } catch {
      return null;
    }
  }

  /** Stores `password` for `alias`, replacing any. The caller checked it (passwordProblem). */
  save(alias: string, password: string): void {
    privateDir(this.#dir);
    writeSecretFile(this.#file(alias), password);
  }

  /** Deletes the password stored for `alias`; true when there was one. */
  remove(alias: string): boolean {
    const file = this.#file(alias);
    if (!fs.existsSync(file)) return false;
    fs.rmSync(file, { force: true });
    return true;
  }

  /** The askpass helper's path, written the first time it is asked for (or when it differs). */
  askpass(): string {
    if (this.#helper !== null) return this.#helper;
    const { name, text } = askpassScript(this.#platform);
    const file = path.join(this.#helperDir, name);
    let current: string | null = null;
    try {
      current = fs.readFileSync(file, "utf8");
    } catch {
      current = null;
    }
    privateDir(this.#helperDir);
    if (current !== text) {
      // Beside it, then renamed over it: ssh may be running the old one at this moment.
      const staged = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(staged, text, { mode: 0o700 });
      fs.renameSync(staged, file);
    }
    if (this.#platform !== "win32") fs.chmodSync(file, 0o700);
    this.#helper = file;
    return file;
  }
}

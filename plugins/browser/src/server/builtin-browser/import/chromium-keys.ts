/**
 * The keys a Chromium-family browser encrypts its cookie values under, per platform:
 *
 * - macOS: the password of the login Keychain item `<Browser> Safe Storage`, read with
 *   `security find-generic-password -w -s …` (macOS asks the user to allow it), through
 *   PBKDF2 with 1003 iterations.
 * - Linux: `v10` values use the fixed password "peanuts"; `v11` values use a password kept in
 *   the desktop keyring, read with `secret-tool lookup application …`. One iteration. The empty
 *   password is the last candidate for both: Chromium falls back to it when the keyring
 *   answers with nothing.
 * - Windows: `Local State`'s `os_crypt.encrypted_key` is "DPAPI" + a DPAPI blob, which
 *   PowerShell's ProtectedData.Unprotect unwraps in the user's scope into the AES-256-GCM key.
 *   The blob goes to PowerShell on stdin, as base64, never on its command line.
 *
 * Nothing here logs or returns a password; only the derived keys leave, to the decryptor.
 */
import fs from "node:fs";
import path from "node:path";
import type { ChromiumBrowser } from "./browsers.js";
import { deriveCbcKey } from "./chromium-decrypt.js";
import type { ImportEnv } from "./index.js";

/** What could not be read when a platform key is missing: the Keychain, the keyring, or DPAPI. */
export type KeyFailure = "keychain" | "keyring" | "dpapi";

export interface CookieKeys {
  mode: "cbc" | "gcm";
  /** Candidate keys, most likely first; empty when none could be obtained. */
  keys: Buffer[];
  failure?: KeyFailure;
}

const MAC_ITERATIONS = 1003;
const LINUX_ITERATIONS = 1;

const UNPROTECT =
  "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Security; " +
  "$blob = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); " +
  "[Console]::Out.Write([Convert]::ToBase64String(" +
  "[System.Security.Cryptography.ProtectedData]::Unprotect($blob, $null, 'CurrentUser')))";

/**
 * The keys for one import, fetched on first use of each version tag and then remembered, so a
 * store asks the Keychain, the keyring or DPAPI at most once — and not at all for a tag none of
 * the requested cookies carries. Windows encrypts both tags under the one DPAPI-wrapped key.
 */
export function cookieKeySource(
  browser: ChromiumBrowser,
  root: string,
  env: ImportEnv,
): (cipher: "v10" | "v11") => Promise<CookieKeys> {
  const loaded = new Map<string, Promise<CookieKeys>>();
  return (cipher) => {
    const slot = env.platform === "win32" ? "dpapi" : cipher;
    let keys = loaded.get(slot);
    if (keys === undefined) {
      keys = loadCookieKeys(cipher, browser, root, env);
      loaded.set(slot, keys);
    }
    return keys;
  };
}

/** The keys for values tagged `cipher`, read from `root` (the user-data directory) and the system. */
async function loadCookieKeys(
  cipher: "v10" | "v11",
  browser: ChromiumBrowser,
  root: string,
  env: ImportEnv,
): Promise<CookieKeys> {
  if (env.platform === "win32") {
    const key = await dpapiKey(root, env);
    return key === null
      ? { mode: "gcm", keys: [], failure: "dpapi" }
      : { mode: "gcm", keys: [key] };
  }
  if (env.platform === "darwin") {
    // macOS only ever writes v10.
    if (cipher !== "v10") return { mode: "cbc", keys: [] };
    const password = await helperOutput(env, "security", [
      "find-generic-password",
      "-w",
      "-s",
      browser.keychainService,
    ]);
    return password === null
      ? { mode: "cbc", keys: [], failure: "keychain" }
      : { mode: "cbc", keys: [deriveCbcKey(password, MAC_ITERATIONS)] };
  }
  const empty = deriveCbcKey("", LINUX_ITERATIONS);
  if (cipher === "v10") {
    return { mode: "cbc", keys: [deriveCbcKey("peanuts", LINUX_ITERATIONS), empty] };
  }
  const keys: Buffer[] = [];
  for (const application of browser.keyringApplications) {
    const password = await helperOutput(env, "secret-tool", ["lookup", "application", application]);
    if (password !== null) keys.push(deriveCbcKey(password, LINUX_ITERATIONS));
  }
  return keys.length > 0
    ? { mode: "cbc", keys: [...keys, empty] }
    : { mode: "cbc", keys: [empty], failure: "keyring" };
}

async function dpapiKey(root: string, env: ImportEnv): Promise<Buffer | null> {
  let encoded: unknown;
  try {
    const state = JSON.parse(fs.readFileSync(path.join(root, "Local State"), "utf8")) as {
      os_crypt?: { encrypted_key?: unknown };
    };
    encoded = state.os_crypt?.encrypted_key;
  } catch {
    return null;
  }
  if (typeof encoded !== "string") return null;
  const wrapped = Buffer.from(encoded, "base64");
  if (wrapped.subarray(0, 5).toString("latin1") !== "DPAPI") return null;
  const out = await helperOutput(
    env,
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", UNPROTECT],
    wrapped.subarray(5).toString("base64"),
  );
  if (out === null) return null;
  const key = Buffer.from(out.trim(), "base64");
  return key.length === 32 ? key : null;
}

/** A helper's stdout without its trailing newline; null when it failed or is not installed. */
async function helperOutput(
  env: ImportEnv,
  file: string,
  args: string[],
  input?: string,
): Promise<string | null> {
  try {
    return (await env.exec(file, args, input)).replace(/\r?\n$/, "");
  } catch {
    return null;
  }
}

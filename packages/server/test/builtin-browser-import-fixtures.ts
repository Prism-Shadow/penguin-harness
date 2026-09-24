/**
 * Synthetic system browsers for the import tests: a scratch home directory, Chromium and
 * Firefox stores written with node:sqlite, cookie values encrypted with known keys, and an
 * ImportEnv whose `exec` stands in for `security` / `secret-tool` / `powershell` and records
 * every call. The encryption here is written independently of the importer's decryption, from
 * Chromium's scheme, so a test proves the two agree rather than that the code matches itself.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ImportEnv } from "../src/builtin-browser/import/index.js";

const sqlite = process.getBuiltinModule("node:sqlite");

/** Seconds between 1601-01-01 (Chromium's epoch) and 1970-01-01. */
const EPOCH_DELTA = 11644473600n;

/** A Chromium timestamp (microseconds since 1601) for unix seconds. */
export function chromeTime(unixSeconds: number): bigint {
  return (BigInt(unixSeconds) + EPOCH_DELTA) * 1_000_000n;
}

export const nowSeconds = (): number => Math.floor(Date.now() / 1000);
export const DAY = 86_400;

export interface HelperCall {
  file: string;
  args: string[];
  input?: string;
}

/** A scratch machine: its home, temp directory, environment and key helpers. */
export class FakeMachine {
  readonly root: string;
  readonly home: string;
  readonly tmp: string;
  readonly calls: HelperCall[] = [];
  /** Helpers by executable name; a missing one behaves as not installed. */
  readonly helpers = new Map<string, (args: string[], input?: string) => string>();
  readonly vars: Record<string, string | undefined> = {};

  constructor(readonly platform: NodeJS.Platform) {
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-import-test-"));
    this.home = path.join(this.root, "home");
    this.tmp = path.join(this.root, "tmp");
    fs.mkdirSync(this.home, { recursive: true });
    fs.mkdirSync(this.tmp, { recursive: true });
    if (platform === "win32") {
      this.vars.LOCALAPPDATA = path.join(this.home, "AppData", "Local");
      this.vars.APPDATA = path.join(this.home, "AppData", "Roaming");
    }
  }

  env(): ImportEnv {
    return {
      platform: this.platform,
      homedir: this.home,
      env: this.vars,
      tmpdir: this.tmp,
      exec: async (file, args, input) => {
        this.calls.push({ file, args, ...(input !== undefined ? { input } : {}) });
        const helper = this.helpers.get(file);
        if (helper === undefined) throw new Error(`${file}: command not found`);
        return helper(args, input);
      },
    };
  }

  /** A path under the home directory. */
  path(...segments: string[]): string {
    return path.join(this.home, ...segments);
  }

  cleanup(): void {
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}

export function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

export function writeLocalState(
  userDataDir: string,
  state: { names?: Record<string, string>; encryptedKey?: string },
): void {
  writeFile(
    path.join(userDataDir, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: Object.fromEntries(
          Object.entries(state.names ?? {}).map(([dir, name]) => [dir, { name }]),
        ),
      },
      ...(state.encryptedKey !== undefined
        ? { os_crypt: { encrypted_key: state.encryptedKey } }
        : {}),
    }),
  );
}

// ---------------------------------------------------------------------------
// Keys and encryption (Chromium's scheme, written from its description)
// ---------------------------------------------------------------------------

export function cbcKey(password: string, iterations: number): Buffer {
  return crypto.pbkdf2Sync(password, "saltysalt", iterations, 16, "sha1");
}

/** SHA-256(host) + value: the plaintext layout from store version 24. */
function plaintextOf(value: string, digestHost: string | undefined): Buffer {
  const body = Buffer.from(value, "utf8");
  if (digestHost === undefined) return body;
  return Buffer.concat([crypto.createHash("sha256").update(digestHost).digest(), body]);
}

/** macOS / Linux: tag + AES-128-CBC (IV of 16 spaces, PKCS7). */
export function encryptCbc(
  tag: "v10" | "v11",
  value: string,
  key: Buffer,
  digestHost?: string,
): Buffer {
  const cipher = crypto.createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  const body = Buffer.concat([cipher.update(plaintextOf(value, digestHost)), cipher.final()]);
  return Buffer.concat([Buffer.from(tag), body]);
}

/** Windows: tag + 12-byte nonce + AES-256-GCM ciphertext + 16-byte tag. */
export function encryptGcm(
  tag: "v10" | "v11" | "v20",
  value: string,
  key: Buffer,
  digestHost?: string,
): Buffer {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const body = Buffer.concat([cipher.update(plaintextOf(value, digestHost)), cipher.final()]);
  return Buffer.concat([Buffer.from(tag), nonce, body, cipher.getAuthTag()]);
}

/** A stand-in for DPAPI: XOR with a constant, so "unprotecting" is the same operation. */
export function fakeDpapi(data: Buffer): Buffer {
  return Buffer.from(data.map((byte) => byte ^ 0x5a));
}

/** `Local State`'s os_crypt.encrypted_key for an AES key under the fake DPAPI. */
export function wrappedKey(key: Buffer): string {
  return Buffer.concat([Buffer.from("DPAPI"), fakeDpapi(key)]).toString("base64");
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export interface ChromiumCookieFixture {
  host: string;
  name: string;
  value?: string;
  encrypted?: Buffer;
  path?: string;
  /** Microseconds since 1601; 0n = a session cookie. */
  expiresUtc?: bigint;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: number;
  /** A partitioned (CHIPS) cookie's top-level site; needs the store's `partitioned` column. */
  topFrameSiteKey?: string;
}

/**
 * A Chromium `Cookies` store. `legacy` writes the pre-2019 columns (secure / httponly, no
 * samesite); `version` is `meta.version` (omitted: no meta table at all); `partitioned` adds
 * the `top_frame_site_key` column of stores since Chrome 108.
 */
export function writeChromiumCookies(
  file: string,
  cookies: ChromiumCookieFixture[],
  opts: { version?: number; legacy?: boolean; partitioned?: boolean } = {},
): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new sqlite.DatabaseSync(file);
  const secure = opts.legacy ? "secure" : "is_secure";
  const httpOnly = opts.legacy ? "httponly" : "is_httponly";
  db.exec(`CREATE TABLE cookies (
    creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL, name TEXT NOT NULL,
    value TEXT NOT NULL, encrypted_value BLOB NOT NULL DEFAULT '', path TEXT NOT NULL,
    expires_utc INTEGER NOT NULL, ${secure} INTEGER NOT NULL, ${httpOnly} INTEGER NOT NULL,
    last_access_utc INTEGER NOT NULL, has_expires INTEGER NOT NULL DEFAULT 1,
    is_persistent INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 1
    ${opts.legacy ? "" : ", samesite INTEGER NOT NULL DEFAULT -1"}
    ${opts.partitioned ? ", top_frame_site_key TEXT NOT NULL DEFAULT ''" : ""})`);
  if (opts.version !== undefined) {
    db.exec("CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR)");
    db.prepare("INSERT INTO meta (key, value) VALUES ('version', ?)").run(String(opts.version));
  }
  const insert = db.prepare(
    `INSERT INTO cookies (creation_utc, host_key, name, value, encrypted_value, path, expires_utc,
       ${secure}, ${httpOnly}, last_access_utc${opts.legacy ? "" : ", samesite"})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?${opts.legacy ? "" : ", ?"})`,
  );
  const created = chromeTime(nowSeconds() - DAY);
  for (const c of cookies) {
    insert.run(
      created,
      c.host,
      c.name,
      c.value ?? "",
      c.encrypted ?? new Uint8Array(0),
      c.path ?? "/",
      c.expiresUtc ?? chromeTime(nowSeconds() + 30 * DAY),
      c.secure === false ? 0 : 1,
      c.httpOnly ? 1 : 0,
      created,
      ...(opts.legacy ? [] : [c.sameSite ?? -1]),
    );
    if (c.topFrameSiteKey !== undefined) {
      db.prepare("UPDATE cookies SET top_frame_site_key = ? WHERE host_key = ? AND name = ?").run(
        c.topFrameSiteKey,
        c.host,
        c.name,
      );
    }
  }
  db.close();
}

export interface ChromiumHistoryFixture {
  url: string;
  title?: string;
  visits?: number;
  /** Unix seconds. */
  visitedAt: number;
  hidden?: boolean;
}

export function writeChromiumHistory(file: string, rows: ChromiumHistoryFixture[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new sqlite.DatabaseSync(file);
  db.exec(`CREATE TABLE urls (id INTEGER PRIMARY KEY AUTOINCREMENT, url LONGVARCHAR,
    title LONGVARCHAR, visit_count INTEGER DEFAULT 0 NOT NULL,
    typed_count INTEGER DEFAULT 0 NOT NULL, last_visit_time INTEGER NOT NULL,
    hidden INTEGER DEFAULT 0 NOT NULL)`);
  const insert = db.prepare(
    "INSERT INTO urls (url, title, visit_count, last_visit_time, hidden) VALUES (?, ?, ?, ?, ?)",
  );
  db.exec("BEGIN");
  for (const row of rows) {
    insert.run(
      row.url,
      row.title ?? "",
      row.visits ?? 1,
      chromeTime(row.visitedAt),
      row.hidden ? 1 : 0,
    );
  }
  db.exec("COMMIT");
  db.close();
}

export interface FirefoxCookieFixture {
  host: string;
  name: string;
  value: string;
  path?: string;
  /** Written as-is: seconds in older builds, milliseconds in newer ones. */
  expiry: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: number;
  originAttributes?: string;
}

export function writeFirefoxCookies(file: string, cookies: FirefoxCookieFixture[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new sqlite.DatabaseSync(file);
  db.exec(`CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY, originAttributes TEXT NOT NULL
    DEFAULT '', name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER, lastAccessed INTEGER,
    creationTime INTEGER, isSecure INTEGER, isHttpOnly INTEGER, inBrowserElement INTEGER DEFAULT 0,
    sameSite INTEGER DEFAULT 0, rawSameSite INTEGER DEFAULT 0, schemeMap INTEGER DEFAULT 0)`);
  const insert = db.prepare(
    `INSERT INTO moz_cookies (originAttributes, name, value, host, path, expiry, isSecure,
       isHttpOnly, sameSite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const c of cookies) {
    insert.run(
      c.originAttributes ?? "",
      c.name,
      c.value,
      c.host,
      c.path ?? "/",
      c.expiry,
      c.secure === false ? 0 : 1,
      c.httpOnly ? 1 : 0,
      c.sameSite ?? 0,
    );
  }
  db.close();
}

export interface FirefoxPlaceFixture {
  url: string;
  title?: string | null;
  visits?: number;
  /** Unix seconds; null = never visited (a bookmark only). */
  visitedAt: number | null;
  hidden?: boolean;
}

export function writeFirefoxPlaces(file: string, places: FirefoxPlaceFixture[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new sqlite.DatabaseSync(file);
  db.exec(`CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR,
    rev_host LONGVARCHAR, visit_count INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0 NOT NULL,
    typed INTEGER DEFAULT 0 NOT NULL, frecency INTEGER DEFAULT -1 NOT NULL,
    last_visit_date INTEGER)`);
  const insert = db.prepare(
    "INSERT INTO moz_places (url, title, visit_count, hidden, last_visit_date) VALUES (?, ?, ?, ?, ?)",
  );
  for (const p of places) {
    insert.run(
      p.url,
      p.title === undefined ? "" : p.title,
      p.visits ?? 1,
      p.hidden ? 1 : 0,
      p.visitedAt === null ? null : p.visitedAt * 1_000_000,
    );
  }
  db.close();
}

/** A `profiles.ini` listing profiles, the first one being the install's default. */
export function writeProfilesIni(
  root: string,
  profiles: Array<{ name: string; path: string; relative?: boolean }>,
): void {
  const lines = [
    "[Install4F96D1932A9F858E]",
    `Default=${profiles[0]?.path ?? ""}`,
    "Locked=1",
    "",
    ...profiles.flatMap((p, i) => [
      `[Profile${i}]`,
      `Name=${p.name}`,
      `IsRelative=${p.relative === false ? 0 : 1}`,
      `Path=${p.path}`,
      "",
    ]),
    "[General]",
    "StartWithLastProfile=1",
    "Version=2",
  ];
  writeFile(path.join(root, "profiles.ini"), `${lines.join("\n")}\n`);
}

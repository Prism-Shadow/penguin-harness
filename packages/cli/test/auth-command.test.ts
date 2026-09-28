/**
 * `penguin auth` and `penguin server reset-admin-password`, driven through `cli()` in-process:
 * login (--server + --password against a node:http stand-in: accepted, refused, no cookie,
 * unreachable, no server on the root, empty password), status (none / no expiry / live /
 * expired), logout (revoked / refused / unreachable / not signed in), token (the --ttl-seconds
 * guard, no web.db, a web.db that is not a Penguin database, PENGUIN_WEB_DB honored), and the
 * reset's refusal while a live server owns the root (no web.db created as a side effect).
 *
 * The success branch of `auth token` is driven with `mintApiToken` stubbed: seeding a real
 * web.db needs the server's openDatabase/UsersRepo, which are neither exported nor emitted as
 * separate dist files. The mock passes through to the real function unless a test queues a
 * result, so the failure cases above still run the real minting code; the minting itself is
 * pinned by the server's own auth-token test. What is pinned here is the command's wiring:
 * the arguments it mints with, what it prints, and when it writes the session file.
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { mintApiToken } from "@prismshadow/penguin-server/auth-token";
import type { MintTokenResult } from "@prismshadow/penguin-server/auth-token";
import { acquireServerLock } from "@prismshadow/penguin-server/lock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSession, sessionFile, writeSession } from "../src/auth-session.js";
import { TOKEN_MARK } from "../src/commands/auth.js";
import { getMessages } from "../src/i18n.js";
import { cli } from "../src/index.js";

vi.mock("@prismshadow/penguin-server/auth-token", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prismshadow/penguin-server/auth-token")>();
  return { ...actual, mintApiToken: vi.fn(actual.mintApiToken) };
});

const t = getMessages("en");

/** Every test starts without these and gets back what was there. */
const ENV_KEYS = ["PENGUIN_LANG", "PENGUIN_PASSWORD", "PENGUIN_HOME", "PENGUIN_WEB_DB"];
const saved = new Map<string, string | undefined>();

let root: string;
let stdout: string[];
let stderr: string[];
let outSpy: { mockRestore(): void };
let errSpy: { mockRestore(): void };
const closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  root = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-cli-auth-command-"));
  stdout = [];
  stderr = [];
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});
afterEach(async () => {
  outSpy.mockRestore();
  errSpy.mockRestore();
  for (const close of closers.splice(0)) await close();
  fs.rmSync(root, { recursive: true, force: true });
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const out = () => stdout.join("");
const err = () => stderr.join("");

interface Seen {
  method?: string;
  path?: string;
  host?: string;
  cookie?: string;
  body?: string;
}

/** A loopback HTTP server answering every request with `answer`; records the last request. */
async function standIn(
  answer: (res: http.ServerResponse) => void,
): Promise<{ url: string; port: number; seen: Seen }> {
  const seen: Seen = {};
  const server = http.createServer((req, res) => {
    seen.method = req.method;
    seen.path = req.url;
    seen.host = req.headers.host;
    seen.cookie = req.headers.cookie;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.body = Buffer.concat(chunks).toString("utf8");
      answer(res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://localhost:${port}`, port, seen };
}

/** A loopback port nothing listens on (bound, then released). */
async function deadPort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** A port that accepts TCP, recorded in `<root>/server.lock` with this (live) pid. */
async function liveLock(on: string): Promise<number> {
  const listener = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise<void>((resolve) => listener.close(() => resolve())));
  const port = (listener.address() as AddressInfo).port;
  acquireServerLock(on, { pid: process.pid, port, startedAt: new Date().toISOString() });
  return port;
}

describe("penguin auth login --server --password", () => {
  it("stores the session the server's Set-Cookie carries, reports on stderr, prints nothing", async () => {
    const target = await standIn((res) => {
      res.setHeader("set-cookie", "penguin_session=tok-123; Path=/; HttpOnly");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ user: { userId: "alice" } }));
    });
    const code = await cli([
      "auth",
      "login",
      "--server",
      target.url,
      "--user-id",
      "alice",
      "--password",
      "pw-1",
      "--root",
      root,
    ]);
    expect(code).toBe(0);
    expect(target.seen.method).toBe("POST");
    expect(target.seen.path).toBe("/api/auth/login");
    expect(target.seen.host).toBe(`localhost:${target.port}`);
    expect(JSON.parse(target.seen.body!)).toEqual({ userId: "alice", password: "pw-1" });
    expect(readSession(root)).toEqual({ server: target.url, userId: "alice", token: "tok-123" });
    expect(err()).toBe(t.auth.loggedIn("alice", target.url, sessionFile(root)) + "\n");
    // The token reaches stdout only with --print.
    expect(out()).toBe("");
  });

  it("--print writes the token, and only the token, to stdout; the account defaults to admin", async () => {
    const target = await standIn((res) => {
      res.setHeader("set-cookie", "penguin_session=tok-print; Path=/");
      res.writeHead(200);
      res.end("{}");
    });
    const code = await cli([
      "auth",
      "login",
      "--server",
      target.url,
      "--password",
      "pw",
      "--print",
      "--root",
      root,
    ]);
    expect(code).toBe(0);
    expect(JSON.parse(target.seen.body!)).toEqual({ userId: "admin", password: "pw" });
    expect(out()).toBe("tok-print\n");
    expect(readSession(root)?.userId).toBe("admin");
  });

  it("takes the password from PENGUIN_PASSWORD without prompting", async () => {
    process.env.PENGUIN_PASSWORD = "from-env";
    const target = await standIn((res) => {
      res.setHeader("set-cookie", "penguin_session=tok-env; Path=/");
      res.writeHead(200);
      res.end("{}");
    });
    const code = await cli(["auth", "login", "--server", target.url, "--root", root]);
    expect(code).toBe(0);
    expect(JSON.parse(target.seen.body!)).toEqual({ userId: "admin", password: "from-env" });
    expect(readSession(root)?.token).toBe("tok-env");
  });

  it("a refusal quotes the API's error message, exits 1 and stores nothing", async () => {
    const target = await standIn((res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "wrong password" } }));
    });
    const code = await cli([
      "auth",
      "login",
      "--server",
      target.url,
      "--password",
      "nope",
      "--root",
      root,
    ]);
    expect(code).toBe(1);
    expect(err()).toBe(t.auth.refused(401, "wrong password") + "\n");
    expect(fs.existsSync(sessionFile(root))).toBe(false);
  });

  it("a 200 without the session cookie is a failure, not a login", async () => {
    const target = await standIn((res) => {
      res.setHeader("set-cookie", "other=1; Path=/");
      res.writeHead(200);
      res.end("{}");
    });
    const code = await cli([
      "auth",
      "login",
      "--server",
      target.url,
      "--password",
      "pw",
      "--root",
      root,
    ]);
    expect(code).toBe(1);
    expect(err()).toBe(t.auth.noCookie + "\n");
    expect(fs.existsSync(sessionFile(root))).toBe(false);
  });

  it("an unreachable server is reported with its URL and exits 1", async () => {
    const url = `http://localhost:${await deadPort()}`;
    const code = await cli(["auth", "login", "--server", url, "--password", "pw", "--root", root]);
    expect(code).toBe(1);
    expect(err().startsWith(`Could not reach ${url}: `)).toBe(true);
    expect(fs.existsSync(sessionFile(root))).toBe(false);
  });

  it("without --server, a stale lock is not a target: no server, exit 1, nothing asked", async () => {
    // Alive pid, dead port — a crashed server's leftover must not receive a password.
    acquireServerLock(root, { pid: process.pid, port: await deadPort(), startedAt: "" });
    const code = await cli(["auth", "login", "--password", "pw", "--root", root]);
    expect(code).toBe(1);
    expect(err()).toBe(t.auth.noServer(root) + "\n");
    expect(fs.existsSync(sessionFile(root))).toBe(false);
  });

  it("an empty --password is refused before any request", async () => {
    const target = await standIn((res) => {
      res.writeHead(500);
      res.end();
    });
    const code = await cli([
      "auth",
      "login",
      "--server",
      target.url,
      "--password",
      "",
      "--root",
      root,
    ]);
    expect(code).toBe(1);
    expect(err()).toBe(t.auth.emptyPassword + "\n");
    expect(target.seen.method).toBeUndefined();
  });
});

describe("penguin auth status", () => {
  it("with no session file says so and exits 0", async () => {
    const code = await cli(["auth", "status", "--root", root]);
    expect(code).toBe(0);
    expect(out()).toBe(t.auth.notLoggedIn(sessionFile(root)) + "\n");
  });

  it("a session without an expiry prints the one status line", async () => {
    writeSession(root, { server: "http://localhost:1", userId: "alice", token: "t" });
    const code = await cli(["auth", "status", "--root", root]);
    expect(code).toBe(0);
    expect(out()).toBe(t.auth.statusLine("alice", "http://localhost:1") + "\n");
  });

  it("a future expiry is shown as the expiry", async () => {
    const when = new Date(Date.now() + 3_600_000).toISOString();
    writeSession(root, {
      server: "http://localhost:1",
      userId: "admin",
      token: "t",
      expiresAt: when,
    });
    const code = await cli(["auth", "status", "--root", root]);
    expect(code).toBe(0);
    expect(out()).toBe(
      t.auth.statusLine("admin", "http://localhost:1") + "\n" + t.auth.expires(when) + "\n",
    );
  });

  it("a past expiry is shown as expired, still exit 0", async () => {
    const when = "2020-01-01T00:00:00.000Z";
    writeSession(root, {
      server: "http://localhost:1",
      userId: "admin",
      token: "t",
      expiresAt: when,
    });
    const code = await cli(["auth", "status", "--root", root]);
    expect(code).toBe(0);
    expect(out()).toBe(
      t.auth.statusLine("admin", "http://localhost:1") + "\n" + t.auth.expired(when) + "\n",
    );
  });
});

describe("penguin auth logout", () => {
  it("with no session says not signed in and exits 0", async () => {
    const code = await cli(["auth", "logout", "--root", root]);
    expect(code).toBe(0);
    expect(out()).toBe(t.auth.notLoggedIn(sessionFile(root)) + "\n");
  });

  it("revokes on the server with the stored cookie, then forgets the session", async () => {
    const target = await standIn((res) => {
      res.writeHead(204);
      res.end();
    });
    writeSession(root, { server: target.url, userId: "admin", token: "tok-out" });
    const code = await cli(["auth", "logout", "--root", root]);
    expect(code).toBe(0);
    expect(target.seen.method).toBe("POST");
    expect(target.seen.path).toBe("/api/auth/logout");
    expect(target.seen.host).toBe(`localhost:${target.port}`);
    expect(target.seen.cookie).toBe("penguin_session=tok-out");
    expect(out()).toBe(t.auth.loggedOut(target.url) + "\n");
    expect(fs.existsSync(sessionFile(root))).toBe(false);
  });

  it("a non-2xx answer still clears locally and says the server may still honor it", async () => {
    const target = await standIn((res) => {
      res.writeHead(401);
      res.end();
    });
    writeSession(root, { server: target.url, userId: "admin", token: "tok" });
    const code = await cli(["auth", "logout", "--root", root]);
    expect(code).toBe(0);
    expect(out()).toBe(t.auth.loggedOutLocally(target.url) + "\n");
    expect(fs.existsSync(sessionFile(root))).toBe(false);
  });

  it("an unreachable server does not block the local clear", async () => {
    const url = `http://localhost:${await deadPort()}`;
    writeSession(root, { server: url, userId: "admin", token: "tok" });
    const code = await cli(["auth", "logout", "--root", root]);
    expect(code).toBe(0);
    expect(out()).toBe(t.auth.loggedOutLocally(url) + "\n");
    expect(fs.existsSync(sessionFile(root))).toBe(false);
  });
});

describe("penguin auth token", () => {
  it.each(["0", "-5", "1.5", "abc", "3600abc"])(
    "--ttl-seconds=%s is rejected before the root is touched",
    async (ttl) => {
      const code = await cli(["auth", "token", `--ttl-seconds=${ttl}`, "--root", root]);
      expect(code).toBe(1);
      expect(err()).toBe(t.authToken.badTtl + "\n");
      expect(out()).toBe("");
    },
  );

  it("a root without web.db has nothing to mint for; nothing is created", async () => {
    const code = await cli(["auth", "token", "--mark", "--root", root]);
    expect(code).toBe(1);
    expect(err()).toBe(t.authToken.noServer(root) + "\n");
    expect(out()).toBe("");
    expect(fs.existsSync(path.join(root, "web.db"))).toBe(false);
    expect(fs.existsSync(sessionFile(root))).toBe(false);
  });

  it("a web.db that is not a Penguin database fails without being migrated", async () => {
    const dbPath = path.join(root, "web.db");
    fs.writeFileSync(dbPath, "");
    const code = await cli(["auth", "token", "--root", root]);
    expect(code).toBe(1);
    expect(err().startsWith(t.authToken.failed(""))).toBe(true);
    expect(out()).toBe("");
    expect(fs.statSync(dbPath).size).toBe(0);
    expect(fs.existsSync(sessionFile(root))).toBe(false);
  });

  it("PENGUIN_WEB_DB is where it looks, not <root>/web.db", async () => {
    const elsewhere = path.join(root, "elsewhere.db");
    fs.writeFileSync(elsewhere, "");
    process.env.PENGUIN_WEB_DB = elsewhere;
    const code = await cli(["auth", "token", "--root", root]);
    // Not no_server: the file it opened is the one the variable names.
    expect(code).toBe(1);
    expect(err().startsWith(t.authToken.failed(""))).toBe(true);
  });
});

describe("penguin auth token, minted (mintApiToken stubbed)", () => {
  const minted: MintTokenResult = {
    outcome: "minted",
    token: "tok-minted",
    userId: "admin",
    expiresAt: "2026-09-29T00:00:00.000Z",
  };
  const mint = vi.mocked(mintApiToken);
  // mockReset puts back the pass-through and drops a queued result a failed test left behind,
  // so nothing queued here reaches a test outside this block.
  beforeEach(() => {
    mint.mockReset();
    mint.mockReturnValueOnce(minted);
  });
  afterEach(() => mint.mockReset());

  it("prints the token alone on stdout and, with no live server, writes no session", async () => {
    const code = await cli(["auth", "token", "--root", root]);
    expect(code).toBe(0);
    expect(out()).toBe("tok-minted\n");
    expect(err()).toBe("");
    expect(mint).toHaveBeenCalledTimes(1);
    // Defaults are the minting side's: no ttlMs, no dbPath, the admin account.
    expect(mint).toHaveBeenCalledWith(root, { userId: "admin" });
    expect(fs.existsSync(sessionFile(root))).toBe(false);
  });

  it("--mark puts the fixed marker line before the token", async () => {
    const code = await cli(["auth", "token", "--mark", "--root", root]);
    expect(code).toBe(0);
    expect(out()).toBe(`${TOKEN_MARK}\ntok-minted\n`);
  });

  it("--user-id and --ttl-seconds reach the mint as the account and milliseconds", async () => {
    const code = await cli([
      "auth",
      "token",
      "--user-id",
      "alice",
      "--ttl-seconds",
      "90",
      "--root",
      root,
    ]);
    expect(code).toBe(0);
    expect(mint).toHaveBeenCalledWith(root, { userId: "alice", ttlMs: 90_000 });
  });

  it("PENGUIN_WEB_DB is handed over as the database path", async () => {
    const elsewhere = path.join(root, "db", "custom.db");
    process.env.PENGUIN_WEB_DB = elsewhere;
    const code = await cli(["auth", "token", "--root", root]);
    expect(code).toBe(0);
    expect(mint).toHaveBeenCalledWith(root, { userId: "admin", dbPath: elsewhere });
  });

  it("without --root, the root is PENGUIN_HOME", async () => {
    process.env.PENGUIN_HOME = root;
    const code = await cli(["auth", "token"]);
    expect(code).toBe(0);
    expect(mint).toHaveBeenCalledWith(root, { userId: "admin" });
  });

  it("with a live server on the root, writes the session a later logout can use", async () => {
    const port = await liveLock(root);
    const code = await cli(["auth", "token", "--root", root]);
    expect(code).toBe(0);
    expect(out()).toBe("tok-minted\n");
    expect(readSession(root)).toEqual({
      server: `http://localhost:${port}`,
      userId: "admin",
      token: "tok-minted",
      expiresAt: "2026-09-29T00:00:00.000Z",
    });
  });

  it("the session names the account the mint answered with, not the flag", async () => {
    mint.mockReset();
    mint.mockReturnValueOnce({ ...minted, userId: "bob" });
    await liveLock(root);
    const code = await cli(["auth", "token", "--user-id", "alice", "--root", root]);
    expect(code).toBe(0);
    expect(readSession(root)?.userId).toBe("bob");
  });

  it("a stale lock (port no longer answering) is not a server: no session is written", async () => {
    acquireServerLock(root, { pid: process.pid, port: await deadPort(), startedAt: "" });
    const code = await cli(["auth", "token", "--root", root]);
    expect(code).toBe(0);
    expect(out()).toBe("tok-minted\n");
    expect(fs.existsSync(sessionFile(root))).toBe(false);
  });
});

describe("penguin server reset-admin-password", () => {
  it("refuses while a live server owns the root, on stderr, exit 1, creating no web.db", async () => {
    process.env.PENGUIN_HOME = root;
    const port = await liveLock(root);
    const code = await cli(["server", "reset-admin-password"]);
    expect(code).toBe(1);
    expect(err()).toBe(t.resetPassword.serverRunning(`http://localhost:${port}/`) + "\n");
    expect(out()).toBe("");
    expect(fs.existsSync(path.join(root, "web.db"))).toBe(false);
  });

  it("refuses before looking at PENGUIN_WEB_DB, which stays uncreated", async () => {
    process.env.PENGUIN_HOME = root;
    const dbPath = path.join(root, "db", "custom.db");
    process.env.PENGUIN_WEB_DB = dbPath;
    const port = await liveLock(root);
    const code = await cli(["server", "reset-admin-password"]);
    expect(code).toBe(1);
    expect(err()).toBe(t.resetPassword.serverRunning(`http://localhost:${port}/`) + "\n");
    expect(fs.existsSync(dbPath)).toBe(false);
    expect(fs.existsSync(path.dirname(dbPath))).toBe(false);
  });

  it("with no live server and no database, says there is nothing to reset and creates none", async () => {
    process.env.PENGUIN_HOME = root;
    const code = await cli(["server", "reset-admin-password"]);
    expect(code).toBe(1);
    expect(err()).toBe(t.resetPassword.noDatabase(path.join(root, "web.db")) + "\n");
    expect(fs.existsSync(path.join(root, "web.db"))).toBe(false);
  });
});

/**
 * Minting an API session from the data root (auth-token.ts): what `penguin auth token` and the
 * desktop shell run to sign in without a password.
 *
 * A session is a row in web.db, so minting opens the database and inserts one — no running
 * server, no owner token, no loopback. Reading the root already reaches every credential the
 * token could, so the write adds no authority.
 *
 * - Given a root with no web.db, the mint reports no_server.
 * - Given a server's database, the minted row is a session the server then authenticates.
 * - A caller's TTL is clamped to the ordinary session ceiling, so a leaked token cannot live
 *   (and slide) forever.
 * - The session records how it was established: a cli mint reads back as an ordinary password
 *   session, a desktop mint as the shell's own.
 * - An account that does not exist is refused.
 * - A database this OS account cannot open fails cleanly, pointing at `penguin auth login`.
 *
 * And while the server on the root is still starting (mintApiTokenOnceSeeded, what `penguin
 * auth token` runs): its port answers before it has seeded the admin, and a controller asks
 * the moment it answers.
 *
 * - Given a live server that has not created its database yet, the mint waits through the
 *   database appearing and its schema being written, and returns a token once the seed lands.
 * - Given no live server, a root with no account fails at once, as it always has.
 * - Given a live server whose accounts do not include the one asked for, the mint fails at once.
 * - Given a live server that never seeds, the wait gives up at its bound, saying so.
 * - Given a server that exits while the mint waits, the wait ends with the ordinary answer.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { wire } from "@prismshadow/penguin-core/kernel";
import { CLI_TOKEN_MAX_TTL_MS, mintApiToken, mintApiTokenOnceSeeded } from "../src/auth-token.js";
import type { MintTokenResult, SeedWait } from "../src/auth-token.js";
import { SESSION_COOKIE } from "../src/auth/middleware.js";
import { openDatabase, openExistingDatabase } from "../src/db/database.js";
import { UsersRepo } from "../src/db/repos/users.js";
import { acquireServerLock, releaseServerLock } from "../src/lock.js";
import { apiClient, createTestApp, makeTempRoot } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("minting an API session", () => {
  it("reports no_server when the root has no web.db", async () => {
    const root = await makeTempRoot();
    expect(mintApiToken(root, { dbPath: path.join(root, "web.db") })).toEqual({
      outcome: "no_server",
    });
  });

  /**
   * The multi-user case: web.db exists but belongs to another OS account (the one running the
   * server), and this caller cannot open it. That must come back as a failed outcome pointing
   * at `auth login` — not an unhandled throw. chmod-based, so meaningless as root or on
   * Windows.
   */
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "fails cleanly on a database this OS account cannot open",
    async () => {
      const root = await makeTempRoot();
      const dbPath = path.join(root, "web.db");
      const t = await createTestApp({ config: { root, dbPath } });
      await t.cleanup();
      const fs = await import("node:fs");
      fs.chmodSync(dbPath, 0o000);
      try {
        const r = mintApiToken(root, { dbPath });
        expect(r.outcome).toBe("failed");
        if (r.outcome !== "failed") return;
        expect(r.detail).toContain("penguin auth login");
      } finally {
        fs.chmodSync(dbPath, 0o600);
      }
    },
  );
});

describe("minting against a server's database", () => {
  let t: TestApp;
  let root: string;
  let dbPath: string;

  // The app seeds the account on this file, then each case mints against the same file as the
  // CLI would: the app and the mint share one on-disk database, no cross-process hop.
  beforeAll(async () => {
    root = await makeTempRoot();
    dbPath = path.join(root, "web.db");
    t = await createTestApp({ config: { root, dbPath } });
  });
  afterAll(async () => {
    await t.cleanup();
  });

  const minted = (r: MintTokenResult) => {
    expect(r.outcome).toBe("minted");
    if (r.outcome !== "minted") throw new Error(`not minted: ${JSON.stringify(r)}`);
    return r;
  };
  const me = async (token: string) => apiClient(t.app, `${SESSION_COOKIE}=${token}`).get("/api/me");

  it("inserts a session row the server then authenticates", async () => {
    const r = minted(mintApiToken(root, { dbPath, ttlMs: 60_000 }));
    expect(r.userId).toBe("admin");
    expect((await me(r.token)).status).toBe(200);
  });

  /**
   * `--ttl-seconds` only rejects values <= 0, so without the clamp `penguin auth token
   * --ttl-seconds 315360000` writes a ten-year row — and because its span passes the renewal
   * window it would slide forever, turning a leaked cli-session.json into a permanent
   * credential.
   */
  it("clamps a caller's TTL to the session ceiling", () => {
    const now = new Date();
    const r = minted(mintApiToken(root, { dbPath, ttlMs: 10 * 365 * 24 * 60 * 60_000, now }));
    expect(Date.parse(r.expiresAt)).toBe(now.getTime() + CLI_TOKEN_MAX_TTL_MS);
  });

  /**
   * The desktop shell mints with `via: "desktop"` when it signs its own window in against a
   * server it did not spawn, and the session has to read back as that kind — it is what the
   * App reads to leave the current-password field out of a form whose account has a password
   * nobody was ever shown. A `cli` mint keeps reading back as an ordinary password session.
   */
  it("records how the session was established, defaulting to cli", async () => {
    const viaOf = async (token: string) =>
      ((await (await me(token)).json()) as { sessionVia: string }).sessionVia;
    expect(await viaOf(minted(mintApiToken(root, { dbPath })).token)).toBe("password");
    expect(await viaOf(minted(mintApiToken(root, { dbPath, via: "desktop" })).token)).toBe(
      "desktop",
    );
  });

  it("refuses an account that does not exist", () => {
    expect(mintApiToken(root, { dbPath, userId: "ghost" }).outcome).toBe("failed");
  });
});

describe("minting while the server is still starting", () => {
  /**
   * The server's schema step, run once and copied into each case: a fresh web.db written
   * statement by statement costs a second or more of fsyncs on a Windows runner.
   */
  let schemaOnly: string;
  beforeAll(async () => {
    schemaOnly = path.join(await makeTempRoot(), "web.db");
    openDatabase(schemaOnly).close();
  });

  /** Listeners standing in for live servers' ports, closed after each case. */
  const listeners: net.Server[] = [];
  afterEach(async () => {
    await Promise.all(
      listeners.splice(0).map((srv) => new Promise<void>((resolve) => srv.close(() => resolve()))),
    );
  });

  /**
   * A lock the liveness probe accepts, as a server writes it the moment its port binds. Its
   * exit is the server's own: the lock removed, then the port closed (index.ts's shutdown).
   */
  async function liveServerOn(root: string): Promise<{ exit: () => Promise<void> }> {
    const srv = net.createServer();
    const port = await new Promise<number>((resolve) => {
      srv.listen(0, "127.0.0.1", () => resolve((srv.address() as net.AddressInfo).port));
    });
    listeners.push(srv);
    acquireServerLock(root, { pid: process.pid, port, startedAt: new Date().toISOString() });
    return {
      exit: () => {
        releaseServerLock(root);
        return new Promise<void>((resolve) => srv.close(() => resolve()));
      },
    };
  }

  /**
   * A clock that jumps on every sleep, so a wait of twenty seconds costs nothing. `onSleep` is
   * what the starting server gets done meanwhile; `oversleepMs` is a loaded machine's sleep
   * running long. The yield lets the liveness probe's socket events run.
   */
  function jumpingClock(
    opts: { onSleep?: (round: number) => void | Promise<void>; oversleepMs?: number } = {},
  ) {
    let now = 0;
    let rounds = 0;
    const wait: SeedWait = {
      now: () => now,
      sleep: async (ms) => {
        now += ms + (opts.oversleepMs ?? 0);
        await opts.onSleep?.(++rounds);
        await new Promise((resolve) => setImmediate(resolve));
      },
    };
    return { wait, waited: () => now };
  }

  /** The first thing a server creating web.db leaves on disk: the file, with no tables yet. */
  function createBareFile(dbPath: string): void {
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.close();
  }

  /** The server's schema step: tables created, no account in them yet. */
  const createSchema = (dbPath: string) => fs.copyFileSync(schemaOnly, dbPath);

  /** An account row, as the seed (or an admin adding a user) writes it, into a schema in place. */
  function addAccount(dbPath: string, userId: string): void {
    const db = openExistingDatabase(dbPath);
    try {
      wire(UsersRepo, { db: db }).insert({
        userId,
        passwordHash: "not-a-real-hash",
        isAdmin: userId === "admin",
        passwordIsInitial: true,
        displayName: null,
        avatar: null,
        createdAt: new Date().toISOString(),
      });
    } finally {
      db.close();
    }
  }

  it("a mint that arrives before the database exists waits for the seed, then returns a token", async () => {
    const root = await makeTempRoot();
    const dbPath = path.join(root, "web.db");
    await liveServerOn(root);
    const clock = jumpingClock({
      // What a fresh server does after its port binds: the file, then its schema, then the admin.
      onSleep: (round) => {
        if (round === 1) createBareFile(dbPath);
        if (round === 2) createSchema(dbPath);
        if (round === 3) addAccount(dbPath, "admin");
      },
    });
    const r = await mintApiTokenOnceSeeded(root, { dbPath }, clock.wait);
    expect(r).toMatchObject({ outcome: "minted", userId: "admin" });
  });

  it.each([
    ["has no web.db", (_dbPath: string) => {}, { outcome: "no_server" }],
    ["holds no account", createSchema, { outcome: "failed", detail: "no such account: admin" }],
  ])("with no live server, a root that %s fails at once", async (_case, prepare, expected) => {
    const root = await makeTempRoot();
    const dbPath = path.join(root, "web.db");
    prepare(dbPath);
    const clock = jumpingClock();
    expect(await mintApiTokenOnceSeeded(root, { dbPath }, clock.wait)).toEqual(expected);
    expect(clock.waited()).toBe(0);
  });

  it("a live server whose accounts do not include admin has been seeded already: the mint fails at once", async () => {
    const root = await makeTempRoot();
    const dbPath = path.join(root, "web.db");
    createSchema(dbPath);
    addAccount(dbPath, "alice");
    await liveServerOn(root);
    const clock = jumpingClock();
    expect(await mintApiTokenOnceSeeded(root, { dbPath }, clock.wait)).toEqual({
      outcome: "failed",
      detail: "no such account: admin",
    });
    expect(clock.waited()).toBe(0);
  });

  it("a live server that never seeds is waited for only so long, and the failure says it is still starting", async () => {
    const root = await makeTempRoot();
    const dbPath = path.join(root, "web.db");
    createSchema(dbPath);
    await liveServerOn(root);
    // Each sleep runs a few seconds long: the bound is on the clock, not on a count of rounds.
    const clock = jumpingClock({ oversleepMs: 3_000 });
    const r = await mintApiTokenOnceSeeded(root, { dbPath }, clock.wait);
    expect(r.outcome).toBe("failed");
    if (r.outcome !== "failed") return;
    expect(r.detail).toMatch(/not finished starting/);
    expect(r.detail).toContain("no such account: admin");
  });

  it("a server that exits while the mint waits ends the wait with the ordinary answer", async () => {
    const root = await makeTempRoot();
    const dbPath = path.join(root, "web.db");
    createSchema(dbPath);
    const server = await liveServerOn(root);
    const clock = jumpingClock({
      onSleep: async (round) => {
        if (round === 1) await server.exit();
      },
    });
    expect(await mintApiTokenOnceSeeded(root, { dbPath }, clock.wait)).toEqual({
      outcome: "failed",
      detail: "no such account: admin",
    });
  });
});

/**
 * PgDatabaseSync: a node:sqlite DatabaseSync-compatible handle backed by PostgreSQL.
 *
 * WHY A SHIM: the platform's data layer (19 repos, ~190 prepared statements, plus
 * migrations) speaks node:sqlite's SYNCHRONOUS API. Rewriting it to an async PG
 * driver would touch every call site; this shim keeps the sync surface by running
 * the async `pg` driver in a dedicated worker thread and blocking the main thread
 * on Atomics.wait until the reply is queued (the worker posts the result BEFORE it
 * notifies, so receiveMessageOnPort always finds it immediately).
 *
 * SEMANTICS preserved from node:sqlite:
 *  - one handle = one connection: BEGIN/COMMIT/ROLLBACK across separate exec()
 *    calls stay in one transaction (single pg.Client in a single worker)
 *  - prepare(sql).get()/all()/run() with positional (?) or named (:name) params
 *  - run() returns { changes, lastInsertRowid }
 *  - exec() runs a multi-statement script
 *
 * SWITCH: set PENGUIN_DB=pg. Connection via PENGUIN_PG_DSN or the components
 * PENGUIN_PG_HOST/PORT/DB/USER/PASSWORD/SCHEMA (defaults match the tracker
 * instance: 127.0.0.1:15432 tracker/tracker, schema `penguin`).
 */
import { Worker, receiveMessageOnPort, MessageChannel } from "node:worker_threads";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { translateScript, translateStatement, convertPlaceholders } from "./translate.js";

/** The subset of node:sqlite's DatabaseSync the platform actually uses. */
export interface PgDatabaseSyncLike {
  exec(sql: string): void;
  prepare(sql: string): PgStatementSyncLike;
  close(): void;
}

export interface PgStatementSyncLike {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | null };
}

export interface PgConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  schema: string;
}

interface Req {
  id: number;
  sql: string;
  params: unknown[] | null;
  want: "exec" | "rows" | "run";
}

interface Reply {
  id: number;
  result?: { rows?: Record<string, unknown>[]; changes?: number; ok?: boolean };
  error?: string;
}

const QUERY_TIMEOUT_MS = Number(process.env.PENGUIN_PG_QUERY_TIMEOUT_MS || 120000);
const META_TABLE = "_pg_meta";

/**
 * The worker file lives at dist/db/pg/worker.cjs, but where THIS module ends up
 * depends on the bundler: inlined into dist/db/pg/shim-entry.js, or split into a
 * chunk at the dist root. Try both relative resolutions and take the one that
 * exists (the dist-root one wins, which is the production layout).
 */
function resolveWorkerUrl(): URL {
  const candidates = [
    new URL("./db/pg/worker.cjs", import.meta.url),
    new URL("./pg/worker.cjs", import.meta.url),
  ];
  for (const u of candidates) {
    try {
      if (existsSync(fileURLToPath(u))) return u;
    } catch {
      // not a file URL (bundled oddly) — fall through
    }
  }
  return candidates[0];
}

function parseDsn(dsn: string): PgConfig {
  const u = new URL(dsn);
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "tracker",
    user: decodeURIComponent(u.username || "tracker"),
    password: decodeURIComponent(u.password || ""),
    schema: u.searchParams.get("schema") || "penguin",
  };
}

export function pgConfigFromEnv(): PgConfig {
  if (process.env.PENGUIN_PG_DSN) return parseDsn(process.env.PENGUIN_PG_DSN);
  return {
    host: process.env.PENGUIN_PG_HOST || "127.0.0.1",
    port: Number(process.env.PENGUIN_PG_PORT || 15432),
    database: process.env.PENGUIN_PG_DB || "tracker",
    user: process.env.PENGUIN_PG_USER || "tracker",
    password: process.env.PENGUIN_PG_PASSWORD || "tracker2026",
    schema: process.env.PENGUIN_PG_SCHEMA || "penguin",
  };
}

/** A translated statement ready to execute; params follow the $1..$n order. */
class PgStatementSync implements PgStatementSyncLike {
  /**
   * @param namedOrder named parameters in $1..$n order, captured from the ORIGINAL
   * (pre-translation) SQL — the translated SQL no longer contains `:name` tokens.
   */
  constructor(
    private readonly shim: PgDatabaseSync,
    private readonly sql: string,
    private readonly namedOrder: readonly string[] = [],
  ) {}

  private buildParams(params: unknown[]): unknown[] | null {
    if (params.length === 0) return null;
    const first = params[0];
    if (
      params.length === 1 &&
      first !== null &&
      typeof first === "object" &&
      !Array.isArray(first) &&
      !(first instanceof Uint8Array) &&
      !(first instanceof Date)
    ) {
      // Named-parameter object: order by first appearance in the ORIGINAL SQL.
      const obj = first as Record<string, unknown>;
      if (this.namedOrder.length === 0) return [];
      return this.namedOrder.map((n) => {
        if (!(n in obj)) throw new Error(`pg-shim: missing named parameter '${n}'`);
        return obj[n];
      });
    }
    return params as unknown[];
  }

  get(...params: unknown[]): unknown {
    const { rows } = this.shim.call(this.sql, this.buildParams(params), "rows");
    return rows.length > 0 ? rows[0] : undefined;
  }

  all(...params: unknown[]): unknown[] {
    const { rows } = this.shim.call(this.sql, this.buildParams(params), "rows");
    return rows;
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number | null } {
    const { changes } = this.shim.call(this.sql, this.buildParams(params), "run");
    return { changes: changes ?? 0, lastInsertRowid: null };
  }
}

/**
 * Statement whose translation is deferred to first execute: INSERT OR REPLACE
 * needs the table's primary key (a catalog round-trip through the shim's own
 * sync call). The translated SQL is cached for subsequent executes.
 */
class LazyPgStatement implements PgStatementSyncLike {
  private inner: PgStatementSync | null = null;

  constructor(
    private readonly shim: PgDatabaseSync,
    private readonly sql: string,
  ) {}

  private stmt(): PgStatementSync {
    if (!this.inner) {
      // Capture the named-parameter order from the ORIGINAL SQL before translation
      // rewrites `:name` into `$n`.
      const { named } = convertPlaceholders(this.sql);
      const translated = translateStatement(this.sql, { pkOf: (t) => this.shim.pkOf(t) });
      this.inner = new PgStatementSync(this.shim, translated ?? this.sql, named);
    }
    return this.inner;
  }

  get(...params: unknown[]): unknown {
    return this.stmt().get(...params);
  }

  all(...params: unknown[]): unknown[] {
    return this.stmt().all(...params);
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number | null } {
    return this.stmt().run(...params);
  }
}

export class PgDatabaseSync implements PgDatabaseSyncLike {
  private readonly worker: Worker;
  /** Main-side reply port (port1); port2 is transferred to the worker with the first request. */
  private readonly replyPort: MessagePort;
  private readonly workerPort: MessagePort;
  private readonly ctrl: Int32Array;
  private primed = false;
  private nextId = 0;
  private closed = false;
  /** table → primary key columns (catalog, cached). */
  private readonly pkCache = new Map<string, string[] | null>();
  private readonly cfg: PgConfig;

  constructor(cfg?: PgConfig) {
    this.cfg = cfg ?? pgConfigFromEnv();
    // The worker is built as CommonJS (tsup onSuccess → esbuild): pg's dependency
    // graph uses dynamic require() that esbuild's ESM output cannot express.
    this.worker = new Worker(resolveWorkerUrl(), {
      env: { ...process.env, PENGUIN_PG_CFG: JSON.stringify(this.cfg) },
    });
    const { port1, port2 } = new MessageChannel();
    this.replyPort = port1;
    this.workerPort = port2;
    this.ctrl = new Int32Array(new SharedArrayBuffer(8));
    this.worker.on("error", (err) => {
      process.stderr.write(`[pg-shim] worker error: ${String(err)}\n`);
    });
  }

  /** Primary-key columns for INSERT OR REPLACE translation (catalog, cached). */
  pkOf(table: string): string[] | null {
    const cached = this.pkCache.get(table);
    if (cached !== undefined) return cached;
    const { rows } = this.call(
      `SELECT c.column_name AS col
         FROM information_schema.table_constraints t
         JOIN information_schema.key_column_usage c
           ON c.constraint_name = t.constraint_name
          AND c.table_schema = t.table_schema
          AND c.table_name = t.table_name
        WHERE t.constraint_type = 'PRIMARY KEY'
          AND t.table_schema = current_schema()
          AND t.table_name = $1
        ORDER BY c.ordinal_position`,
      [table],
      "rows",
    );
    const pk = rows.map((r) => String(r.col));
    const result = pk.length > 0 ? pk : null;
    this.pkCache.set(table, result);
    return result;
  }

  /** One synchronous round-trip to the worker. */
  private call(
    sql: string,
    params: unknown[] | null,
    want: "exec" | "rows" | "run",
  ): { rows: Record<string, unknown>[]; changes: number } {
    if (this.closed) throw new Error("pg-shim: database is closed");
    const id = ++this.nextId;
    const req: Req = { id, sql, params, want };
    Atomics.store(this.ctrl, 0, 0);
    if (!this.primed) {
      // First request carries the reply port (transferred; neuters the main-side
      // copy) and the shared control block (shared by reference). A MessagePort
      // in a message MUST be listed in the transferList.
      this.worker.postMessage({ req, port: this.workerPort, ctrl: this.ctrl }, [this.workerPort]);
      this.primed = true;
    } else {
      this.worker.postMessage({ req });
    }
    const wait = Atomics.wait(this.ctrl, 0, 0, QUERY_TIMEOUT_MS);
    if (wait === "timed-out") {
      throw new Error(`pg-shim: query timed out after ${QUERY_TIMEOUT_MS}ms: ${sql.slice(0, 160)}`);
    }
    const received = receiveMessageOnPort(this.replyPort);
    if (!received) throw new Error("pg-shim: worker reply missing");
    const reply = received.message as Reply;
    if (reply.error) throw new Error(`pg-shim: ${reply.error} | sql: ${sql.slice(0, 240)}`);
    return { rows: reply.result?.rows ?? [], changes: reply.result?.changes ?? 0 };
  }

  exec(sql: string): void {
    // PRAGMA user_version = N → _pg_meta upsert (PG has no user_version pragma).
    const uvSet = sql.match(/^\s*PRAGMA\s+user_version\s*=\s*(\d+)\s*;?\s*$/i);
    if (uvSet) {
      this.call(
        `INSERT INTO ${META_TABLE} (key, value) VALUES ('user_version', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [uvSet[1]],
        "exec",
      );
      return;
    }
    const script = translateScript(sql, { pkOf: (t) => this.pkOf(t) });
    if (!script.trim()) return;
    this.call(script, null, "exec");
  }

  prepare(sql: string): PgStatementSyncLike {
    // PRAGMA user_version (get) → meta lookup
    if (/^\s*PRAGMA\s+user_version\s*;?\s*$/i.test(sql)) {
      return new PgStatementSync(
        this,
        `SELECT CAST(value AS INTEGER) AS user_version FROM ${META_TABLE} WHERE key = 'user_version'`,
      );
    }
    // PRAGMA table_info(t) → information_schema (ensureColumn + sqlite-copy style callers).
    // The table name is regex-validated and inlined: callers pass no parameters.
    const ti = sql.match(/^\s*PRAGMA\s+table_info\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*;?\s*$/i);
    if (ti) {
      return new PgStatementSync(
        this,
        `SELECT column_name AS name, data_type AS type, is_nullable AS notnull
           FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = '${ti[1]}'
          ORDER BY ordinal_position`,
      );
    }
    // Other PRAGMAs are no-ops under PG.
    if (/^\s*PRAGMA\s+/i.test(sql)) {
      return new PgStatementSync(this, "SELECT 1 AS noop WHERE false");
    }
    return new LazyPgStatement(this, sql);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    void this.worker.terminate();
  }
}

/** Open a PG-backed handle. Same call shape as the sqlite openDatabase. */
export function openPgDatabase(cfg?: PgConfig): PgDatabaseSync {
  return new PgDatabaseSync(cfg);
}

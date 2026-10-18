/**
 * PG connection worker: one dedicated `pg.Client` per PgDatabaseSync instance.
 *
 * Lives in a worker thread so the main thread can keep the platform's
 * SYNCHRONOUS DatabaseSync API: the main thread posts a query and blocks on
 * Atomics.wait; this worker executes asynchronously, posts the result back on
 * the reply port FIRST, then stores the done flag and notifies — so when the
 * main thread wakes, the message is already queued for receiveMessageOnPort.
 *
 * One client per shim instance reproduces node:sqlite's single-connection
 * semantics: transactions (BEGIN/COMMIT/ROLLBACK issued via separate exec
 * calls) stay on the same connection, exactly as the platform expects.
 *
 * Protocol (main → worker), first message only carries {port, ctrl}:
 *   { req: {id, sql, params, want}, port?: MessagePort, ctrl?: Int32Array }
 * Reply (worker → main, on the reply port):
 *   { id, result: {rows?, changes?, ok?} | { id, error } }
 */
import { parentPort } from "node:worker_threads";
import pg from "pg";

const { Client } = pg;

// node-postgres returns int8/numeric as strings by default; the repos do
// arithmetic on counts and sums (Number() in some places, direct + in others).
// Parsing to number here keeps node:sqlite's integer semantics.
pg.types.setTypeParser(20, (v: string | null) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v: string | null) => (v === null ? null : Number(v)));

interface Req {
  id: number;
  sql: string;
  params: unknown[] | null;
  want: "exec" | "rows" | "run";
}

interface Result {
  rows?: Record<string, unknown>[];
  changes?: number;
  ok?: boolean;
}

function log(...args: unknown[]): void {
  if (process.env.PENGUIN_PG_DEBUG === "1") {
    process.stderr.write(`[pg-worker] ${args.join(" ")}\n`);
  }
}

let client: pg.Client | null = null;
let connecting: Promise<pg.Client> | null = null;
let replyPort: { postMessage: (m: unknown) => void } | null = null;
let ctrlRef: Int32Array | null = null;

async function getClient(): Promise<pg.Client> {
  if (client) return client;
  if (!connecting) {
    const cfg = JSON.parse(process.env.PENGUIN_PG_CFG || "{}");
    const c = new Client({
      host: cfg.host || "127.0.0.1",
      port: cfg.port || 5432,
      database: cfg.database || "penguin",
      user: cfg.user || "penguin",
      password: cfg.password || "",
      statement_timeout: Number(process.env.PENGUIN_PG_STATEMENT_TIMEOUT_MS || 120000),
      application_name: "penguin-pg-shim",
    });
    connecting = c
      .connect()
      .then(() => {
        client = c;
        c.on("error", (err) => {
          log("client error:", String(err));
          client = null;
          connecting = null;
        });
        if (cfg.schema) {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cfg.schema)) {
            throw new Error(`pg-shim: invalid schema name '${cfg.schema}'`);
          }
          const schema = cfg.schema;
          // Fresh-deployment bootstrap: sqlite created its file on open; PG must
          // create the schema itself or SET search_path below fails.
          return c
            .query(`CREATE SCHEMA IF NOT EXISTS ${schema}`)
            .then(() => c.query(`SET search_path TO ${schema}`))
            .then(() =>
              // The shim's PRAGMA user_version emulation lives here (migrations stamp it).
              c.query(
                `CREATE TABLE IF NOT EXISTS ${schema}._pg_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
              ),
            )
            .then(() => c);
        }
        return c;
      })
      .catch((err: unknown) => {
        // A failed connect must clear the slot, or every later call re-awaits the
        // same rejected promise forever (seen when PG and the platform boot
        // together and PG is still down).
        client = null;
        connecting = null;
        throw err;
      });
  }
  return connecting;
}

/** PG rejects NUL in text params; SQLite TEXT columns can carry them. */
function sanitize(v: unknown): unknown {
  if (typeof v === "string") return v.replace(/\0/g, "");
  return v;
}

/**
 * Convert an FTS5 MATCH expression (the platform's own dialect: double-quoted
 * phrases joined by ` AND `, see services/search-text.ts queryExpression) into
 * tsquery syntax. Phrase tokens become adjacency-chained lexemes; clauses are
 * ANDed. An empty expression yields a lexeme that matches nothing.
 */
function fts5ToTsquery(expr: string): string {
  if (typeof expr !== "string" || !expr.trim()) return "'__pg_shim_no_match__'";
  const clauses: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      cur += ch;
      continue;
    }
    if (!inQuotes && expr.startsWith(" AND ", i)) {
      clauses.push(cur);
      cur = "";
      i += 4;
      continue;
    }
    cur += ch;
  }
  clauses.push(cur);
  const out = clauses
    .map((c) => {
      const t = c.trim();
      if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
        const phrase = t.slice(1, -1).replace(/""/g, '"');
        const toks = phrase
          .split(/\s+/)
          .filter(Boolean)
          .map((tok) => `'${tok.replace(/'/g, "''")}'`);
        return toks.join(" <-> ");
      }
      if (!t) return "";
      return `'${t.replace(/'/g, "''")}'`;
    })
    .filter(Boolean);
  return out.join(" & ") || "'__pg_shim_no_match__'";
}

/**
 * Params feeding to_tsquery('simple', $n) are FTS5 expressions — convert their
 * VALUES to tsquery syntax. The translator rewrites `session_search MATCH ?`
 * into exactly that form, so the marker is self-describing in the SQL.
 */
function convertFtsParams(sql: string, params: unknown[] | null): unknown[] | null {
  if (!params) return null;
  const marker = /to_tsquery\('simple',\s*\$(\d+)\)/gi;
  let m: RegExpExecArray | null;
  const idxs = new Set<number>();
  while ((m = marker.exec(sql)) !== null) {
    idxs.add(Number(m[1]));
  }
  if (idxs.size === 0) return params;
  const out = [...params];
  for (const n of idxs) {
    if (n >= 1 && n <= out.length && typeof out[n - 1] === "string") {
      out[n - 1] = fts5ToTsquery(out[n - 1] as string);
    }
  }
  return out;
}

/** Errors meaning "PG is not up (yet)" — the statement never ran, safe to retry. */
const TRANSIENT_PG =
  /not yet accepting connections|the database system is starting up|ECONNREFUSED|connection refused/i;

// ============================================================
// Universal read-through cache (the "PG memory layer").
//
// Every read pays the synchronous bridge: the main thread blocks in Atomics.wait,
// one worker, one PG connection — so a handful of tiny lookups per request multiply
// into seconds of serialized queueing. This layer serves repeating reads from a
// table-aware LRU+TTL cache inside the worker:
//
//   read  (want="rows")  -> cache key = SQL + params; hit returns rows directly
//   write (exec/run)     -> statements are parsed for table names; every cache
//                           entry touching a written table is dropped IMMEDIATELY
//                           (read-after-write stays correct within this process)
//   TTL 300ms            -> bounds staleness from writers outside this process
//                           (a CLI minting a token, a script) to an imperceptible window
//   LRU 3000 entries     -> bounded worker memory (~tens of MB worst case)
//   volatile bypass      -> statements with random()/now()/current_* are never
//                           cached
// ============================================================
const READ_CACHE_TTL = 300;
const READ_CACHE_MAX = 3000;
interface ReadCacheEntry {
  at: number;
  result: Result;
  tables: Set<string>;
}
const readCache = new Map<string, ReadCacheEntry>();
const readCacheIndex = new Map<string, Set<string>>();

const VOLATILE_SQL =
  /\b(random\s*\(|now\s*\(|clock_timestamp|current_timestamp|current_date|pg_sleep|pg_stat_)\b/i;
const TABLE_RE = /\b(FROM|JOIN|INTO|UPDATE)\s+([A-Za-z_][A-Za-z0-9_.]*)/gi;

function tablesOf(sql: string): Set<string> {
  const tables = new Set<string>();
  TABLE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TABLE_RE.exec(sql)) !== null) {
    tables.add((m[2] ?? "").split(".").pop()!.toLowerCase());
  }
  return tables;
}

function readCacheKey(req: Req): string {
  return req.sql + "::" + (req.params ? JSON.stringify(req.params) : "");
}

function readCacheGet(key: string): ReadCacheEntry | null {
  const hit = readCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at >= READ_CACHE_TTL) {
    // expired: drop now (also clears its table index) instead of hoarding
    readCache.delete(key);
    for (const t of hit.tables) {
      const keys = readCacheIndex.get(t);
      if (keys) {
        keys.delete(key);
        if (keys.size === 0) readCacheIndex.delete(t);
      }
    }
    return null;
  }
  // LRU refresh
  readCache.delete(key);
  readCache.set(key, hit);
  return hit;
}

function readCachePut(key: string, tables: Set<string>, result: Result): void {
  if (readCache.size >= READ_CACHE_MAX) {
    const oldest = readCache.keys().next().value;
    if (oldest !== undefined) {
      const old = readCache.get(oldest);
      readCache.delete(oldest);
      if (old) {
        for (const t of old.tables) {
          const keys = readCacheIndex.get(t);
          if (keys) {
            keys.delete(oldest);
            if (keys.size === 0) readCacheIndex.delete(t);
          }
        }
      }
    }
  }
  readCache.set(key, { at: Date.now(), result, tables });
  for (const t of tables) {
    let keys = readCacheIndex.get(t);
    if (!keys) {
      keys = new Set<string>();
      readCacheIndex.set(t, keys);
    }
    keys.add(key);
  }
}

function readCacheInvalidate(tables: Set<string>): void {
  for (const t of tables) {
    const keys = readCacheIndex.get(t);
    if (!keys) continue;
    for (const key of keys) readCache.delete(key);
    readCacheIndex.delete(t);
  }
}

async function handle(req: Req): Promise<Result> {
  // The platform and PG may boot together; openDatabase's first statements can race
  // PG's readiness. Retry transient failures for up to 60s (bounded well inside the
  // main thread's 120s Atomics.wait budget).
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      return await handleOnce(req);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!TRANSIENT_PG.test(msg) || Date.now() > deadline) throw err;
      log("pg not ready, retrying in 1s:", msg.slice(0, 120));
      client = null;
      connecting = null;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function handleOnce(req: Req): Promise<Result> {
  // read path: serve from the universal cache when possible
  if (req.want === "rows" && !VOLATILE_SQL.test(req.sql)) {
    const key = readCacheKey(req);
    const hit = readCacheGet(key);
    if (hit) return hit.result;
    const tables = tablesOf(req.sql);
    const res = await handleQuery(req);
    if (res.rows && tables.size > 0) readCachePut(key, tables, res);
    return res;
  }
  // write path: invalidate every cache entry touching the written tables
  if (req.want !== "rows") {
    const tables = tablesOf(req.sql);
    if (tables.size > 0) readCacheInvalidate(tables);
  }
  return handleQuery(req);
}

async function handleQuery(req: Req): Promise<Result> {
  const c = await getClient();
  const params = req.params ? req.params.map(sanitize) : null;
  const finalParams = convertFtsParams(req.sql, params);
  if (req.want === "exec") {
    // exec CAN carry params (e.g. the PRAGMA user_version → _pg_meta upsert).
    await c.query(req.sql, finalParams || []);
    return { ok: true };
  }
  const res = await c.query(req.sql, finalParams || []);
  if (req.want === "rows") return { rows: res.rows };
  return { changes: res.rowCount ?? 0 };
}

if (parentPort) {
  parentPort.on("message", (msg: { req: Req; port?: unknown; ctrl?: Int32Array }) => {
    if (msg.port && msg.ctrl) {
      replyPort = msg.port as { postMessage: (m: unknown) => void };
      ctrlRef = msg.ctrl;
    }
    const req = msg.req;
    handle(req)
      .then((result) => {
        replyPort?.postMessage({ id: req.id, result });
        if (ctrlRef) {
          Atomics.store(ctrlRef, 0, 1);
          Atomics.notify(ctrlRef, 0);
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        log("query failed:", message, "sql:", req.sql.slice(0, 200));
        replyPort?.postMessage({ id: req.id, error: message });
        if (ctrlRef) {
          Atomics.store(ctrlRef, 0, 1);
          Atomics.notify(ctrlRef, 0);
        }
      });
  });
}

export {};

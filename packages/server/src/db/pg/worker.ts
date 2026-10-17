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
      port: cfg.port || 15432,
      database: cfg.database || "tracker",
      user: cfg.user || "tracker",
      password: cfg.password || "",
      statement_timeout: Number(process.env.PENGUIN_PG_STATEMENT_TIMEOUT_MS || 120000),
      application_name: "penguin-pg-shim",
    });
    connecting = c.connect().then(() => {
      client = c;
      c.on("error", (err) => {
        log("client error:", String(err));
        client = null;
        connecting = null;
      });
      if (cfg.schema) {
        const schema = JSON.stringify(cfg.schema).slice(1, -1);
        return c
          .query(`SET search_path TO ${schema}`)
          .then(() =>
            // The shim's PRAGMA user_version emulation lives here (migrations stamp it).
            c.query(
              `CREATE TABLE IF NOT EXISTS ${schema}._pg_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
            ),
          )
          .then(() => c);
      }
      return c;
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

async function handle(req: Req): Promise<Result> {
  const c = await getClient();
  const params = req.params ? req.params.map(sanitize) : null;
  const finalParams = convertFtsParams(req.sql, params);
  if (req.want === "exec") {
    await c.query(req.sql);
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

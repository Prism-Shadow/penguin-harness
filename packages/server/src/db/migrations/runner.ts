/**
 * Applies and reverts named migrations against the `schema_migrations` ledger.
 *
 * The ledger records which migrations ran, by NAME, one row each, in the order they ran (a
 * rowid table hands every insert max(rowid) + 1, so rowid order is application order). The
 * migration list is passed in, so this file knows nothing about any particular migration.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Migration } from "./migration.js";

/**
 * The ledger's DDL. An on-disk contract shared by every build that has the ledger: an older
 * one reads the names a newer one wrote. Never changed, only ever created.
 */
const LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
`;

export class IrreversibleMigrationError extends Error {
  constructor(readonly migration: string) {
    super(
      `migration ${migration} declares no down and cannot be rolled back. ` +
        `Restore the database from a backup taken before it was applied.`,
    );
    this.name = "IrreversibleMigrationError";
  }
}

export class UnknownMigrationError extends Error {
  constructor(readonly migration: string) {
    super(
      `migration ${migration} was applied by a build that knows it, and this build does not: ` +
        `it cannot roll it back. Roll back with that build.`,
    );
    this.name = "UnknownMigrationError";
  }
}

function hasLedger(db: DatabaseSync): boolean {
  return (
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get() !== undefined
  );
}

/** The names this database's ledger records, in the order they were applied. Empty without a ledger. */
export function appliedMigrations(db: DatabaseSync): string[] {
  if (!hasLedger(db)) return [];
  const rows = db.prepare("SELECT name FROM schema_migrations ORDER BY rowid").all() as {
    name: string;
  }[];
  return rows.map((r) => r.name);
}

export interface MigrateResult {
  /**
   * True when this run found no ledger and created it: a database from before the ledger
   * (stamped with a `user_version` whose meaning depended on the line that wrote it), or a
   * new one. Every migration then ran, as the re-runnable no-op it is where its work was done.
   */
  adopted: boolean;
  /** Names applied by this run, in order. */
  applied: readonly string[];
  /**
   * Contract migrations this swap-path run left pending, in order: the runtime's next open on
   * a build that declares them applies them. Always empty off the swap path.
   */
  deferred: readonly string[];
}

/**
 * Applies every migration in `migrations` whose name the ledger does not record, in
 * declaration order. Names in the ledger that `migrations` does not declare — written by a
 * newer build or another line — are left alone.
 *
 * Each migration and its ledger row commit together, so an interrupted run leaves the database
 * with exactly the migrations that fully applied. An already-current database does no work
 * and writes nothing. `PRAGMA user_version` is neither read nor written.
 *
 * `swapPath` marks the caller as a booting pushed platform. Expand migrations apply as
 * anywhere else; contract migrations (`swapSafe: false`) are skipped and stay pending — never
 * applied, never a reason to refuse the boot — and are returned in `deferred`. A hot push
 * therefore never fails on a migration it is not allowed to run, and never runs a contract.
 * (One expand removes something all the same: see steps/company-mode-channels.ts.)
 */
export function migrate(
  db: DatabaseSync,
  migrations: readonly Migration[],
  { swapPath = false }: { swapPath?: boolean } = {},
): MigrateResult {
  const adopted = !hasLedger(db);
  const done = new Set(appliedMigrations(db));
  const pending = migrations.filter((m) => !done.has(m.name));
  if (adopted) db.exec(LEDGER_DDL);
  const record = db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)");
  const applied: string[] = [];
  const deferred: string[] = [];
  for (const m of pending) {
    if (swapPath && !m.swapSafe) {
      deferred.push(m.name);
      continue;
    }
    db.exec("BEGIN");
    try {
      m.up(db);
      record.run(m.name, new Date().toISOString());
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${m.name} failed: ${String(err)}`, { cause: err });
    }
    applied.push(m.name);
  }
  return { adopted, applied, deferred };
}

/**
 * Reverts every migration applied AFTER `target`, newest-applied first; `null` reverts them
 * all. Order is the ledger's, not the declaration's: a migration another line's build applied
 * late is undone early.
 *
 * An operator's tool, and a destructive one — see each migration's `down` for what its rows
 * were. Deliberately not reachable from the swap path: a failed platform boot reverts the
 * PLATFORM, never the schema.
 *
 * Refused whole, before anything runs, when any migration in range declares no `down` or is
 * not one this build declares. Each `down` commits with the removal of its ledger row, so an
 * interrupted run stops between two whole steps.
 */
export function rollbackTo(
  db: DatabaseSync,
  migrations: readonly Migration[],
  target: string | null,
): { reverted: readonly string[] } {
  const applied = appliedMigrations(db);
  const from = target === null ? 0 : applied.indexOf(target) + 1;
  if (target !== null && from === 0) {
    throw new Error(`migration ${target} is not applied to this database`);
  }
  const byName = new Map(migrations.map((m) => [m.name, m]));
  const toRevert = applied.slice(from).reverse();
  for (const name of toRevert) {
    const m = byName.get(name);
    if (m === undefined) throw new UnknownMigrationError(name);
    if (m.down === null) throw new IrreversibleMigrationError(name);
  }
  const forget = db.prepare("DELETE FROM schema_migrations WHERE name = ?");
  const reverted: string[] = [];
  for (const name of toRevert) {
    db.exec("BEGIN");
    try {
      byName.get(name)!.down!(db);
      forget.run(name);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`rollback of migration ${name} failed: ${String(err)}`, { cause: err });
    }
    reverted.push(name);
  }
  return { reverted };
}

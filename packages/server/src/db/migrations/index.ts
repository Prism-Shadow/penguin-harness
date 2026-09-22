/**
 * Named schema migrations, recorded in a ledger.
 *
 * `schema.ts` declares the shape a FRESH database is created with. It cannot express a
 * CHANGE — `CREATE TABLE IF NOT EXISTS` only ever says "should exist". A migration says what
 * CHANGED; the `schema_migrations` ledger records, by name, which ones a database has run
 * (runner.ts). Every unrecorded migration is applied on open, in the order declared below.
 *
 * NAMES, NOT NUMBERS. A migration's name is its identity. Migrations used to be numbered and
 * stamped in `PRAGMA user_version`, and parallel PR lines kept giving one number two meanings:
 * a root stamped by one line skipped another line's migrations of the same numbers. Names do
 * not collide that way — two lines that each add a migration add two names, and a root that
 * ran one of them runs the other when it meets it. A build ignores names it does not declare,
 * so an older build keeps running on a database a newer one migrated.
 *
 * FROZEN. A migration spells out its own SQL and never imports SCHEMA_SQL, and once pushed its
 * name and DDL never change: some root may already have recorded it, and a recorded migration
 * never runs again there. A correction is a NEW migration.
 *
 * RE-RUNNABLE. Every `up` must leave a database that already has its effect exactly as it
 * was: `IF NOT EXISTS`, `ensureColumn`, `PRAGMA table_info` guards, and a shape check before
 * any table is rebuilt or data moved. The ledger records names, not shapes, so this is what
 * lets a root be adopted (below), and what lets the declarative track — SCHEMA_SQL and
 * openDatabase's ensureColumn list, which still run first at every runtime open — get there
 * before a migration does.
 *
 * SWAP-SAFE. A pushed platform boots against a live database and is ROLLED BACK to its
 * predecessor if it fails; the predecessor then runs on whatever the migration already did.
 * Additive work survives that, narrowing work does not. Anything that drops, retypes,
 * constrains, or reshapes in a way the predecessor cannot read or write is a CONTRACT
 * (`swapSafe: false`): the swap path leaves it pending and boots without it, and the runtime's
 * own open applies it (migration.ts). A hot push never refuses on a migration.
 *
 * DOWN, AND WHO DOES NOT CALL IT. Every migration declares an undo — or `null` to say it has
 * none. `down` is NOT the hot-update rollback mechanism: a failed platform boot reverts the
 * platform and leaves the schema where the migration put it, which `swapSafe` makes safe.
 * `down` is an operator's tool (`rollbackTo`), and LOSSY by nature: undoing "add a table" drops
 * the table with its rows. Each `down` names what its rows were.
 *
 * ADOPTION OF NUMBERED ROOTS. A database with no ledger — one stamped in `user_version` by a
 * build from before the ledger, whatever line it came from, or a new one — runs EVERY
 * migration once, re-runnably, and records them all. `user_version` is not read: the same
 * number meant different migrations on different lines. Nor is it written any more; it stays
 * at whatever the last numbered build left. Remove this adoption once no supported root can
 * still be without the ledger — the release that sets that baseline owns it.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Migration } from "./migration.js";
import * as runner from "./runner.js";
import { browserExtensions } from "./steps/browser-extensions.js";
import { companyModeChannels } from "./steps/company-mode-channels.js";
import { companyModeDeskNotices } from "./steps/company-mode-desk-notices.js";
import { companyModeOrgCaches } from "./steps/company-mode-org-caches.js";
import { dropGoalState } from "./steps/drop-goal-state.js";
import { machines } from "./steps/machines.js";
import { machinesColumns } from "./steps/machines-columns.js";
import { messagingBindings } from "./steps/messaging-bindings.js";
import { messagingDeliveryFlags } from "./steps/messaging-delivery-flags.js";
import { modelPromotions } from "./steps/model-promotions.js";
import { modelProviderAuthTokens } from "./steps/model-provider-auth-tokens.js";
import { sessionsSandbox } from "./steps/sessions-sandbox.js";
import { userProfile } from "./steps/user-profile.js";
import { sessionsSurface } from "./steps/sessions-surface.js";
import { portForwards } from "./steps/port-forwards.js";
import { portForwardsAdoption } from "./steps/port-forwards-adoption.js";
import { portForwardsDirection } from "./steps/port-forwards-direction.js";

export type { Migration } from "./migration.js";
export { IrreversibleMigrationError, UnknownMigrationError, appliedMigrations } from "./runner.js";
export type { MigrateResult } from "./runner.js";

/**
 * Every migration this build declares, in the order a database that lacks them applies them.
 * A new migration is appended; an existing one is never moved, renamed or removed while some
 * root may still lack it.
 */
export const MIGRATIONS: readonly Migration[] = [
  messagingBindings,
  messagingDeliveryFlags,
  dropGoalState,
  machines,
  userProfile,
  companyModeOrgCaches,
  companyModeChannels,
  companyModeDeskNotices,
  modelPromotions,
  modelProviderAuthTokens,
  sessionsSandbox,
  machinesColumns,
  browserExtensions,
  sessionsSurface,
  portForwards,
  portForwardsAdoption,
  portForwardsDirection,
];

/**
 * Applies every declared migration the ledger does not record. `swapPath` marks the caller as
 * a booting pushed platform, where contract migrations stay pending (runner.ts).
 */
export function migrate(
  db: DatabaseSync,
  options: { swapPath?: boolean } = {},
): runner.MigrateResult {
  return runner.migrate(db, MIGRATIONS, options);
}

/** Reverts every migration applied after `target` (`null`: all), newest-applied first. */
export function rollbackTo(
  db: DatabaseSync,
  target: string | null,
): { reverted: readonly string[] } {
  return runner.rollbackTo(db, MIGRATIONS, target);
}

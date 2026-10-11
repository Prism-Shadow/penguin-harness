import type { DatabaseSync } from "node:sqlite";

interface MigrationBase {
  /**
   * Kebab-case, names the change. It is the migration's IDENTITY: the ledger records it, and
   * every build — older or newer, from any PR line — recognises the work by it. Never renamed
   * once pushed.
   */
  name: string;
  /**
   * Applied inside a transaction together with its ledger row; throw to abort and leave the
   * ledger without it. Must be safe to run again on a database where its work is already done
   * (see the module doc's RE-RUNNABLE rule).
   */
  up: (db: DatabaseSync) => void;
  /**
   * Undoes `up`, or null when this migration cannot be undone — required, not optional, so
   * "there is no undo" is something the author states rather than forgets.
   *
   * Never called by the swap path (see the module doc): a failed boot reverts the platform,
   * not the schema. Reached only through `rollbackTo`, and destructive by nature — dropping
   * a table takes its rows with it.
   */
  down: ((db: DatabaseSync) => void) | null;
}

/**
 * EXPAND: strictly additive, or a superset the previous platform still reads and writes.
 *
 * `company-mode-channels` is the one exception, kept because it is frozen: it drops two tables
 * in the step that creates their replacements (see its file). No new migration may follow it —
 * a removal is a contract.
 */
interface ExpandMigration extends MigrationBase {
  swapSafe: true;
}

/**
 * CONTRACT: removes or narrows what no platform reads or writes any more. Applied only by the
 * runtime's own open; on the swap path it stays pending and the push boots without it. No
 * platform may depend on its effect, and no expand migration may assume it has run — a change
 * to an existing shape is split into expand (old and new side by side), the platforms moving
 * to the new shape, then contract (the old shape removed).
 */
interface ContractMigration extends MigrationBase {
  swapSafe: false;
}

/**
 * One schema change. `swapSafe` exists because of hot updates: a pushed platform boots against
 * a live database and is ROLLED BACK to its predecessor if it fails; the predecessor then runs
 * on whatever the migration already did.
 */
export type Migration = ExpandMigration | ContractMigration;

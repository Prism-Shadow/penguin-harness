/**
 * `machine` table repo: this server's own identity, one row.
 *
 * Its own table rather than a key in server_settings: nothing sets it, no endpoint reads it,
 * and "no settings rows" is an invariant that table's callers reason about. An identity is
 * not a setting — it is minted here and never assigned from outside, which is what makes two
 * controllers that both install to this host read back the SAME id, and what makes it survive
 * the host being renamed or re-aliased in someone's ssh config.
 *
 * See machines/machine-id.ts for how it reaches a controller looking at this machine.
 */
import type { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";

/**
 * 12 random bytes as base64url: 16 characters, 96 bits, no `=` padding to strip, and nothing
 * in the alphabet a path or query string would mangle. The bar is the birthday bound — ids
 * are minted on machines that never coordinate — and the length is the real constraint,
 * because a person reads this in a tooltip.
 */
const MACHINE_ID_BYTES = 12;

export class MachineRepo {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * The id if one has been minted, without minting one.
   *
   * For readers that must not create an identity as a side effect — `penguin server status`
   * runs on a data root whose server may never have started, and a machine that answers with
   * an id it minted for the question would be claiming to be something it is not.
   */
  peek(): string | null {
    const row = this.db.prepare("SELECT machine_id FROM machine WHERE singleton = 1").get();
    return row ? (row.machine_id as string) : null;
  }

  /** This machine's id, minted on first call and stable ever after. */
  id(): string {
    const existing = this.peek();
    if (existing !== null) return existing;
    const minted = randomBytes(MACHINE_ID_BYTES).toString("base64url");
    this.db.prepare("INSERT INTO machine (singleton, machine_id) VALUES (1, ?)").run(minted);
    return minted;
  }
}

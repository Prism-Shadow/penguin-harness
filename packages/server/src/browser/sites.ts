/**
 * The Browser's sites: which upstream origin each `<label>.localhost` host stands for.
 *
 * One site per (user, machine, origin), minted the first time that user opens that origin
 * from a Workspace on that machine and the SAME ever after — in web.db, so a restart or a
 * hot push leaves every open tab working and every site's cookies and storage where they
 * were. The label is random (128 bits), never derived: knowing a user, a machine and an
 * origin tells nobody the host it is served on.
 *
 * A site belongs to its user for minting and listing; SERVING it asks for the label alone —
 * the Browser host receives no session cookie, by design, so there is nobody to ask who is
 * calling. The label is the capability, as the preview token is on the preview origin.
 */
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface BrowserSite {
  label: string;
  userId: string;
  /** The machine the Workspace is on; null = this server. */
  machineId: string | null;
  origin: string;
}

/** Sites kept per user; past that, the least recently used age out. */
const MAX_SITES_PER_USER = 200;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** 16 random bytes as 26 lowercase base32 characters — a DNS label, and 128 bits. */
export function mintLabel(): string {
  const bytes = randomBytes(16);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function toSite(row: Record<string, unknown>): BrowserSite {
  return {
    label: row.label as string,
    userId: row.user_id as string,
    machineId: (row.machine_id as string) === "" ? null : (row.machine_id as string),
    origin: row.origin as string,
  };
}

export class BrowserSitesRepo {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  byLabel(label: string): BrowserSite | null {
    const row = this.db.prepare("SELECT * FROM browser_sites WHERE label = ?").get(label);
    return row ? toSite(row as Record<string, unknown>) : null;
  }

  /** The site for this origin as this user sees it from that machine — the existing one, or a new one. */
  obtain(userId: string, machineId: string | null, origin: string): BrowserSite {
    const machine = machineId ?? "";
    const at = this.now().toISOString();
    const existing = this.db
      .prepare("SELECT * FROM browser_sites WHERE user_id = ? AND machine_id = ? AND origin = ?")
      .get(userId, machine, origin);
    if (existing) {
      this.db
        .prepare("UPDATE browser_sites SET last_used_at = ? WHERE label = ?")
        .run(at, (existing as { label: string }).label);
      return toSite(existing as Record<string, unknown>);
    }
    const label = mintLabel();
    this.db
      .prepare(
        "INSERT INTO browser_sites (label, user_id, machine_id, origin, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(label, userId, machine, origin, at, at);
    this.db
      .prepare(
        "DELETE FROM browser_sites WHERE user_id = ? AND label NOT IN (SELECT label FROM browser_sites WHERE user_id = ? ORDER BY last_used_at DESC, rowid DESC LIMIT ?)",
      )
      .run(userId, userId, MAX_SITES_PER_USER);
    return { label, userId, machineId, origin };
  }
}

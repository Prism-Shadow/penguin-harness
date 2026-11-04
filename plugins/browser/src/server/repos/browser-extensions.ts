/**
 * browser_extensions: the Chromes paired to each user (the PenguinHarness Browser extension,
 * builtin-browser/extension-pairing.ts). A row holds the hash of the extension's long-lived
 * token, never the token; a revoked row stays, so a socket presenting its token is told it was
 * revoked (close 4003) rather than merely refused.
 */
import type { DatabaseSync } from "node:sqlite";

export interface BrowserExtensionRow {
  extensionId: string;
  userId: string;
  /** sha256(token) as hex. */
  tokenHash: string;
  name: string;
  version: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

/** What the pairing and the hub need of the table (the repo, or a test's in-memory one). */
export interface BrowserExtensionStore {
  insert(row: BrowserExtensionRow): void;
  findByTokenHash(tokenHash: string): BrowserExtensionRow | null;
  findById(extensionId: string): BrowserExtensionRow | null;
  /** The user's pairings that are not revoked, oldest first. */
  listByUser(userId: string): BrowserExtensionRow[];
  /** Marks one of the user's pairings revoked; false when it is not theirs or already revoked. */
  revoke(userId: string, extensionId: string, at: string): boolean;
  /** The extension was seen (connected or went away); the version its hello reported, when it gave one. */
  seen(extensionId: string, at: string, version?: string): void;
}

type Row = Record<string, unknown>;

function rowOf(r: Row): BrowserExtensionRow {
  return {
    extensionId: r.extension_id as string,
    userId: r.user_id as string,
    tokenHash: r.token_hash as string,
    name: r.name as string,
    version: r.version as string,
    createdAt: r.created_at as string,
    lastSeenAt: (r.last_seen_at as string | null) ?? null,
    revokedAt: (r.revoked_at as string | null) ?? null,
  };
}

export class BrowserExtensionsRepo implements BrowserExtensionStore {
  constructor(private readonly db: DatabaseSync) {}

  insert(row: BrowserExtensionRow): void {
    this.db
      .prepare(
        `INSERT INTO browser_extensions
           (extension_id, user_id, token_hash, name, version, created_at, last_seen_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.extensionId,
        row.userId,
        row.tokenHash,
        row.name,
        row.version,
        row.createdAt,
        row.lastSeenAt,
        row.revokedAt,
      );
  }

  findByTokenHash(tokenHash: string): BrowserExtensionRow | null {
    const r = this.db
      .prepare("SELECT * FROM browser_extensions WHERE token_hash = ?")
      .get(tokenHash) as Row | undefined;
    return r ? rowOf(r) : null;
  }

  findById(extensionId: string): BrowserExtensionRow | null {
    const r = this.db
      .prepare("SELECT * FROM browser_extensions WHERE extension_id = ?")
      .get(extensionId) as Row | undefined;
    return r ? rowOf(r) : null;
  }

  listByUser(userId: string): BrowserExtensionRow[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM browser_extensions WHERE user_id = ? AND revoked_at IS NULL
           ORDER BY created_at, extension_id`,
        )
        .all(userId) as Row[]
    ).map(rowOf);
  }

  revoke(userId: string, extensionId: string, at: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE browser_extensions SET revoked_at = ?
         WHERE extension_id = ? AND user_id = ? AND revoked_at IS NULL`,
      )
      .run(at, extensionId, userId);
    return Number(result.changes) > 0;
  }

  seen(extensionId: string, at: string, version?: string): void {
    if (version === undefined) {
      this.db
        .prepare("UPDATE browser_extensions SET last_seen_at = ? WHERE extension_id = ?")
        .run(at, extensionId);
      return;
    }
    this.db
      .prepare("UPDATE browser_extensions SET last_seen_at = ?, version = ? WHERE extension_id = ?")
      .run(at, version, extensionId);
  }
}

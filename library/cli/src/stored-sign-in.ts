/**
 * Reading the person's remembered sign-in on a data root: `<root>/cli-session.json`, mode 0600,
 * holding the token a login issued. The server package's `penguin auth` writes and clears it
 * (its cli/auth-session.ts, which re-exports this reader beside the writer); the client reads it
 * for the one retry after a `human_required` refusal (client.ts).
 */
import fs from "node:fs";
import path from "node:path";

/** Where a login is remembered, beside the data root it belongs to. */
export function sessionFile(root: string): string {
  return path.join(root, "cli-session.json");
}

/** A remembered login. `expiresAt` is the server's, so `status` can say it has run out. */
export interface StoredSession {
  server: string;
  userId: string;
  token: string;
  expiresAt?: string;
}

export function readSession(root: string): StoredSession | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(sessionFile(root), "utf8"));
    if (parsed === null || typeof parsed !== "object") return null;
    const row = parsed as Record<string, unknown>;
    if (typeof row.server !== "string" || typeof row.token !== "string") return null;
    return {
      server: row.server,
      userId: typeof row.userId === "string" ? row.userId : "admin",
      token: row.token,
      ...(typeof row.expiresAt === "string" ? { expiresAt: row.expiresAt } : {}),
    };
  } catch {
    return null;
  }
}

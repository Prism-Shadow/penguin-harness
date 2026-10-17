/**
 * The server's standing rule for the `official` flag (PRN-021): a file it reads never leaves a
 * first-party vendor group without one. Core lends a vendor's environment variable only to the
 * rows of a group whose `[providers.<id>]` says `official = true`, and reads nothing but that
 * boolean; the server, which has the catalog, is the one that knows which groups qualify.
 *
 * Not a migration: it runs on every read through ProjectConfigService.readTable and on the
 * startup sweep (migrateStoredConfigs), for a file from before the flag as much as for one the
 * CLI or the SDK wrote without it. A data root used by the SDK alone, without the server, gets
 * nothing filled in and has to write `official` itself.
 */
import { officialVendor, withOfficialFlag } from "@prismshadow/penguin-core/model-catalog";

/** A TOML table: a plain object, not an array. */
function isTable(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Fills in `official` on every first-party vendor group the file names — by a row's `provider`
 * or by a table of its own — whose table carries no `official` key: `withOfficialFlag` on its
 * stored base URL and protocol decides (the vendor's own endpoint or none, and a protocol that
 * reads the vendor's variable), and an official group with a base URL and no protocol also gets
 * the vendor's official client as `client_type`, so core can name the variable. A group that
 * has the key already — written by the server, or set by hand — is left exactly as it is: a
 * hand-set value always stands.
 *
 * Only first-party vendor groups: gateways, vLLM, custom, user-defined groups and the
 * third-party adapters (Penguin Go, ModelScope) are never lent a vendor key, and carry no flag.
 *
 * Returns whether anything changed; the caller writes the table back once, so a second read of
 * the result finds nothing to fill.
 */
export function markOfficialGroups(table: Record<string, unknown>): boolean {
  const providers = isTable(table.providers) ? table.providers : {};
  const named = new Set(Object.keys(providers));
  for (const row of Array.isArray(table.models) ? table.models : []) {
    if (isTable(row) && typeof row.provider === "string") named.add(row.provider);
  }
  const next: Record<string, unknown> = { ...providers };
  let changed = false;
  for (const id of named) {
    if (officialVendor(id) === undefined) continue;
    const member = isTable(providers[id]) ? providers[id] : {};
    if (typeof member.official === "boolean") continue;
    next[id] = withOfficialFlag(id, member);
    changed = true;
  }
  if (changed) table.providers = next;
  return changed;
}

/**
 * The one-time migrations a `.project_config.toml` goes through in the server's read path
 * only (ProjectConfigService.readTable), after core's own (migrateProjectConfigTable). They
 * need the built-in catalog, which core does not have: a file read by the SDK alone is not
 * migrated by these.
 */
import { officialVendor, withOfficialFlag } from "@prismshadow/penguin-core/model-catalog";

/** A TOML table: a plain object, not an array. */
function isTable(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * One-time migration to the `official` flag (PRN-021): before it, a keyless row was lent its
 * vendor's environment variable whenever its effective endpoint was the vendor's own, judged
 * from a catalog core no longer has. Now core lends one only to the rows of a group whose
 * `[providers.<id>]` says `official = true`, so every first-party vendor group the file names —
 * by a row's `provider` or by a table of its own — and whose table carries no `official` yet
 * gets the answer today's rule gives: `withOfficialFlag` on its stored base URL and protocol
 * (the vendor's own endpoint or none, and a protocol that reads the vendor's variable), plus
 * the vendor's official client as `client_type` where an official group has a base URL and no
 * protocol, so core can name the variable. A group with `official` already — written by this
 * release, or by hand — is left alone, so this runs once per group and a hand edit stands.
 *
 * Only first-party vendor groups: gateways, vLLM, custom, user-defined groups and the
 * third-party adapters (Penguin Go, ModelScope) were never lent a vendor key through their
 * group, and stay without the flag. Rows that named a vendor endpoint of their own lose the
 * environment, by the user's decision; the changelog says so.
 *
 * Returns whether anything changed; the caller writes the table back once.
 *
 * Removal: at the 0.3.0 release preparation, by whoever prepares it, together with core's
 * migrateProjectConfigTable — once the release notes say a Project last opened before the
 * release that shipped this must be opened once on a 0.2.x server first. Takes out this
 * function, its call in ProjectConfigService.readTable and its tests (server
 * `official-groups.test.ts`, "the one-time migration"); see
 * changelog/unreleased/2026-10-15-backward-compatibility.md.
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

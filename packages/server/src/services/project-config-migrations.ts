/**
 * The one-time migrations a `.project_config.toml` goes through in the server's read path
 * only (ProjectConfigService.readTable), after core's own (migrateProjectConfigTable). They
 * need the built-in catalog, which core does not have: a file read by the SDK alone is not
 * migrated by these.
 */
import {
  PENGUIN_GO_BASE_URL,
  PENGUIN_GO_PROVIDER_ID,
  officialVendor,
  withOfficialFlag,
} from "../model-catalog.js";

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

/**
 * Go-owned connection URLs, including stored routes from before the MMSP switch. The
 * `token.penguin.ooo` origin and the `/api`, `/api/v1beta` and `/api/anthropic` paths are those
 * pre-MMSP routes, recognized only so they can be migrated: removed with the migration at the
 * 0.3.0 release preparation (see migratePenguinGoRoutes). The server's trusted Go origin
 * (`PENGUIN_GO_ORIGIN`) counts as Go's too.
 */
export function isPenguinGoEndpoint(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const origins = ["https://go.penguin.ooo", "https://token.penguin.ooo"];
    if (process.env.PENGUIN_GO_ORIGIN) origins.push(new URL(process.env.PENGUIN_GO_ORIGIN).origin);
    return (
      origins.includes(url.origin) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      ["/api", "/api/v1", "/api/v1beta", "/api/anthropic"].includes(
        url.pathname.replace(/\/+$/, ""),
      )
    );
  } catch {
    return false;
  }
}

/**
 * Switches Go-managed routes (the group's and the rows' that point at a Penguin Go endpoint) to
 * MMSP, without network discovery. Other fields, other groups and user-redirected endpoints are
 * preserved.
 *
 * Two callers. Without `endpoint` it is a one-time migration of routes stored before the MMSP
 * switch (`google-genai` / `deepseek-official` on `token.penguin.ooo/api`), run in the server's
 * read path (ProjectConfigService.readTable) on every load — the server's alone since the
 * catalog left core, so a file read by the SDK alone is not migrated. With `endpoint`,
 * authorization and catalog sync apply the platform's MMSP endpoint, which also refreshes a
 * route that is already MMSP.
 *
 * Removal: at the 0.3.0 release preparation, by whoever prepares it, together with core's
 * migrateLegacyClientTypes (same release-notes condition). Takes out the no-`endpoint` call in
 * ProjectConfigService.readTable and the `endpoint === undefined` branch below, the pre-MMSP
 * origin and paths in isPenguinGoEndpoint, and the migration cases in server
 * `penguin-go-mmsp.test.ts` ("Penguin Go stored projects"); see
 * changelog/0.2.15/2026-10-12-backward-compatibility.md and
 * changelog/unreleased/2026-10-15-backward-compatibility.md. The `endpoint` path stays.
 */
export function migratePenguinGoRoutes(table: Record<string, unknown>, endpoint?: string): number {
  if (!Array.isArray(table.models)) return 0;
  const providers = isTable(table.providers) ? table.providers : {};
  const groupValue = providers[PENGUIN_GO_PROVIDER_ID];
  const group = isTable(groupValue) ? groupValue : {};
  const nextRoute = (base: unknown, client: unknown): string | undefined => {
    if (!isPenguinGoEndpoint(base)) return undefined;
    if (
      endpoint === undefined &&
      client === "mmsp" &&
      new URL(base).pathname.replace(/\/+$/, "") === "/api/v1"
    )
      return undefined;
    return endpoint ?? PENGUIN_GO_BASE_URL;
  };
  const groupRoute = nextRoute(group.base_url, group.client_type);
  let updated = 0;
  const models = table.models.map((value) => {
    if (!isTable(value) || value.provider !== PENGUIN_GO_PROVIDER_ID) return value;
    const base = value.base_url ?? group.base_url;
    const target = nextRoute(base, value.client_type ?? group.client_type);
    if (
      target !== undefined &&
      ((value.client_type ?? group.client_type) !== "mmsp" || base !== target)
    ) {
      updated++;
      return { ...value, client_type: "mmsp", base_url: target };
    }
    if (
      groupRoute !== undefined &&
      !isPenguinGoEndpoint(base) &&
      value.client_type === undefined &&
      group.client_type !== undefined &&
      group.client_type !== "mmsp"
    ) {
      return { ...value, client_type: group.client_type };
    }
    return value;
  });
  if (groupRoute !== undefined && (group.client_type !== "mmsp" || group.base_url !== groupRoute)) {
    table.providers = {
      ...providers,
      [PENGUIN_GO_PROVIDER_ID]: { ...group, client_type: "mmsp", base_url: groupRoute },
    };
    if (updated === 0) updated = 1;
  }
  if (updated > 0) table.models = models;
  return updated;
}

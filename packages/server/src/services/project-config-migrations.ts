/**
 * The one-time migration a `.project_config.toml` goes through in the server's read path only
 * (ProjectConfigService.readTable, and the startup sweep that runs it once per Project), after
 * core's own (migrateProjectConfigTable): the one that needs the built-in catalog, which core's
 * loader does not run, so a file read by the CLI or the SDK alone is not migrated by it.
 * Temporary, like core's: it names its removal.
 */
import { PENGUIN_GO_BASE_URL, PENGUIN_GO_PROVIDER_ID } from "../model-catalog/catalog.js";

/** A TOML table: a plain object, not an array. */
function isTable(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
 * changelog/0.2.17/2026-10-15-backward-compatibility.md. The `endpoint` path stays.
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

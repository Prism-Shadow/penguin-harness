/**
 * The one-time migrations a `.project_config.toml` goes through in the server's read path only
 * (ProjectConfigService.readTable, and the startup sweep that runs it once per Project), after
 * core's own (migrateProjectConfigTable): the ones that need the built-in catalog, which core's
 * loader does not run, so a file read by the CLI or the SDK alone is not migrated by these.
 * Temporary, like core's: each names its removal.
 */
import {
  groupKeyReaches,
  sameClientType,
  sameEndpoint,
} from "@prismshadow/penguin-core/model-connection";
import {
  DEEPSEEK_BASE_URL,
  MINIMAX_BASE_URL,
  PENGUIN_GO_BASE_URL,
  PENGUIN_GO_PROVIDER_ID,
  routedClientType,
} from "../model-catalog.js";

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

/** A non-blank string field, else undefined. */
function present(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * The groups whose presets carried their vendor's own endpoint as a row base URL (DeepSeek from
 * 2026-09-10, MiniMax from 2026-08-18, both until 2026-10-03), each with the client the preset
 * pinned beside it (`deepseek-v4` / `minimax-m3`, which core's client-type migration names
 * `deepseek-official` / `minimax-official`): the client whose default endpoint that URL is, and
 * the one the group's ids route to with no pin.
 */
const PRESET_VENDOR_ENDPOINTS = [
  { provider: "deepseek", baseUrl: DEEPSEEK_BASE_URL, clientType: "deepseek-official" },
  { provider: "minimax", baseUrl: MINIMAX_BASE_URL, clientType: "minimax-official" },
] as const;

/**
 * Deletes the base URL a DeepSeek or MiniMax preset wrote into the file — the vendor's own
 * endpoint, on a row of the group or hoisted onto `[providers.<id>]` by core's group-level
 * migration — together with the vendor client pinned beside it, so the group's keyless rows are
 * handed nothing again and MMSP's client reads the vendor's `*_API_KEY` (PRN-021: a base URL
 * from the file is never lent a variable). Keys, other groups and any other value stay as
 * written.
 *
 * Only the preset's signature is taken: the vendor URL and the vendor's own client pinned on the
 * same table, as every preset-written copy has it. A URL typed later carries no such pin (the
 * dialogs offer no vendor client), so this never undoes a user's own choice and a second read
 * finds nothing — the migration happens once without any marker. A proxy, the vendor's second
 * host, or a generic protocol beside the URL is not the signature and stays.
 *
 * And only where dropping both moves nothing. A row's pair goes only when what it then follows —
 * its group's URL and protocol, else its id's routing — still lands it on that URL and client.
 * The group's pair goes only when every id that followed its pin routes to that client by itself,
 * every row that followed its URL ends on that client, and no row keeps a base URL of its own on
 * the group's origin (it would lose the group key: core's groupKeyReaches). One more edge,
 * documented: a `DEEPSEEK_BASE_URL` / `MINIMAX_BASE_URL` set in the server environment now takes
 * effect for these rows.
 *
 * Returns whether anything changed; the caller writes the table back once.
 *
 * Removal: at the 0.3.0 release preparation, by whoever prepares it, together with core's
 * migrations: this function, its call in ProjectConfigService.readTable, MINIMAX_BASE_URL in the
 * catalog, and the server `project-config-migrations.test.ts` scenarios; see
 * changelog/unreleased/2026-10-15-backward-compatibility.md.
 */
export function migratePresetVendorEndpoints(table: Record<string, unknown>): boolean {
  const providers = isTable(table.providers) ? { ...table.providers } : {};
  const models = Array.isArray(table.models) ? [...(table.models as unknown[])] : [];
  let changed = false;
  for (const vendor of PRESET_VENDOR_ENDPOINTS) {
    /** A table holding the preset's signature: the vendor URL with the vendor client beside it. */
    const signed = (t: Record<string, unknown>): boolean => {
      const url = present(t.base_url);
      const client = present(t.client_type);
      return (
        url !== undefined &&
        client !== undefined &&
        sameEndpoint(url, vendor.baseUrl) &&
        sameClientType(client, vendor.clientType)
      );
    };
    /** Whether a row's id reaches the vendor client with no pin at all. */
    const routesByItself = (row: Record<string, unknown>): boolean =>
      typeof row.model_id === "string" && routedClientType(row.model_id) === vendor.clientType;
    const member = providers[vendor.provider];
    const group: Record<string, unknown> = isTable(member) ? member : {};
    const groupUrl = present(group.base_url);
    const groupClient = present(group.client_type);
    /**
     * A row without its own URL and pin follows its group's: that must land it where it went —
     * no group URL or the same signature, and the vendor client by the group's pin or its id.
     */
    const rowMayDrop = (row: Record<string, unknown>): boolean =>
      (groupUrl === undefined || signed(group)) &&
      (groupClient === undefined
        ? routesByItself(row)
        : sameClientType(groupClient, vendor.clientType));
    const rows: Record<string, unknown>[] = [];
    models.forEach((value, i) => {
      if (!isTable(value) || value.provider !== vendor.provider) return;
      if (signed(value) && rowMayDrop(value)) {
        const { base_url: _url, client_type: _client, ...row } = value;
        models[i] = row;
        rows.push(row);
        changed = true;
      } else {
        rows.push(value);
      }
    });
    if (
      groupUrl !== undefined &&
      signed(group) &&
      rows.every((row) => {
        const ownClient = present(row.client_type);
        // The group's pin goes: a row with none of its own must reach the client by its id.
        if (ownClient === undefined && !routesByItself(row)) return false;
        const ownUrl = present(row.base_url);
        // A row on another URL keeps it, but must not lose the group key with the group's URL.
        if (ownUrl !== undefined) return !groupKeyReaches(ownUrl, groupUrl);
        // The group's URL goes: a row following it must end on the vendor client.
        return ownClient === undefined || sameClientType(ownClient, vendor.clientType);
      })
    ) {
      const { base_url: _url, client_type: _client, ...rest } = group;
      if (Object.keys(rest).length > 0) providers[vendor.provider] = rest;
      else delete providers[vendor.provider];
      changed = true;
    }
  }
  if (changed) {
    if (isTable(table.providers)) table.providers = providers;
    if (Array.isArray(table.models)) table.models = models;
  }
  return changed;
}

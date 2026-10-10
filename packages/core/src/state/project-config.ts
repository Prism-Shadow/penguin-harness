/**
 * Project config storage (`<project>/.project_config.toml`).
 *
 * Records the available Models, the default Model, and each Model's credential (Model
 * is decoupled from Agent — the Model selection isn't stored in Agent State, but maintained by
 * the Project). Config is persisted as TOML.
 *
 * `.project_config.toml` is the Project's **single config file**: a hidden file (not shown by
 * default `ls`), written to disk with mode 0600; credentials (api_key / base_url) are **inlined
 * in it** — once per group in `[providers.<id>]`, and on a model entry where that one model
 * overrides its group — rather than split into a supplementary area and a separate secrets file.
 * It can only be read/written via the system interfaces (CLI / Web) — never hand-edited by the
 * model or the user; the system Prompt is forbidden from reading this file, `loadProjectConfig`
 * returns plaintext, and masking is applied at the interface layer (when shown by server / cli).
 *
 * Model references are **fully split into separate fields**: an entry stores
 * `provider` and `model_id` as two independent fields, with the `(provider, model_id)` pair as
 * the unique key — string concatenation like `<provider>/<id>` is forbidden anywhere in the
 * pipeline. `model_id` is the upstream request id, sent to MMSP unchanged; `default_model` /
 * `vision_model` are paired `{ provider, model_id }` references (a TOML inline table).
 *
 * A caller always supplies the **complete pair**: `provider` is never guessed from the builtin
 * catalog and never derived from whichever configured entry happens to carry the same
 * `model_id`. Both halves or neither — a `model_id` without a `provider` is an error, not a
 * lookup, because resolving it would silently point credentials and pricing at a vendor the
 * caller never named.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type {
  CommandPolicyConfig,
  CommandPolicyRule,
  ThinkingLevelName,
} from "../interfaces/index.js";
import { atomicWriteFile } from "../internal/atomic-write.js";
import { DEFAULT_COMMAND_POLICY_RULES } from "./command-policy-defaults.js";
import {
  canonicalClientType,
  groupKeyReaches,
  presetModelEntries,
  presetProviderTable,
  sameClientType,
  sameEndpoint,
} from "./model-catalog.js";
import { projectConfigPath } from "./paths.js";

/** Model reference: a `(provider, model_id)` pair (never string-concatenated anywhere). */
export interface ModelRef {
  provider: string;
  /** Upstream model id (the request id sent to MMSP unchanged). */
  model_id: string;
}

/**
 * Display form of a paired reference (shared by error messages and CLI output):
 * `(provider=..., model_id=...)`. For display only — it isn't any storage or addressing format.
 */
export function formatModelRef(ref: ModelRef): string {
  return `(provider=${ref.provider}, model_id=${ref.model_id})`;
}

/**
 * Pricing for a single Model: three price buckets, in USD per million tokens.
 * Docs: /docs/configuration § "Project config".
 */
export interface ModelPricing {
  /** Pricing unit tag; currently only `usd_per_mtok` (USD per million tokens). */
  unit: "usd_per_mtok";
  cache_read: number;
  cache_write: number;
  output: number;
}

/**
 * A single available Model entry (credential inlined, single config file).
 * Docs: /docs/models § "The per-Project model table".
 */
export interface ModelEntry {
  /** provider group (stored separately from `model_id`; the pair is the entry's unique key). */
  provider: string;
  /** Upstream model id: the actual request id sent to MMSP, used paired with provider for display, pricing, and stats. */
  model_id: string;
  context_window?: number;
  /**
   * MMSP client type (`openai-responses` / `ant-messages` / `openai-chat` /
   * `google-genai` / `anthropic-official` / …) of this model alone, overriding its group's:
   * when absent the row follows its group's `[providers.<id>]` table (effectiveConnection),
   * and with neither MMSP routes the request id (`model_id`) by the vendor family it begins
   * with (`gpt-`, `claude-`, `gemini-`, `glm-`, `kimi-`, `deepseek-`, `minimax-`) — the
   * catalog is never consulted. A new Project stores one here only where the catalog's row
   * differs from its group's (Penguin Go's and OpenCode Go's rows, custom's Atria).
   * Third-party endpoints use one of the generic protocol clients: `openai-responses` (OpenAI
   * Responses API), `ant-messages` (Anthropic Messages API), `openai-chat` (OpenAI Chat
   * Completions; the bare `openai` spelling from configs saved before the client was renamed
   * (MMSP 0.4.2) is normalized to it on read — see canonicalClientType), `google-genai`
   * (Google's generateContent) or `mmsp` (an MMSP server). The Web models page can detect
   * which of the first three a custom base URL serves.
   */
  client_type?: string;
  /**
   * Display name (the model page card title): only persisted when it differs from the builtin
   * catalog (the user renamed it / a custom model); when not persisted, it's inferred from the
   * builtin catalog by `(provider, model_id)`, falling back to displaying model_id if it can't be
   * inferred.
   */
  display_name?: string;
  /**
   * Whether image input is supported (vision/multimodal); defaults to supported. For a model
   * tagged `false` (e.g. DeepSeek): images from conversation input are saved to the session
   * scratchpad and handed over as a file path spliced into the text, and read_file has the
   * Project's vision model read an image on its behalf instead of returning it — the image
   * never directly enters that session's history.
   */
  vision?: boolean;
  /**
   * Per-model max output tokens (the request's output cap, i.e. GenerativeModelConfig.maxTokens):
   * when set it wins over the Agent's `system_config.model.max_tokens` — the fit is a model trait
   * (the seeded per-Agent default of 32000 cannot fit into e.g. a 32768-token context window
   * together with any prompt, and the upstream rejects the request outright). Unset = inherit
   * the Agent value. User-only, never preset by the builtin catalog.
   */
  max_tokens?: number;
  /**
   * Per-model fast mode (MMSP UniConfig `fast_mode`): opts session requests into the
   * provider's faster serving tier at premium pricing (OpenAI-protocol clients send
   * `service_tier: "priority"`, Anthropic-protocol clients send `speed: "fast"`). Only `true`
   * is ever persisted; absent = off (the default). Models without a fast tier reject the
   * parameter (MMSP raises UnsupportedParameterError), which ends the request with a
   * clear non-retried failure (see llm/generative-model.ts). User-only, never preset by the
   * builtin catalog.
   */
  fast_mode?: boolean;
  /** Pricing info; absent means this Model's cost isn't counted. */
  pricing?: ModelPricing;
  /**
   * API key for this model alone, overriding the group's `[providers.<id>].api_key`; with
   * neither, the vendor's environment variable where modelEnvFallback allows it.
   */
  api_key?: string;
  /**
   * Base URL for this model alone, overriding the group's (effectiveConnection); with
   * neither, the routed client's default endpoint. A custom or user-defined row stores its
   * endpoint here when its group names none, and a preset whose endpoint differs from its
   * group's carries it from creation (OpenCode Go's Messages rows, custom's Atria). The
   * group's key reaches this row only while this is absent or on the group's origin
   * (groupKeyReaches).
   */
  base_url?: string;
  /** api_key's write timestamp (ISO 8601; a display field maintained by the interface layer). */
  created_at?: string;
}

/** Approval modes storable in `[default_chat]` (mirrors the Web/CLI ApprovalMode enum). */
export const CHAT_APPROVAL_MODES = ["allow-all", "deny-all", "read-only", "always-ask"] as const;
export type ChatApprovalMode = (typeof CHAT_APPROVAL_MODES)[number];

/**
 * Thinking levels storable in `[default_chat]`: the selectable tiers only — never
 * `"none"` (the project default is a fallback for Agents without an explicit level, and
 * "no thinking" is not offered as a default; see the web picker's SELECTABLE_THINKING_LEVELS).
 */
export type DefaultChatThinkingLevel = Exclude<ThinkingLevelName, "none">;
export const DEFAULT_CHAT_THINKING_LEVELS: readonly DefaultChatThinkingLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/**
 * New-chat defaults (`[default_chat]`): per-Project prefill for newly created chats.
 * Every key is optional and independent:
 * - `agent_id`: the Agent preselected on the draft page (must name an existing Agent);
 * - `workspace`: the prefilled Workspace directory (absent/empty = a temporary workspace);
 * - `approval_mode`: the prefilled approval mode (absent = the built-in "allow-all");
 * - `thinking_level`: fallback thinking level for Agents whose config has no explicit
 *   `model.thinking_level` (see Agent's thinking-level resolution chain in agent.ts).
 * The default Model is deliberately NOT here: it stays the top-level `default_model`
 * (single-sourced with the models page — never a second key).
 */
export interface ProjectChatDefaults {
  agent_id?: string;
  workspace?: string;
  approval_mode?: ChatApprovalMode;
  thinking_level?: DefaultChatThinkingLevel;
}

/**
 * `[providers.<id>]`: the connection a group's rows follow unless a row overrides a field
 * (effectiveConnection reads it through providerConnectionShape). Keyed by provider id,
 * built-in or user-defined. Every field optional; an absent or blank one is unset, and a row
 * with no value of its own then gets the client's default — never a catalog value. A new
 * Project writes the catalog's endpoint and protocol here for every built-in group that has
 * them (presetProviderTable); from then on the table is the user's.
 */
export interface ProviderConnection {
  base_url?: string;
  api_key?: string;
  client_type?: string;
  /** api_key's write time (ISO 8601); a display field maintained by the interface layer, as on rows. */
  created_at?: string;
}

/** Every group's connection defaults, keyed by provider id. */
export type ProviderTable = Record<string, ProviderConnection>;

/**
 * Project-level config.
 * Docs: /docs/configuration § "Project config".
 */
export interface ProjectConfig {
  /** Project display name (the display name is separate from the id, shown as the id when unset). */
  name?: string;
  /** Paired reference to the default Model; must point to an entry in `models`. */
  default_model?: ModelRef;
  /**
   * The vision model used by read_file to read images on behalf of a session model (when a session
   * model with `vision=false` reads an image, it's handed to this model to describe and the tool
   * returns text); must point to an entry in `models` (a paired reference). Unconfigured by
   * default — models that don't support images won't be able to read images.
   */
  vision_model?: ModelRef;
  /**
   * New-chat defaults block; absent by default (`defaultProjectConfig` never includes it —
   * absent = the pre-existing behavior). Loaded tolerantly: invalid values drop per key.
   */
  default_chat?: ProjectChatDefaults;
  /**
   * Sandbox command policy (`[command_policy]`): Project-owned deny rules for shell
   * commands, threaded into every Session's Environment at creation and consulted ahead of
   * the approval mode. The factory rule set is seeded at project creation like the model
   * presets (copied in, never rewritten afterward); a config from before the seeding —
   * absent block, or a block without a `rules` list — behaves as the factory set until the
   * first saved edit materializes the list. Loaded tolerantly: an invalid value drops per
   * key, and dropping `enabled` falls back to on.
   */
  command_policy?: CommandPolicyConfig;
  /**
   * The plugin packages this Project asks its deployment to run: the `[plugins]` table,
   * keyed by package name, in the shape of Cargo's `[dependencies]` —
   *
   *   [plugins]
   *   "@scope/name" = "*"                  # whatever the deployment ships
   *   "@scope/other" = "1.2.3"             # a version requirement
   *   "@scope/third" = { version = "1.2" } # the table form, where later fields go
   *
   * A table rather than a list so an entry can grow fields without a format change. A
   * `[plugins.<machineId>]` sub-table lists what that one machine runs besides (PluginTables).
   *
   * Project-scoped because machines are lent to Projects, so this is what says which
   * machines a plugin has to reach. LOADING is per process, though — there is one module
   * tree — so a deployment runs the CLOSURE: the union over its Projects. A plugin any
   * Project asks for is in the tree, and what it contributes is visible to all of them.
   */
  plugins?: PluginTables;
  /**
   * Per-group connection defaults (`[providers.<id>]`); absent = no group sets anything, and
   * each row runs on its own values and the client's defaults. Loaded tolerantly
   * (parseProviderTable).
   */
  providers?: ProviderTable;
  models: ModelEntry[];
}

/**
 * Returns the Project's default config: every entry from the preset builtin model catalog
 * (context_window / pricing / vision tags, and a protocol or endpoint only where a row's
 * differs from its group's) and, beside them, each built-in group's endpoint and protocol in
 * `[providers.<id>]` (presetProviderTable) — so the file alone says where every request goes,
 * and the catalog is not read again when one is built. No keys are included: the user only
 * needs to fill in an API key as needed (left empty falls back to the vendor's environment
 * variable where modelEnvFallback allows it).
 */
export function defaultProjectConfig(): ProjectConfig {
  return {
    // DeepSeek V4.1 Flash, which the vendor serves under the bare name `deepseek-flash`: the
    // current generation of the Flash series, at the same price and schedule as the V4 rows
    // it replaces, and it reads images — so a new Project can take a pasted screenshot
    // without anyone having to notice why it could not. The bare id begins with the
    // `deepseek-` family, so MMSP routes it to DeepSeek's official client without a pin. A
    // Project's default is copied in at
    // creation and owned by it from then on, so this reaches new Projects alone; an existing
    // one keeps whatever it stored, and "sync presets" never touches the stored default.
    default_model: { provider: "deepseek", model_id: "deepseek-flash" },
    // The factory command-policy rules are seeded like the model presets: copied into the
    // new project's config and owned by it from then on — later factory changes never
    // rewrite an existing file. Spread to keep the module-level constant frozen.
    command_policy: { rules: DEFAULT_COMMAND_POLICY_RULES.map((r) => ({ ...r })) },
    providers: presetProviderTable(),
    models: presetModelEntries(),
  };
}

/** The old format (concatenated storage id / string reference) is never migrated: reading it reports a clear error immediately (the product hasn't shipped yet). */
const OLD_FORMAT_HINT =
  "No migration since the product hasn't shipped yet: delete this config file and rebuild it with `penguin config model add/default`.";

/** Validates the default_model / vision_model fields: must be a { provider, model_id } paired reference. */
function parseRefField(file: string, name: string, value: unknown): ModelRef | undefined {
  if (value === undefined) return undefined;
  const ref = value as { provider?: unknown; model_id?: unknown };
  if (
    typeof value !== "object" ||
    value === null ||
    typeof ref.provider !== "string" ||
    typeof ref.model_id !== "string"
  ) {
    throw new Error(
      `${name} in .project_config.toml is in a legacy/invalid format (must be a { provider = "...", model_id = "..." } paired reference): ${file}. ${OLD_FORMAT_HINT}`,
    );
  }
  return { provider: ref.provider, model_id: ref.model_id };
}

/** Validates a model entry: both provider and model_id must be strings (an old-format entry is missing provider). */
function assertModelEntry(file: string, entry: unknown): ModelEntry {
  const m = entry as { provider?: unknown; model_id?: unknown; client_type?: unknown };
  if (
    typeof entry !== "object" ||
    entry === null ||
    typeof m.provider !== "string" ||
    typeof m.model_id !== "string"
  ) {
    throw new Error(
      `A models entry in .project_config.toml is in a legacy/invalid format (provider and model_id must be two separate fields): ${file}. ${OLD_FORMAT_HINT}`,
    );
  }
  // Backward compatibility for configs saved before the generic Chat Completions client was
  // renamed (MMSP 0.4.2): a stored `client_type = "openai"` is normalized to the canonical
  // "openai-chat" on read (copied, never mutated in place — callers may hand in a cached
  // parse), so old configs keep working and every consumer sees one spelling.
  if (typeof m.client_type === "string") {
    const canonical = canonicalClientType(m.client_type);
    if (canonical !== m.client_type) {
      return { ...(entry as ModelEntry), client_type: canonical };
    }
  }
  return entry as ModelEntry;
}

/**
 * The client types AgentHub 0.4 named after model generations, matched the way its router
 * matched them (anywhere in the lowercased value, in its branch order), and the MMSP 0.5
 * client that speaks the same wire protocol: the 0.4 Gemini client spoke generateContent,
 * which the compatible `google-genai` client still does (and what the Penguin Go relay
 * serves); the rest became their vendor's official client. No 0.5 name matches any of these.
 */
const LEGACY_CLIENT_TYPES: readonly (readonly [RegExp, string])[] = [
  [/gemini-(3|embedding)/, "google-genai"],
  [/^(?=.*claude).*(4-[678]|-5)/, "anthropic-official"],
  [/gpt-(5\.[456]|6)/, "openai-official"],
  [/glm-5/, "zai-official"],
  [/kimi-k(3|2\.[56])/, "moonshot-official"],
  [/^minimax-m3$/, "minimax-official"],
  [/deepseek-v4/, "deepseek-official"],
];

/**
 * One-time migration of a parsed `.project_config.toml` table: MMSP 0.5.0 refuses the client
 * types AgentHub 0.4 accepted (`Unknown client type "gemini-3.8"`), so every `[[models]]` entry
 * carrying one is rewritten in place to the client that speaks the same wire protocol. Both
 * loaders — `loadProjectConfig` here and the server's `ProjectConfigService.readTable` — write
 * the table back the moment this returns true, so a file is rewritten once and an old name
 * that reappears later (a models PUT from a page opened before the upgrade, a machine sync
 * from an older install) is repaired at its next read. Nothing is written when nothing
 * matched. Entries the catalog has since unpinned (`deepseek/deepseek-flash`,
 * `minimax/MiniMax-M3`) come out pinned to their vendor's official client, which routes; the
 * Models page's "Restore defaults" puts the row and its group's table back to the catalog's,
 * which pins none. It runs first in migrateProjectConfigTable, so hoistProviderConnections
 * compares MMSP's names.
 *
 * Removal: at the 0.3.0 release preparation, by whoever prepares it, once its release notes
 * say a Project last opened before the release that shipped this migration must be opened once
 * on a 0.2.x release first. Takes out LEGACY_CLIENT_TYPES, this function, the write-back in the
 * two loaders, and their tests (core `state.test.ts`, server `models.test.ts`); see
 * changelog/unreleased/2026-10-01-backward-compatibility.md.
 */
export function migrateLegacyClientTypes(table: Record<string, unknown>): boolean {
  let changed = false;
  for (const entry of Array.isArray(table.models) ? table.models : []) {
    if (typeof entry !== "object" || entry === null) continue;
    const m = entry as { client_type?: unknown };
    if (typeof m.client_type !== "string") continue;
    const t = m.client_type.trim().toLowerCase();
    const replacement = LEGACY_CLIENT_TYPES.find(([legacy]) => legacy.test(t))?.[1];
    if (replacement !== undefined) {
      m.client_type = replacement;
      changed = true;
    }
  }
  return changed;
}

/** A TOML table: a plain object, not an array (smol-toml's dates are objects too, but never tables here). */
function isTable(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A non-blank string, or undefined: blank counts as absent everywhere a connection field is read. */
function presentString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** The latest of some ISO 8601 timestamps (unparseable ones lose), or undefined when there are none. */
function latestTimestamp(values: readonly unknown[]): string | undefined {
  let latest: string | undefined;
  for (const v of values) {
    if (typeof v !== "string" || v.trim() === "") continue;
    if (latest === undefined) {
      latest = v;
      continue;
    }
    const [t, l] = [Date.parse(v), Date.parse(latest)];
    if (Number.isNaN(l) || (!Number.isNaN(t) && t > l)) latest = v;
  }
  return latest;
}

/**
 * The value a field holds on every one of `rows`, by `same`, or undefined when a row lacks it
 * (absent or blank), two differ, or there are no rows.
 */
function unanimousField(
  rows: readonly Record<string, unknown>[],
  field: string,
  same: (a: string, b: string) => boolean,
): string | undefined {
  const values = rows.map((row) => presentString(row[field]));
  const first = values[0];
  if (first === undefined) return undefined;
  return values.every((v) => v !== undefined && same(v, first)) ? first : undefined;
}

/**
 * The value most of `rows` hold in a field, by `same`, when every row holds one: undefined
 * when a row lacks it (absent or blank), when two values tie for the most rows, or when there
 * are no rows. The first spelling met stands for its value.
 */
function pluralityField(
  rows: readonly Record<string, unknown>[],
  field: string,
  same: (a: string, b: string) => boolean,
): string | undefined {
  const tally: { value: string; count: number }[] = [];
  for (const row of rows) {
    const value = presentString(row[field]);
    if (value === undefined) return undefined;
    const seen = tally.find((t) => same(t.value, value));
    if (seen !== undefined) seen.count += 1;
    else tally.push({ value, count: 1 });
  }
  const [top, next] = [...tally].sort((a, b) => b.count - a.count);
  return top !== undefined && (next === undefined || next.count < top.count)
    ? top.value
    : undefined;
}

/**
 * One-time migration of a parsed `.project_config.toml` table to group-level connections.
 * Before `[providers.<id>]` existed, every preset row carried its own copy of the catalog's
 * protocol and endpoint, and every group write (Connect, Enter key, the Penguin Go and
 * ModelScope flows) copied one key onto each row of the group. Read as they are, the copies
 * would all be overrides: a group key written after the upgrade would never reach a row still
 * holding the old one. So, in place, per group the rows name — built-in or user-defined —
 * except `custom`, whose rows each reach their own endpoint and keep all three fields:
 *
 * - Base URL: when EVERY row of the group has one, the value most of them hold (strict
 *   plurality, by sameEndpoint; a tie moves nothing) becomes `[providers.<g>].base_url` and
 *   leaves the rows that held it; a row with another value keeps its own. A row with none
 *   blocks the move: it runs on the client's default endpoint, and following a group value
 *   would change that. (OpenCode Go: the Chat Completions base moves, the Messages rows keep
 *   theirs.)
 * - Protocol: only when every row has one and all are the same (sameClientType, in MMSP's
 *   names — migrateLegacyClientTypes runs first) does it move to the group, leaving every row.
 * - Key: when every row of the group that holds a key holds the same one, AND the group key
 *   would reach each of those rows once the base URL has moved (groupKeyReaches), it becomes
 *   `[providers.<g>].api_key` with `created_at` = the latest of those rows', and leaves them
 *   (with their `created_at`). Otherwise every row keeps its key: a key the group could not
 *   lend back would leave a row without one.
 *
 * The catalog is never read: a field no row had stays absent (old files always carried the
 * catalog's copies, so nothing is lost; a row that was already bare ran on the client's
 * defaults and still does). Every model keeps the base URL, protocol and key it ran on, except
 * that a keyless row the hoisted group key reaches now has it.
 *
 * Runs only on a table with no `providers` key at all — a file this release has never
 * written, since renderProjectConfigToml writes the key into every file — so it happens once
 * per file: a value the user later sets on one model is never mistaken for an old copy, and a
 * group key cleared while models keep their own is never hoisted back. Returns whether
 * anything changed; nothing is written for a table with nothing to move, and a second run on
 * the result finds nothing.
 *
 * Removal: at the 0.3.0 release preparation, by whoever prepares it, together with
 * migrateLegacyClientTypes — once its release notes say a Project last opened before the
 * release that shipped this migration must be opened once on a 0.2.x release first. Takes out
 * this function with unanimousField and pluralityField, its call in migrateProjectConfigTable
 * (and that wrapper with the other migration), the `providers` marker in
 * renderProjectConfigToml, and their tests (core `state.test.ts`, server `models.test.ts`); see
 * changelog/unreleased/2026-10-02-backward-compatibility.md.
 */
export function hoistProviderConnections(table: Record<string, unknown>): boolean {
  if (table.providers !== undefined) return false;
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of (Array.isArray(table.models) ? table.models : []).filter(isTable)) {
    if (typeof row.provider !== "string" || row.provider === "custom") continue;
    groups.set(row.provider, [...(groups.get(row.provider) ?? []), row]);
  }
  const hoisted: Record<string, ProviderConnection> = {};
  for (const [provider, rows] of groups) {
    const connection: ProviderConnection = {};
    const baseUrl = pluralityField(rows, "base_url", sameEndpoint);
    if (baseUrl !== undefined) {
      connection.base_url = baseUrl;
      for (const row of rows) {
        if (sameEndpoint(row.base_url as string, baseUrl)) delete row.base_url;
      }
    }
    const clientType = unanimousField(rows, "client_type", sameClientType);
    if (clientType !== undefined) {
      connection.client_type = canonicalClientType(clientType)!;
      for (const row of rows) delete row.client_type;
    }
    const keyed = rows.filter((row) => presentString(row.api_key) !== undefined);
    const key = keyed[0]?.api_key;
    if (
      typeof key === "string" &&
      keyed.every(
        (row) =>
          row.api_key === key && groupKeyReaches(presentString(row.base_url), connection.base_url),
      )
    ) {
      connection.api_key = key;
      const createdAt = latestTimestamp(keyed.map((row) => row.created_at));
      if (createdAt !== undefined) connection.created_at = createdAt;
      for (const row of keyed) {
        delete row.api_key;
        delete row.created_at;
      }
    }
    if (Object.keys(connection).length > 0) hoisted[provider] = connection;
  }
  if (Object.keys(hoisted).length === 0) return false;
  table.providers = hoisted;
  return true;
}

/**
 * Every one-time migration a parsed `.project_config.toml` table goes through, in order —
 * MMSP's client-type names first (migrateLegacyClientTypes), then the group-level connection
 * hoist (hoistProviderConnections), which compares the rows' protocols with each other in
 * MMSP's names. Both loaders — `loadProjectConfig` here and the server's
 * `ProjectConfigService.readTable` — call this and write the raw table back once when it
 * returns true. Removed with the two migrations at the 0.3.0 release preparation.
 */
export function migrateProjectConfigTable(table: Record<string, unknown>): boolean {
  const legacy = migrateLegacyClientTypes(table);
  const hoisted = hoistProviderConnections(table);
  return legacy || hoisted;
}

/**
 * Leniently parses the `[providers]` table: a value that is not a table reads as absent; a
 * member that is not a table is dropped, and so is one left with no field; each field is kept
 * only when a non-blank string, and `client_type` is normalized through canonicalClientType.
 * Undefined when no member remains — absent and empty mean the same: no group sets anything.
 * Exported for the server, which narrows its cached parse the same way.
 */
export function parseProviderTable(value: unknown): ProviderTable | undefined {
  if (!isTable(value)) return undefined;
  const out: ProviderTable = {};
  for (const [id, member] of Object.entries(value)) {
    if (id.trim() === "" || !isTable(member)) continue;
    const connection: ProviderConnection = {};
    const baseUrl = presentString(member.base_url);
    if (baseUrl !== undefined) connection.base_url = baseUrl;
    const apiKey = presentString(member.api_key);
    if (apiKey !== undefined) connection.api_key = apiKey;
    const clientType = presentString(member.client_type);
    if (clientType !== undefined) connection.client_type = canonicalClientType(clientType)!;
    const createdAt = presentString(member.created_at);
    if (createdAt !== undefined) connection.created_at = createdAt;
    if (Object.keys(connection).length > 0) out[id] = connection;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Leniently parses the `[default_chat]` block (new-chat defaults): each key is validated
 * independently and an invalid value (wrong type / unknown enum member / `"none"` as a
 * thinking level) drops that key rather than failing the load — the block only ever
 * prefills new chats, so bad data must never block reading the model table. Returns
 * undefined when the value is not a table or nothing valid remains (absent block =
 * the pre-existing behavior).
 */
function parseDefaultChat(value: unknown): ProjectChatDefaults | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const t = value as Record<string, unknown>;
  const out: ProjectChatDefaults = {};
  if (typeof t.agent_id === "string" && t.agent_id !== "") out.agent_id = t.agent_id;
  if (typeof t.workspace === "string" && t.workspace !== "") out.workspace = t.workspace;
  if (
    typeof t.approval_mode === "string" &&
    (CHAT_APPROVAL_MODES as readonly string[]).includes(t.approval_mode)
  ) {
    out.approval_mode = t.approval_mode as ChatApprovalMode;
  }
  if (
    typeof t.thinking_level === "string" &&
    (DEFAULT_CHAT_THINKING_LEVELS as readonly string[]).includes(t.thinking_level)
  ) {
    out.thinking_level = t.thinking_level as DefaultChatThinkingLevel;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Leniently parses the `[command_policy]` block (sandbox command policy): each key is
 * validated independently and an invalid value drops that key rather than failing the
 * load. A non-boolean `enabled` falls back to on (the safe direction); a `rules` value
 * that is not an array reads as absent, i.e. the factory set. A present array is the
 * literal list — invalid entries are dropped individually, which can narrow the deny set,
 * but the write paths validate up front and the file is never hand-edited by design, so
 * this only fires for hand-placed data.
 *
 * Exported for the server's ProjectConfigService, which holds a cached parse of the same
 * file — the same sharing rule as projectConfigFromTable, so the two paths can never
 * narrow the block differently.
 */
/** What a Project asks of one plugin. `version` absent (or `"*"` in the file) means whatever the deployment ships. */
export interface PluginRequirement {
  version?: string;
}

/** A plugin table: package name → what is asked of it, in the file's order. */
export type PluginTable = Record<string, PluginRequirement>;

/**
 * The whole `[plugins]` key: the table every machine runs, and each machine's own table.
 *
 *   [plugins]
 *   "@scope/everywhere" = "*"
 *
 *   [plugins.Xk3v9Qa_bT2mLp0z]
 *   "@scope/only-there" = "*"
 *   "@scope/everywhere" = "1.2.3"   # this machine's entry wins over the shared one
 *
 * A machine table is keyed by the machine's OWN id — the 16 characters its server mints on
 * first boot — never by an ssh alias, which a rename or a repointed host would silently move.
 * What a machine runs is `effectivePluginTable(tables, itsId)`: the shared table, plus its own
 * table, its own entry winning for a name both carry. A plugin listed only in a machine table
 * runs, and is installed, on that machine alone.
 */
export interface PluginTables {
  all: PluginTable;
  machines: Record<string, PluginTable>;
}

/** A machine's own id: 12 random bytes as base64url (the machines repo mints it). */
export const PLUGIN_MACHINE_ID = /^[A-Za-z0-9_-]{16}$/;

/**
 * Whether a `[plugins]` member is a machine's table rather than a plugin's requirement: a
 * key shaped like a machine id whose value is a table without `version`. The writer below
 * spells every requirement without fields as `"*"`, so a table of that shape is never one of
 * its requirements.
 */
function isMachineTable(key: string, value: unknown): boolean {
  return (
    PLUGIN_MACHINE_ID.test(key) &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !("version" in value)
  );
}

/**
 * Leniently parses one plugin table. An entry's value is a version requirement string
 * (`"*"` for any) or a table with an optional `version`; an entry of any other shape is
 * dropped rather than failing the load — a config whose plugin table is malformed still has
 * to open, or a typo there would take the Project's models with it. Machine tables inside
 * `[plugins]` are not entries of the shared table and are skipped (parsePluginTables reads
 * them). A value that is not a table at all (the list form this key had before it was a
 * table) reads as undefined: such a Project asks for no plugins until it is written again.
 */
export function parsePluginTable(value: unknown): PluginTable | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: PluginTable = {};
  for (const [rawName, spec] of Object.entries(value as Record<string, unknown>)) {
    const name = rawName.trim();
    if (name === "" || isMachineTable(name, spec)) continue;
    if (typeof spec === "string") {
      const version = spec.trim();
      out[name] = version === "" || version === "*" ? {} : { version };
      continue;
    }
    if (spec === null || typeof spec !== "object" || Array.isArray(spec)) continue;
    const version = (spec as { version?: unknown }).version;
    if (version !== undefined && typeof version !== "string") continue;
    out[name] =
      version === undefined || version.trim() === "" || version.trim() === "*"
        ? {}
        : { version: version.trim() };
  }
  return out;
}

/** Parses the whole `[plugins]` key, the shared table and every machine's; undefined when it is not a table. */
export function parsePluginTables(value: unknown): PluginTables | undefined {
  const all = parsePluginTable(value);
  if (all === undefined) return undefined;
  const machines: Record<string, PluginTable> = {};
  for (const [key, spec] of Object.entries(value as Record<string, unknown>)) {
    if (isMachineTable(key, spec)) machines[key] = parsePluginTable(spec) ?? {};
  }
  return { all, machines };
}

/**
 * What one machine runs: the shared table, then that machine's own entries — its requirement
 * replacing the shared one for a name both list. `machineId` null means a machine whose id is
 * not known (a machine no server has started on yet): the shared table alone.
 */
export function effectivePluginTable(tables: PluginTables, machineId: string | null): PluginTable {
  const own = machineId === null ? undefined : tables.machines[machineId];
  return own === undefined ? { ...tables.all } : { ...tables.all, ...own };
}

/** A plugin table as it is written: the string form wherever only a version is asked. */
export function pluginTableToToml(
  table: PluginTable,
): Record<string, string | { version?: string }> {
  return Object.fromEntries(Object.entries(table).map(([name, req]) => [name, req.version ?? "*"]));
}

/**
 * The whole `[plugins]` key as it is written: the shared entries, then one sub-table per
 * machine. A machine table left empty is dropped — "this machine adds nothing" is what its
 * absence already says.
 */
export function pluginTablesToToml(tables: PluginTables): Record<string, unknown> {
  const out: Record<string, unknown> = pluginTableToToml(tables.all);
  for (const [machineId, table] of Object.entries(tables.machines)) {
    if (Object.keys(table).length > 0) out[machineId] = pluginTableToToml(table);
  }
  return out;
}

export function parseCommandPolicy(value: unknown): CommandPolicyConfig | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const t = value as Record<string, unknown>;
  const out: CommandPolicyConfig = {};
  if (typeof t.enabled === "boolean") out.enabled = t.enabled;
  if (Array.isArray(t.rules)) {
    const rules: CommandPolicyRule[] = [];
    for (const entry of t.rules) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
      const r = entry as Record<string, unknown>;
      if (typeof r.name !== "string" || r.name === "") continue;
      if (typeof r.pattern !== "string" || r.pattern === "") continue;
      rules.push({
        name: r.name,
        pattern: r.pattern,
        ...(typeof r.description === "string" && r.description !== ""
          ? { description: r.description }
          : {}),
        ...(typeof r.enabled === "boolean" ? { enabled: r.enabled } : {}),
      });
    }
    out.rules = rules;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Narrows an already-parsed `.project_config.toml` table into a typed `ProjectConfig`
 * (`file` is used in error messages only). Shared by `loadProjectConfig` and callers that
 * hold a cached parse of the same file (the server's ProjectConfigService), so the two
 * paths can never validate differently.
 *
 * The return literal below rebuilds the config from **known keys only** — any new top-level
 * key must be added to `ProjectConfig` AND echoed here, or a load→save round trip (the CLI
 * path) silently drops it.
 */
export function projectConfigFromTable(
  file: string,
  parsed: Record<string, unknown>,
): ProjectConfig {
  const defaultModel = parseRefField(file, "default_model", parsed.default_model);
  const visionModel = parseRefField(file, "vision_model", parsed.vision_model);
  const defaultChat = parseDefaultChat(parsed.default_chat);
  const commandPolicy = parseCommandPolicy(parsed.command_policy);
  const plugins = parsePluginTables(parsed.plugins);
  const providers = parseProviderTable(parsed.providers);
  return {
    ...(parsed.name !== undefined ? { name: parsed.name as string } : {}),
    ...(defaultModel !== undefined ? { default_model: defaultModel } : {}),
    ...(visionModel !== undefined ? { vision_model: visionModel } : {}),
    ...(defaultChat !== undefined ? { default_chat: defaultChat } : {}),
    ...(commandPolicy !== undefined ? { command_policy: commandPolicy } : {}),
    ...(plugins !== undefined ? { plugins } : {}),
    ...(providers !== undefined ? { providers } : {}),
    models: ((parsed.models as unknown[] | undefined) ?? []).map((m) => assertModelEntry(file, m)),
  };
}

/**
 * Loads the Project config; returns the default config (without writing to disk) if
 * `.project_config.toml` doesn't exist. Returns plaintext (masking is applied at the interface
 * layer); reports a clear error when the old format (a string reference / an entry missing
 * provider) is read.
 */
export async function loadProjectConfig(root: string, projectId: string): Promise<ProjectConfig> {
  const file = projectConfigPath(root, projectId);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return defaultProjectConfig();
    throw err;
  }
  // Defensive: parseToml may return null/undefined for an empty file, and destructuring it would throw a TypeError.
  const table = (parseToml(raw) ?? {}) as Record<string, unknown>;
  // The raw table is written back, not the typed config, so every key the file carries
  // survives the rewrite (this loader keeps known keys only).
  if (migrateProjectConfigTable(table)) {
    await atomicWriteFile(file, renderProjectConfigToml(table), {
      mode: 0o600,
      followSymlinks: true,
    });
  }
  return projectConfigFromTable(file, table);
}

/** A TOML inline table for a paired reference (reuses smol-toml's string serialization, guaranteeing correct escaping). */
function tomlInlineRef(ref: ModelRef): string {
  const kv = (obj: Record<string, string>): string => stringifyToml(obj).trim();
  return `{ ${kv({ provider: ref.provider })}, ${kv({ model_id: ref.model_id })} }`;
}

/** Whether a value has the paired-reference shape ({ provider, model_id }, two string fields). */
function isModelRefShape(v: unknown): v is ModelRef {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return typeof o.provider === "string" && typeof o.model_id === "string";
}

/**
 * Renders the full text of `.project_config.toml` — the **single source of the write format
 * site-wide** (shared by core's saveProjectConfig and the interface layer's full-table write, to
 * avoid the same file ending up in two different formats).
 *
 * Paired references (default_model / vision_model) are rendered as a TOML inline table
 * `{ provider = "...", model_id = "..." }`; `models` is always
 * placed last, since any table header after `[[models]]` would be read as its sub-table. Unknown
 * extension fields are kept as-is.
 *
 * Same header rule for every other table-valued key (e.g. `[default_chat]`): once a table
 * header is emitted, any `key = value` line below it would be parsed back as a member of
 * that table — so entries whose serialization opens with a header are collected separately
 * and emitted after all top-level `key = value` lines (and still before `[[models]]`),
 * regardless of the object's key insertion order.
 *
 * `providers` is always written, as an empty `[providers]` table when no group sets
 * anything: its presence is how hoistProviderConnections knows the file was written by a
 * release that stores group keys there, and so never moves a model's own key onto its group.
 * Removed with that migration at the 0.3.0 release preparation.
 */
export function renderProjectConfigToml(data: Record<string, unknown>): string {
  const head: string[] = [];
  const tables: string[] = [];
  const providers = data.providers;
  const noProviders =
    providers === undefined || (isTable(providers) && Object.keys(providers).length === 0);
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || key === "models") continue;
    if (key === "providers" && noProviders) continue;
    if (isModelRefShape(value)) {
      head.push(`${key} = ${tomlInlineRef(value)}`);
      continue;
    }
    const rendered = stringifyToml({ [key]: value }).trim();
    // A rendering that opens with "[" is a table header ([key] / [[key]]) — defer it below
    // every top-level key = value line; plain lines (scalars, inline arrays) stay in place.
    (rendered.startsWith("[") ? tables : head).push(rendered);
  }
  if (noProviders) tables.push("[providers]");
  const models = stringifyToml({ models: Array.isArray(data.models) ? data.models : [] });
  // An empty list renders as a `models = []` line, which below a table header would be read
  // back as that table's member: it goes with the top-level lines instead.
  if (!models.trimStart().startsWith("[")) return [...head, models.trim(), ...tables].join("\n");
  return [...head, ...tables, models].join("\n");
}

/**
 * Saves the Project config: writes the full table to the single config file
 * `.project_config.toml`. The file contains secrets like api_key, so it's written to disk with
 * mode 0600 (a hidden file blocks `ls`, not reads); the atomic write applies that mode to every
 * replacement, so an existing file converges to it as well.
 */
export async function saveProjectConfig(
  root: string,
  projectId: string,
  cfg: ProjectConfig,
): Promise<void> {
  const file = projectConfigPath(root, projectId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const { plugins, ...rest } = cfg;
  const table = plugins === undefined ? rest : { ...rest, plugins: pluginTablesToToml(plugins) };
  // `providers` is already TOML-shaped (ProviderTable is the file's own spelling).
  await atomicWriteFile(file, renderProjectConfigToml(table), {
    mode: 0o600,
    followSymlinks: true,
  });
}

/** One of addModel's connection fields: omitted keeps the row's value, `null` or blank clears it. */
function ownField(
  value: string | null | undefined,
  existing: string | undefined,
): string | undefined {
  return value === undefined ? existing : presentString(value);
}

/**
 * Adds or updates a Model:
 * - Upserts into `models`, deduplicated by the `(provider, model_id)` pair — both halves are
 *   supplied by the caller, since the group is never guessed from the builtin catalog (a
 *   gateway reselling a vendor model keeps the vendor's upstream id, so a bare id names no
 *   single group, and guessing wrong files the caller's api_key under a vendor they never
 *   picked); a model outside every known group is added under `"custom"` explicitly;
 * - The row's own connection (`client_type` / `api_key` / `base_url`), per field: a value sets
 *   it, `null` or a blank string clears it (the row then follows its group's
 *   `[providers.<id>]` table, or with none the client's default), omitted keeps it; clearing
 *   `api_key` drops its `created_at` with it. Nothing is filled in from the catalog: a new
 *   row stores exactly what the caller gave;
 * - Set as the default Model (a paired reference) when `opts.setDefault` is true.
 * Reads the existing config (or the default), saves after the change, and returns the updated
 * config.
 */
export async function addModel(
  root: string,
  projectId: string,
  entry: {
    /** provider group (required; never inferred — pass `"custom"` for a model outside the known groups). */
    provider: string;
    /** Upstream model id (sent to MMSP unchanged). */
    model_id: string;
    context_window?: number;
    /** The row's own protocol; `null` or blank clears it, omitted keeps it. */
    client_type?: string | null;
    /** Whether image input is supported (vision/multimodal); keeps the existing value by default (treated as supported if never set). */
    vision?: boolean;
    /** Per-model max output tokens (wins over the Agent config); keeps the existing value by default (unset = inherit the Agent value). */
    max_tokens?: number;
    /** Per-model fast mode; keeps the existing value by default. Only `true` is persisted: an explicit `false` clears the annotation (absent = off). */
    fast_mode?: boolean;
    /** Price input may cover only some buckets; merged and written as a complete `ModelPricing`. */
    pricing?: Partial<ModelPricing>;
    /** The row's own key; `null` or blank clears it (with its `created_at`), omitted keeps it. */
    api_key?: string | null;
    /** The row's own endpoint; `null` or blank clears it, omitted keeps it. */
    base_url?: string | null;
  },
  opts?: { setDefault?: boolean },
): Promise<ProjectConfig> {
  const cfg = await loadProjectConfig(root, projectId);
  const { provider } = entry;

  // upsert: layers new fields on top of the existing entry; fields not explicitly provided
  // (e.g. context_window) keep their existing value, so a call like "just add an api_key"
  // doesn't wipe out the prior config.
  const idx = cfg.models.findIndex((m) => m.provider === provider && m.model_id === entry.model_id);
  const existing = idx >= 0 ? cfg.models[idx] : undefined;
  const modelEntry: ModelEntry = {
    provider,
    model_id: entry.model_id,
  };
  const contextWindow = entry.context_window ?? existing?.context_window;
  if (contextWindow !== undefined) {
    modelEntry.context_window = contextWindow;
  }
  // Normalized on write as well as on read (canonicalClientType), so a caller passing the
  // pre-0.4.2 "openai" spelling still persists the canonical "openai-chat".
  const clientType = canonicalClientType(ownField(entry.client_type, existing?.client_type));
  if (clientType !== undefined) {
    modelEntry.client_type = clientType;
  }
  // The display name and api_key write timestamp are not set by this function; kept as-is on upsert.
  if (existing?.display_name !== undefined) {
    modelEntry.display_name = existing.display_name;
  }
  const vision = entry.vision ?? existing?.vision;
  if (vision !== undefined) {
    modelEntry.vision = vision;
  }
  const maxTokens = entry.max_tokens ?? existing?.max_tokens;
  if (maxTokens !== undefined) {
    modelEntry.max_tokens = maxTokens;
  }
  // Only `true` is persisted (absent = off): an explicit `false` clears the stored annotation
  // instead of writing `fast_mode = false`, and a hand-edited `false` normalizes to absent.
  const fastMode = entry.fast_mode ?? existing?.fast_mode;
  if (fastMode === true) {
    modelEntry.fast_mode = true;
  }
  // The three price buckets are merged field by field: an unspecified bucket keeps its existing
  // value (the same policy as context_window/credential); the unit is fixed to usd_per_mtok, and
  // the complete pricing is written as long as any bucket is present.
  const mergedPricing: Partial<ModelPricing> = {
    ...existing?.pricing,
    ...entry.pricing,
  };
  if (
    mergedPricing.cache_read !== undefined ||
    mergedPricing.cache_write !== undefined ||
    mergedPricing.output !== undefined
  ) {
    modelEntry.pricing = {
      unit: "usd_per_mtok",
      cache_read: mergedPricing.cache_read ?? 0,
      cache_write: mergedPricing.cache_write ?? 0,
      output: mergedPricing.output ?? 0,
    };
  }
  // Inline credential entry: fields not provided keep their existing value, cleared ones go.
  const apiKey = ownField(entry.api_key, existing?.api_key);
  if (apiKey !== undefined) {
    modelEntry.api_key = apiKey;
  }
  const baseUrl = ownField(entry.base_url, existing?.base_url);
  if (baseUrl !== undefined) {
    modelEntry.base_url = baseUrl;
  }
  // The key's write time goes with a key the caller cleared, and stays otherwise.
  const keyCleared = entry.api_key !== undefined && apiKey === undefined;
  if (existing?.created_at !== undefined && !keyCleared) {
    modelEntry.created_at = existing.created_at;
  }
  if (idx >= 0) {
    cfg.models[idx] = modelEntry;
  } else {
    cfg.models.push(modelEntry);
  }

  if (opts?.setDefault) {
    cfg.default_model = { provider, model_id: entry.model_id };
  }

  await saveProjectConfig(root, projectId, cfg);
  return cfg;
}

/**
 * A change to one group's `[providers.<id>]` table. Per field: a non-blank string sets it,
 * `null` or a blank string clears it, absent keeps it. Setting `api_key` stamps `created_at`
 * with the write time; clearing it removes `created_at` with it.
 */
export interface ProviderConnectionPatch {
  base_url?: string | null;
  client_type?: string | null;
  api_key?: string | null;
}

/**
 * Applies a patch to one group's connection defaults and saves (load -> patch -> save; the
 * CLI's `config model add --provider <group>` without `--model-id`). A table left with no
 * field is dropped. Any group takes any field — Penguin Go's and OpenCode Go's included: a
 * row's own protocol always wins over its group's (effectiveConnection), so a group protocol
 * reaches only the rows that store none. Row overrides are never touched: a model with its
 * own value keeps it. Returns the saved config.
 */
export async function setProviderConnection(
  root: string,
  projectId: string,
  provider: string,
  patch: ProviderConnectionPatch,
): Promise<ProjectConfig> {
  const id = provider.trim();
  if (id === "") throw new Error("A provider id is required.");
  const cfg = await loadProjectConfig(root, projectId);
  const next: ProviderConnection = { ...cfg.providers?.[id] };
  if (patch.base_url !== undefined) {
    const value = presentString(patch.base_url);
    if (value === undefined) delete next.base_url;
    else next.base_url = value.trim();
  }
  if (patch.client_type !== undefined) {
    const value = presentString(patch.client_type);
    if (value === undefined) delete next.client_type;
    else next.client_type = canonicalClientType(value.trim())!;
  }
  if (patch.api_key !== undefined) {
    const value = presentString(patch.api_key);
    if (value === undefined) {
      delete next.api_key;
      delete next.created_at;
    } else {
      next.api_key = value.trim();
      next.created_at = new Date().toISOString();
    }
  }
  const providers: ProviderTable = { ...cfg.providers };
  if (Object.keys(next).length > 0) providers[id] = next;
  else delete providers[id];
  if (Object.keys(providers).length > 0) cfg.providers = providers;
  else delete cfg.providers;
  await saveProjectConfig(root, projectId, cfg);
  return cfg;
}

/**
 * Sets the default Model and saves. The target reference must exist in `models` (a reference
 * pointing outside the config would make createSession error immediately); throws otherwise.
 */
export async function setDefaultModel(
  root: string,
  projectId: string,
  ref: ModelRef,
): Promise<ProjectConfig> {
  const cfg = await loadProjectConfig(root, projectId);
  if (!getModel(cfg, ref)) {
    throw new Error(
      `default_model must point to a configured model: ${formatModelRef(ref)} is not in models. Use \`penguin config model list\` to see the configured models.`,
    );
  }
  cfg.default_model = { provider: ref.provider, model_id: ref.model_id };
  await saveProjectConfig(root, projectId, cfg);
  return cfg;
}

/**
 * Sets the vision model used to read images on behalf of read_file, and saves. The target
 * reference must exist in `models` and not be tagged `vision=false` (a model that doesn't support
 * images can't read on someone's behalf); throws otherwise.
 */
export async function setVisionModel(
  root: string,
  projectId: string,
  ref: ModelRef,
): Promise<ProjectConfig> {
  const cfg = await loadProjectConfig(root, projectId);
  const entry = getModel(cfg, ref);
  if (!entry) {
    throw new Error(
      `vision_model must point to a configured model: ${formatModelRef(ref)} is not in models. Use \`penguin config model list\` to see the configured models.`,
    );
  }
  if (entry.vision === false) {
    throw new Error(
      `vision_model cannot point to a model tagged as not supporting images: ${formatModelRef(ref)}.`,
    );
  }
  cfg.vision_model = { provider: ref.provider, model_id: ref.model_id };
  await saveProjectConfig(root, projectId, cfg);
  return cfg;
}

/**
 * Removes a Model and saves. Idempotent, like `removeVaultEntry`: a pair the config doesn't
 * have is not an error and writes nothing, so the caller decides whether a missing entry
 * deserves a message.
 *
 * `default_model` / `vision_model` are cleared when they named the removed entry. Leaving a
 * pointer behind would name a model that is no longer configured, which createSession rejects
 * outright — the same rule the models page applies when a row is deleted, kept on one behavior
 * so the CLI and the Web App never disagree about what a deletion leaves behind.
 */
export async function removeModel(
  root: string,
  projectId: string,
  ref: ModelRef,
): Promise<ProjectConfig> {
  const cfg = await loadProjectConfig(root, projectId);
  const idx = cfg.models.findIndex((m) => sameModelRef(m, ref));
  if (idx < 0) return cfg;
  cfg.models.splice(idx, 1);
  if (cfg.default_model && sameModelRef(cfg.default_model, ref)) {
    delete cfg.default_model;
  }
  if (cfg.vision_model && sameModelRef(cfg.vision_model, ref)) {
    delete cfg.vision_model;
  }
  await saveProjectConfig(root, projectId, cfg);
  return cfg;
}

/** Whether two paired references name the same entry. Both halves must match — the pair is the config's unique key. */
export function sameModelRef(a: ModelRef, b: ModelRef): boolean {
  return a.provider === b.provider && a.model_id === b.model_id;
}

/** Looks up a Model entry exactly by its `(provider, model_id)` paired reference; returns `undefined` if it doesn't exist. */
export function getModel(cfg: ProjectConfig, ref: ModelRef): ModelEntry | undefined {
  return cfg.models.find((m) => m.provider === ref.provider && m.model_id === ref.model_id);
}

/**
 * Validates a `(provider, model_id)` pair against the Project config and returns it as a
 * `ModelRef` (the **single validation entry point**, shared by core and CLI/server — never set
 * up a second one). Both halves are required: this only ever checks that the exact pair is
 * configured, it never searches for a group to attach to a bare `model_id`. A pair the config
 * doesn't have throws — a reference outside the config would leave credentials, pricing, and
 * the context window unavailable at request time.
 */
export function resolveModelRef(cfg: ProjectConfig, modelId: string, provider: string): ModelRef {
  const ref: ModelRef = { provider, model_id: modelId };
  if (!getModel(cfg, ref)) {
    throw new Error(
      `Model is not in the Project config: ${formatModelRef(ref)}. Use \`penguin config model list\` to see the configured models, or \`penguin config model add\` to add one.`,
    );
  }
  return ref;
}

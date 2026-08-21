/**
 * Project config storage (`<project>/.project_config.toml`).
 *
 * Records the available Models, the default Model, and each Model's credential (Model
 * is decoupled from Agent — the Model selection isn't stored in Agent State, but maintained by
 * the Project). Config is persisted as TOML.
 *
 * `.project_config.toml` is the Project's **single config file**: a hidden file (not shown by
 * default `ls`), written to disk with mode 0600; credentials (api_key / base_url) are **inlined
 * on the model entry** rather than split into a supplementary area and a separate secrets file.
 * It can only be read/written via the system interfaces (CLI / Web) — never hand-edited by the
 * model or the user; the system Prompt is forbidden from reading this file, `loadProjectConfig`
 * returns plaintext, and masking is applied at the interface layer (when shown by server / cli).
 *
 * Model references are **fully split into separate fields**: an entry stores
 * `provider` and `model_id` as two independent fields, with the `(provider, model_id)` pair as
 * the unique key — string concatenation like `<provider>/<id>` is forbidden anywhere in the
 * pipeline. `model_id` is the upstream request id, sent to AgentHub unchanged; `default_model` /
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
import type { CommandPolicyConfig, CommandPolicyRule, ThinkingLevelName } from "../interfaces.js";
import { DEFAULT_COMMAND_POLICY_RULES } from "../environment/command-policy-defaults.js";
import { canonicalClientType, presetModelEntries } from "./model-catalog.js";
import { projectConfigPath } from "./paths.js";

/** Model reference: a `(provider, model_id)` pair (never string-concatenated anywhere). */
export interface ModelRef {
  provider: string;
  /** Upstream model id (the request id sent to AgentHub unchanged). */
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
  /** Upstream model id: the actual request id sent to AgentHub, used paired with provider for display, pricing, and stats. */
  model_id: string;
  context_window?: number;
  /**
   * AgentHub client protocol (`openai-responses` / `ant-messages` / `openai-chat` /
   * `claude-4-8` / `deepseek-v4` / …); defaults to being inferred by AgentHub from the
   * request id (`model_id`). Third-party endpoints use one of the generic protocol clients:
   * `openai-responses` (OpenAI Responses API), `ant-messages` (Anthropic Messages API), or
   * `openai-chat` (OpenAI Chat Completions; the bare `openai` spelling from configs saved
   * before AgentHub 0.4.2's rename is normalized to it on read — see canonicalClientType).
   * The Web models page can detect which one a custom base URL serves.
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
   * scratchpad and handed over as a file path spliced into the text, and the image-reading tool
   * switches to describe_image (a vision model reads on its behalf) — the image never directly
   * enters that session's history.
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
   * Per-model fast mode (AgentHub UniConfig `fast_mode`): opts session requests into the
   * provider's faster serving tier at premium pricing (OpenAI-protocol clients send
   * `service_tier: "priority"`, Anthropic-protocol clients send `speed: "fast"`). Only `true`
   * is ever persisted; absent = off (the default). Models without a fast tier reject the
   * parameter (AgentHub raises UnsupportedParameterError), which ends the request with a
   * clear non-retried failure (see llm/generative-model.ts). User-only, never preset by the
   * builtin catalog.
   */
  fast_mode?: boolean;
  /** Pricing info; absent means this Model's cost isn't counted. */
  pricing?: ModelPricing;
  /** API key (inlined credential); left empty falls back to the vendor's environment variable. */
  api_key?: string;
  /** Custom base URL (inlined credential); preset for gateway models. */
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
 * Project-level config.
 * Docs: /docs/configuration § "Project config".
 */
export interface ProjectConfig {
  /** Project display name (the display name is separate from the id, shown as the id when unset). */
  name?: string;
  /** Paired reference to the default Model; must point to an entry in `models`. */
  default_model?: ModelRef;
  /**
   * The vision model used by read_image to read on behalf of a session model (when a session
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
  models: ModelEntry[];
}

/**
 * Returns the Project's default config: every entry from the preset builtin model catalog
 * (including context_window / pricing / vision tags and the preset base_url for gateway models,
 * with no keys included) — the user only needs to fill in an API key as needed (left empty falls
 * back to the vendor's environment variable).
 */
export function defaultProjectConfig(): ProjectConfig {
  return {
    default_model: { provider: "deepseek", model_id: "deepseek-v4-flash" },
    // The factory command-policy rules are seeded like the model presets: copied into the
    // new project's config and owned by it from then on — later factory changes never
    // rewrite an existing file. Spread to keep the module-level constant frozen.
    command_policy: { rules: DEFAULT_COMMAND_POLICY_RULES.map((r) => ({ ...r })) },
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
  // Backward compatibility for configs saved before AgentHub 0.4.2 renamed the generic Chat
  // Completions client: a stored `client_type = "openai"` is normalized to the canonical
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
  return {
    ...(parsed.name !== undefined ? { name: parsed.name as string } : {}),
    ...(defaultModel !== undefined ? { default_model: defaultModel } : {}),
    ...(visionModel !== undefined ? { vision_model: visionModel } : {}),
    ...(defaultChat !== undefined ? { default_chat: defaultChat } : {}),
    ...(commandPolicy !== undefined ? { command_policy: commandPolicy } : {}),
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
  return projectConfigFromTable(file, (parseToml(raw) ?? {}) as Record<string, unknown>);
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
 */
export function renderProjectConfigToml(data: Record<string, unknown>): string {
  const head: string[] = [];
  const tables: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || key === "models") continue;
    if (isModelRefShape(value)) {
      head.push(`${key} = ${tomlInlineRef(value)}`);
      continue;
    }
    const rendered = stringifyToml({ [key]: value }).trim();
    // A rendering that opens with "[" is a table header ([key] / [[key]]) — defer it below
    // every top-level key = value line; plain lines (scalars, inline arrays) stay in place.
    (rendered.startsWith("[") ? tables : head).push(rendered);
  }
  const models = Array.isArray(data.models) ? data.models : [];
  return [...head, ...tables, stringifyToml({ models })].join("\n");
}

/**
 * Saves the Project config: writes the full table to the single config file
 * `.project_config.toml`. The file contains secrets like api_key, so it's written to disk with
 * mode 0600 (a hidden file blocks `ls`, not reads; mode only takes effect on creation, so chmod
 * converges an existing file too).
 */
export async function saveProjectConfig(
  root: string,
  projectId: string,
  cfg: ProjectConfig,
): Promise<void> {
  const file = projectConfigPath(root, projectId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, renderProjectConfigToml({ ...cfg }), {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.chmod(file, 0o600);
}

/**
 * Adds or updates a Model:
 * - Upserts into `models`, deduplicated by the `(provider, model_id)` pair — both halves are
 *   supplied by the caller, since the group is never guessed from the builtin catalog (a
 *   gateway reselling a vendor model keeps the vendor's upstream id, so a bare id names no
 *   single group, and guessing wrong files the caller's api_key under a vendor they never
 *   picked); a model outside every known group is added under `"custom"` explicitly;
 * - If `api_key`/`base_url` are provided, they're written inline into the entry;
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
    /** Upstream model id (sent to AgentHub unchanged). */
    model_id: string;
    context_window?: number;
    client_type?: string;
    /** Whether image input is supported (vision/multimodal); keeps the existing value by default (treated as supported if never set). */
    vision?: boolean;
    /** Per-model max output tokens (wins over the Agent config); keeps the existing value by default (unset = inherit the Agent value). */
    max_tokens?: number;
    /** Per-model fast mode; keeps the existing value by default. Only `true` is persisted: an explicit `false` clears the annotation (absent = off). */
    fast_mode?: boolean;
    /** Price input may cover only some buckets; merged and written as a complete `ModelPricing`. */
    pricing?: Partial<ModelPricing>;
    api_key?: string;
    base_url?: string;
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
  const clientType = canonicalClientType(entry.client_type ?? existing?.client_type);
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
  // Inline credential entry: fields not provided keep their existing value.
  const apiKey = entry.api_key ?? existing?.api_key;
  if (apiKey !== undefined) {
    modelEntry.api_key = apiKey;
  }
  const baseUrl = entry.base_url ?? existing?.base_url;
  if (baseUrl !== undefined) {
    modelEntry.base_url = baseUrl;
  }
  if (existing?.created_at !== undefined) {
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
 * Sets the vision model used to read images on behalf of read_image, and saves. The target
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
  const idx = cfg.models.findIndex((m) => sameRef(m, ref));
  if (idx < 0) return cfg;
  cfg.models.splice(idx, 1);
  if (cfg.default_model && sameRef(cfg.default_model, ref)) {
    delete cfg.default_model;
  }
  if (cfg.vision_model && sameRef(cfg.vision_model, ref)) {
    delete cfg.vision_model;
  }
  await saveProjectConfig(root, projectId, cfg);
  return cfg;
}

/** Whether two paired references name the same entry. Both halves must match — the pair is the config's unique key. */
function sameRef(a: ModelRef, b: ModelRef): boolean {
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

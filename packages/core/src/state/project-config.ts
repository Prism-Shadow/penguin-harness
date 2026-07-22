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
import type { ThinkingLevelName } from "../interfaces.js";
import { presetModelEntries } from "./model-catalog.js";
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
   * AgentHub client protocol (`openai` / `claude-4-8` / `deepseek-v4` / …); defaults to being
   * inferred by AgentHub from the request id (`model_id`). A third-party model speaking the
   * OpenAI protocol should set this to `openai`.
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
   * Per-model thinking level: when set it wins over the Agent's
   * `system_config.model.thinking_level` (thinking capability is a model trait — e.g. a local
   * model served without thinking, or a dedicated reasoner). Unset = inherit the Agent value.
   * User-only, never preset by the builtin catalog.
   */
  thinking_level?: ThinkingLevelName;
  /**
   * Per-model max output tokens (the request's output cap, i.e. GenerativeModelConfig.maxTokens):
   * when set it wins over the Agent's `system_config.model.max_tokens` — the fit is a model trait
   * (the seeded per-Agent default of 32000 cannot fit into e.g. a 32768-token context window
   * together with any prompt, and the upstream rejects the request outright). Unset = inherit
   * the Agent value. User-only, never preset by the builtin catalog.
   */
  max_tokens?: number;
  /** Pricing info; absent means this Model's cost isn't counted. */
  pricing?: ModelPricing;
  /** API key (inlined credential); left empty falls back to the vendor's environment variable. */
  api_key?: string;
  /** Custom base URL (inlined credential); preset for gateway models. */
  base_url?: string;
  /** api_key's write timestamp (ISO 8601; a display field maintained by the interface layer). */
  created_at?: string;
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
    default_model: { provider: "deepseek", model_id: "deepseek-v4-pro" },
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
  const m = entry as { provider?: unknown; model_id?: unknown };
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
  return entry as ModelEntry;
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
  const parsed = (parseToml(raw) ?? {}) as Record<string, unknown>;
  const defaultModel = parseRefField(file, "default_model", parsed.default_model);
  const visionModel = parseRefField(file, "vision_model", parsed.vision_model);
  return {
    ...(parsed.name !== undefined ? { name: parsed.name as string } : {}),
    ...(defaultModel !== undefined ? { default_model: defaultModel } : {}),
    ...(visionModel !== undefined ? { vision_model: visionModel } : {}),
    models: ((parsed.models as unknown[] | undefined) ?? []).map((m) => assertModelEntry(file, m)),
  };
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
 */
export function renderProjectConfigToml(data: Record<string, unknown>): string {
  const head: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || key === "models") continue;
    head.push(
      isModelRefShape(value)
        ? `${key} = ${tomlInlineRef(value)}`
        : stringifyToml({ [key]: value }).trim(),
    );
  }
  const models = Array.isArray(data.models) ? data.models : [];
  return [...head, stringifyToml({ models })].join("\n");
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
    /** Per-model thinking level (wins over the Agent config); keeps the existing value by default (unset = inherit the Agent value). */
    thinking_level?: ThinkingLevelName;
    /** Per-model max output tokens (wins over the Agent config); keeps the existing value by default (unset = inherit the Agent value). */
    max_tokens?: number;
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
  const clientType = entry.client_type ?? existing?.client_type;
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
  const thinkingLevel = entry.thinking_level ?? existing?.thinking_level;
  if (thinkingLevel !== undefined) {
    modelEntry.thinking_level = thinkingLevel;
  }
  const maxTokens = entry.max_tokens ?? existing?.max_tokens;
  if (maxTokens !== undefined) {
    modelEntry.max_tokens = maxTokens;
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

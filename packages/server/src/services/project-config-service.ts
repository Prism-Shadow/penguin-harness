/**
 * `.project_config.toml` read/write (single hidden config file).
 *
 * Doesn't reuse core's loadProjectConfig/saveProjectConfig (they only keep known
 * fields): reads and writes the complete object directly via smol-toml, preserving
 * extension fields like `name`. credential (api_key / base_url / created_at) is
 * **inlined on the model entry** — there's no longer a supplementary section or
 * secrets file; since the file contains secrets, it's always written with mode
 * 0600. Plaintext only ever hits disk, and is always masked in responses.
 *
 * Model references are **fully split into separate fields**: an entry is
 * stored as two independent fields, `provider` and `model_id`; the `(provider,
 * model_id)` pair is the entry's unique key. `model_id` is the upstream request id,
 * sent to AgentHub verbatim — string concatenation like `<provider>/<id>` is
 * forbidden everywhere in the pipeline. `default_model` / `vision_model` are `{
 * provider, model_id }` paired references (TOML tables).
 *
 * Reads are memoized on the file's mtime (see readTable): every consumer of this
 * service — scheduler model-ref validation, the models/schedules routes, usage
 * pricing — shares one parsed table per on-disk version instead of re-reading and
 * re-parsing the TOML per call. The service's own writes all funnel through
 * `writeRaw`, which invalidates synchronously; external edits (CLI, hand edits) are
 * caught by the stat. The cached table is shared between callers and must be treated
 * as immutable — every mutating method here copies before changing.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  CHAT_APPROVAL_MODES,
  atomicWriteFile,
  DEFAULT_CHAT_THINKING_LEVELS,
  DEFAULT_COMMAND_POLICY_RULES,
  effectiveCommandPolicyRules,
  parseCommandPolicy,
  GenerativeModel,
  canonicalClientType,
  listEndpointModels as coreListEndpointModels,
  catalogEntryFor,
  defaultProjectConfig,
  imageUrlMessage,
  projectConfigFromTable,
  projectConfigPath,
  renderProjectConfigToml,
  resolveModelEnv,
  userText,
} from "@prismshadow/penguin-core";
import { providerInfo } from "@prismshadow/penguin-core/model-catalog";
import type {
  CommandPolicyRule,
  LLMOutcome,
  ModelRef,
  OmniMessage,
  ProjectConfig,
} from "@prismshadow/penguin-core";
import type {
  ChatDefaultsDto,
  CommandPolicyDto,
  CommandPolicyRuleDto,
  EndpointModelListRequest,
  EndpointModelListResponse,
  ModelInfo,
  ModelPricingDto,
  ModelProtocolDetectRequest,
  ModelProtocolDetectResponse,
  ModelRefDto,
  ModelsResponse,
  ModelsUpdateRequest,
  ModelTestRequest,
  ModelTestResponse,
  ModelVisionDetectRequest,
  ModelVisionDetectResponse,
} from "../api/types.js";
import { badRequest } from "../http/validate.js";
import { cacheable } from "../internal/mtime-gate.js";
import { detectModelProtocol } from "./protocol-detect.js";
import {
  VISION_PROBE_IMAGE,
  VISION_PROBE_MAX_TOKENS,
  VISION_PROBE_PROMPT,
  VISION_PROBE_TIMEOUT_MS,
  classifyVisionProbe,
  classifyVisionProbeError,
} from "./vision-detect.js";
import type { PricingRates } from "./usage-service.js";

type RawTable = Record<string, unknown>;

/**
 * API key masking: length <=12 -> `***`, otherwise `first4…last4`; plaintext is
 * never sent to the client. The 12-char threshold: `first4…last4` exposes 8
 * characters, which for a 9-12 character short secret would leak more than half of
 * it, so those are masked in full instead.
 */
export function maskApiKey(key: string): string {
  if (key.length <= 12) return "***";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/**
 * Whether a model's env fallback is *first-party*: the entry points at the provider's own
 * official endpoint, so consulting the vendor variable (ANTHROPIC_API_KEY, …) is the intended
 * configuration and its value may be previewed masked. Excluded — no detection, no preview:
 *
 * - gateway groups (they resell through generic OpenAI-protocol clients whose fallback is
 *   OPENAI_API_KEY, the *official OpenAI* variable; steering it to a reseller endpoint is
 *   exactly the misconfiguration the preview must not encourage) and the custom group;
 * - user-defined groups (not in MODEL_PROVIDERS at all);
 * - any entry re-pointed away from the official shape: a catalog preset whose client_type or
 *   base_url differs from the catalog's own values, or an off-catalog vendor-group entry that
 *   pins either (a bare auto-routed id targets the vendor's first-party client and stays in).
 *
 * `envKey` itself is still reported for every routable entry — this gate governs only the
 * presence preview.
 */
export function envFallbackFirstParty(entry: {
  provider: string;
  modelId: string;
  clientType: string | undefined;
  baseUrl: string | undefined;
}): boolean {
  const group = providerInfo(entry.provider);
  if (group === undefined || group.id === "custom" || group.gatewayBaseUrl !== undefined) {
    return false;
  }
  const cat = catalogEntryFor(entry.provider, entry.modelId);
  if (cat !== undefined) {
    return (
      canonicalClientType(entry.clientType) === canonicalClientType(cat.clientType) &&
      entry.baseUrl === cat.baseUrl
    );
  }
  return entry.clientType === undefined && entry.baseUrl === undefined;
}

function asTable(v: unknown): RawTable {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as RawTable) : {};
}

function asArray(v: unknown): RawTable[] {
  return Array.isArray(v) ? v.map(asTable) : [];
}

function optNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function optStr(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

/** Command-policy rules as DTOs: per-rule `enabled` made explicit (stored absence = on). */
function toCommandPolicyRuleDtos(rules: readonly CommandPolicyRule[]): CommandPolicyRuleDto[] {
  return rules.map((r) => ({
    name: r.name,
    pattern: r.pattern,
    ...(r.description !== undefined ? { description: r.description } : {}),
    enabled: r.enabled !== false,
  }));
}

/** Leniently reads a paired reference table (default_model / vision_model); returns undefined on a shape mismatch (including the old string format). */
function optRef(v: unknown): ModelRef | undefined {
  const t = asTable(v);
  const provider = optStr(t.provider);
  const modelId = optStr(t.model_id);
  return provider !== undefined && modelId !== undefined
    ? { provider, model_id: modelId }
    : undefined;
}

/** Whether an entry matches a paired reference (the entry's provider / model_id fields must be strings). */
function entryMatches(m: RawTable, provider: string, modelId: string): boolean {
  return m.provider === provider && m.model_id === modelId;
}

/** In-process Map/Set key for a paired reference (\0-separated to avoid concatenation ambiguity; never persisted, not an id format). */
function refKey(provider: string, modelId: string): string {
  return `${provider}\0${modelId}`;
}

/** Display form of a paired reference (for error messages; display only, not a storage format). */
function showRef(provider: string, modelId: string): string {
  return `(provider=${provider}, model_id=${modelId})`;
}

/**
 * Connectivity probe prompt: asks for one word, so the whole exchange fits in a
 * single-digit output budget. The wording discourages reasoning and the trailing empty
 * <think></think> makes many reasoning models treat their thinking phase as already
 * closed - keeping the probe's tiny budget on actual output instead of burning it on
 * thinking.
 */
const PROBE_PROMPT =
  'ping - reply with the single word "pong" and nothing else. Do not think or explain.\n<think></think>';

/**
 * Endpoint model-listing bound: the SDK paginates `/models` under the hood, so one slow
 * or endless gateway must not pin the add-group dialog — 20s matches the connectivity
 * test's request timeout.
 */
const LIST_MODELS_TIMEOUT_MS = 20_000;

/**
 * Speed probe prompt: a one-word answer can't be timed (a compliant model emits 1-3
 * tokens, and the window is then dominated by the final usage chunk's round trip), so
 * speed mode asks for something long enough to run into its raised cap. Counting to 50 is
 * deterministic and needs no knowledge, so every model produces the same token stream at
 * its own decoding rate. Carries the same anti-thinking hint as the connectivity prompt.
 */
const SPEED_PROBE_PROMPT =
  "Count from 1 to 50 as a comma-separated list, and nothing else. Do not think or explain.\n<think></think>";

export class ProjectConfigService {
  /**
   * Parsed-table cache, one entry per Project, keyed by the config file's mtime as
   * recorded at read time (a fresh mtime is stored as a never-matching sentinel, see
   * mtime-gate). A repeat read while the stat still matches costs one stat and zero
   * parses; a mismatch (external edit) or a service write (writeRaw deletes the
   * entry) falls back to a full read.
   */
  private readonly cache = new Map<string, { mtimeMs: number; table: RawTable }>();

  constructor(private readonly root: string) {}

  private filePath(projectId: string): string {
    return projectConfigPath(this.root, projectId);
  }

  /**
   * When the Project config (models/credentials) last changed: the config file's mtime as
   * ISO — an honest persistent source that survives server restarts (every models update
   * rewrites the file). undefined when the file doesn't exist yet.
   */
  private async configUpdatedAt(projectId: string): Promise<string | undefined> {
    try {
      const st = await fs.stat(this.filePath(projectId));
      return st.mtime.toISOString();
    } catch {
      return undefined;
    }
  }

  /** Reads the raw TOML object; returns an empty object if the file doesn't exist (does not write to disk). */
  async readRaw(projectId: string): Promise<RawTable> {
    return (await this.readTable(projectId)) ?? {};
  }

  /**
   * mtime-gated read of the parsed table; null when the file doesn't exist (readRaw
   * flattens that to `{}`, loadConfig to the preset default config — the two
   * pre-existing missing-file behaviors). Serving the shared cached object is safe
   * because no consumer mutates it (see the class header).
   */
  private async readTable(projectId: string): Promise<RawTable | null> {
    const file = this.filePath(projectId);
    let mtimeMs: number;
    try {
      mtimeMs = (await fs.stat(file)).mtimeMs;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      this.cache.delete(projectId); // Config deleted (or the whole Project): drop the stale entry.
      return null;
    }
    const cached = this.cache.get(projectId);
    if (cached && cached.mtimeMs === mtimeMs) return cached.table;
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      this.cache.delete(projectId); // Vanished between stat and read: same as never existing.
      return null;
    }
    const table = asTable(parseToml(raw));
    this.cache.set(projectId, { mtimeMs: cacheable(mtimeMs), table });
    return table;
  }

  /**
   * Typed view of the same cached table — byte-for-byte the semantics of core's
   * `loadProjectConfig` (missing file → preset default config; legacy format → the
   * same error, via core's shared narrowing) without its per-call readFile + parse.
   * Serves the scheduler's model-ref validation (see schedule-store).
   */
  async loadConfig(projectId: string): Promise<ProjectConfig> {
    const table = await this.readTable(projectId);
    if (table === null) return defaultProjectConfig();
    return projectConfigFromTable(this.filePath(projectId), table);
  }

  /**
   * Writes the whole object to disk: the file inlines secrets like api_key, always
   * written with mode 0600, and replaced atomically so a crash mid-write cannot
   * truncate it — matching core's saveProjectConfig behavior.
   */
  async writeRaw(projectId: string, data: RawTable): Promise<void> {
    const file = this.filePath(projectId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Rendering goes through core's single writer: paired references become inline
    // tables, models is placed last — matching the CLI's output format exactly
    // (the same file should never have two formats).
    await atomicWriteFile(file, renderProjectConfigToml(data), {
      mode: 0o600,
      followSymlinks: true,
    });
    // Every service write funnels through here: invalidate synchronously so the next
    // read re-parses (external writers are caught by readTable's stat instead).
    this.cache.delete(projectId);
  }

  /**
   * Initial config for a newly created Project: display name + preset built-in
   * model catalog (the default model and all preset entries, sourced from the same
   * core defaultProjectConfig; a gateway model's base_url is already inlined on the
   * entry, with no key); users only need to fill in an API key as needed (leave it
   * blank to fall back to the provider's environment variable).
   */
  async writeInitialConfig(projectId: string, name: string): Promise<void> {
    const preset = defaultProjectConfig();
    await this.writeRaw(projectId, {
      name,
      ...(preset.default_model !== undefined ? { default_model: preset.default_model } : {}),
      // The factory command-policy rules are seeded exactly like the model presets:
      // copied in at creation, owned by the project from then on.
      ...(preset.command_policy !== undefined ? { command_policy: preset.command_policy } : {}),
      models: preset.models,
    });
  }

  /**
   * Backfills preset models (for onboarding an existing Project, e.g. the
   * `default_project` shared with the CLI when the first user is onboarded — its
   * directory already existed and never went through `writeInitialConfig`, so it
   * previously had no models and no default model).
   *
   * **Only backfills when there are no models at all**: a Project that already has
   * models configured (via the CLI or edited by the user) is left as-is, and its
   * other fields (name, etc.) are preserved too — existing config is never
   * overwritten.
   */
  async ensurePresetModels(projectId: string): Promise<void> {
    const raw = await this.readRaw(projectId);
    if (asArray(raw.models).length > 0) return;
    const preset = defaultProjectConfig();
    await this.writeRaw(projectId, {
      ...raw,
      // Also reset to the preset default_model if the existing one points at a now-deleted model, to keep the default model valid.
      ...(preset.default_model !== undefined ? { default_model: preset.default_model } : {}),
      models: preset.models,
    });
  }

  /** Project display name (the toml's name; returns undefined if unset, the frontend falls back to displaying the id). */
  async getName(projectId: string): Promise<string | undefined> {
    const raw = await this.readRaw(projectId);
    return typeof raw.name === "string" ? raw.name : undefined;
  }

  /**
   * Rewrites the display name, preserving every other field (models, credentials, default
   * model): read-modify-write of the same toml, like ensurePresetModels. The id itself is
   * immutable — only this label changes.
   */
  async setName(projectId: string, name: string): Promise<void> {
    const raw = await this.readRaw(projectId);
    await this.writeRaw(projectId, { ...raw, name });
  }

  /** Paired reference of the default Model; returns undefined if unconfigured (or in the old string format). */
  async getDefaultModelRef(projectId: string): Promise<ModelRef | undefined> {
    const raw = await this.readRaw(projectId);
    return optRef(raw.default_model);
  }

  /**
   * Sets the default Model to an already-configured entry (the narrow
   * PUT /models/default route): rewrites only the top-level `default_model` — the SAME key
   * the models page's whole-table PUT maintains, so the two surfaces stay single-sourced —
   * preserving every other field via read-modify-write. The pair must name an entry in
   * `models` (the identical rule updateModels applies to `defaultModel`); a reference
   * outside the config is a 400, since createSession would error on it immediately. No
   * runtime invalidation: existing Sessions pin their model at creation, and this route
   * never touches credentials.
   */
  async setDefaultModelRef(projectId: string, ref: ModelRefDto): Promise<ModelRefDto> {
    const raw = await this.readRaw(projectId);
    if (!asArray(raw.models).some((m) => entryMatches(m, ref.provider, ref.modelId))) {
      throw badRequest(
        `defaultModel must be included in models: ${showRef(ref.provider, ref.modelId)}.`,
      );
    }
    await this.writeRaw(projectId, {
      ...raw,
      default_model: { provider: ref.provider, model_id: ref.modelId },
    });
    return { provider: ref.provider, modelId: ref.modelId };
  }

  /**
   * New-chat defaults (`[default_chat]`): read leniently — same tolerance as core's
   * loadProjectConfig (an invalid value drops that key; a missing/malformed block reads as
   * empty). Members may read; only the fields present in the file appear in the DTO.
   */
  async getChatDefaults(projectId: string): Promise<ChatDefaultsDto> {
    const raw = await this.readRaw(projectId);
    const t = asTable(raw.default_chat);
    const agentId = optStr(t.agent_id);
    const workspace = optStr(t.workspace);
    const approval = optStr(t.approval_mode);
    const thinking = optStr(t.thinking_level);
    return {
      ...(agentId !== undefined ? { agentId } : {}),
      ...(workspace !== undefined ? { workspace } : {}),
      ...(approval !== undefined && (CHAT_APPROVAL_MODES as readonly string[]).includes(approval)
        ? { approvalMode: approval as ChatDefaultsDto["approvalMode"] }
        : {}),
      ...(thinking !== undefined &&
      (DEFAULT_CHAT_THINKING_LEVELS as readonly string[]).includes(thinking)
        ? { thinkingLevel: thinking as ChatDefaultsDto["thinkingLevel"] }
        : {}),
    };
  }

  /**
   * Replaces the whole `[default_chat]` block (declarative PUT: an omitted key clears it;
   * an empty request removes the block entirely, restoring the pre-existing behavior).
   * Field validation (enums / agent existence) happens at the route; this is a
   * read-modify-write like setName — every other field (models, credentials, name, the
   * default model) is preserved. Returns the stored block as re-read from disk.
   */
  async setChatDefaults(projectId: string, req: ChatDefaultsDto): Promise<ChatDefaultsDto> {
    const raw = await this.readRaw(projectId);
    const block: RawTable = {
      ...(req.agentId !== undefined ? { agent_id: req.agentId } : {}),
      ...(req.workspace !== undefined ? { workspace: req.workspace } : {}),
      ...(req.approvalMode !== undefined ? { approval_mode: req.approvalMode } : {}),
      ...(req.thinkingLevel !== undefined ? { thinking_level: req.thinkingLevel } : {}),
    };
    const next: RawTable = { ...raw };
    if (Object.keys(block).length > 0) next.default_chat = block;
    else delete next.default_chat;
    await this.writeRaw(projectId, next);
    return this.getChatDefaults(projectId);
  }

  /**
   * Sandbox command policy (`[command_policy]`): read leniently, mirroring core's
   * loadProjectConfig tolerance — a non-boolean `enabled` reads as true (the default), a
   * rule missing name or pattern is dropped, and an absent (or non-array) `rules` value
   * serves the factory set: a project from before the block was seeded behaves as the
   * defaults until its first saved edit materializes them. The factory set also rides
   * along as `defaultRules` for the settings UI's "restore defaults".
   */
  async getCommandPolicy(projectId: string): Promise<CommandPolicyDto> {
    const raw = await this.readRaw(projectId);
    // Core's shared narrowing + the single "absent = factory set" fallback: this GET can
    // never disagree with what the Environment snapshot will enforce.
    const policy = parseCommandPolicy(raw.command_policy);
    return {
      enabled: policy?.enabled !== false,
      rules: toCommandPolicyRuleDtos(effectiveCommandPolicyRules(policy)),
      defaultRules: toCommandPolicyRuleDtos(DEFAULT_COMMAND_POLICY_RULES),
    };
  }

  /**
   * Replaces the `[command_policy]` block (declarative PUT, validated at the route). A PUT
   * always materializes the full rule list into the file — model-presets style: once
   * written, later factory changes never rewrite it — storing per field only what departs
   * from the defaults (`enabled = false`, a rule's `enabled = false`, a non-empty
   * description). Read-modify-write like setChatDefaults, preserving every other key.
   * Returns the block as re-read.
   */
  async setCommandPolicy(
    projectId: string,
    req: {
      enabled?: boolean;
      rules: { name: string; pattern: string; description?: string; enabled?: boolean }[];
    },
  ): Promise<CommandPolicyDto> {
    const raw = await this.readRaw(projectId);
    const block: RawTable = {};
    if (req.enabled === false) block.enabled = false;
    block.rules = req.rules.map((r) => ({
      name: r.name,
      pattern: r.pattern,
      ...(r.description !== undefined && r.description !== ""
        ? { description: r.description }
        : {}),
      ...(r.enabled === false ? { enabled: false } : {}),
    }));
    await this.writeRaw(projectId, { ...raw, command_policy: block });
    return this.getCommandPolicy(projectId);
  }

  /** Pricing lookup for usage-recorder: the current pricing for this paired reference (undefined if none -> cost is NULL). */
  async getPricing(
    projectId: string,
    provider: string,
    modelId: string,
  ): Promise<PricingRates | undefined> {
    const raw = await this.readRaw(projectId);
    const entry = asArray(raw.models).find((m) => entryMatches(m, provider, modelId));
    const pricing = entry ? asTable(entry.pricing) : {};
    const cacheRead = optNum(pricing.cache_read);
    const cacheWrite = optNum(pricing.cache_write);
    const output = optNum(pricing.output);
    if (cacheRead === undefined && cacheWrite === undefined && output === undefined) {
      return undefined;
    }
    return { cacheRead: cacheRead ?? 0, cacheWrite: cacheWrite ?? 0, output: output ?? 0 };
  }

  /**
   * Model connectivity test: the model reference `(provider, modelId)` is submitted
   * as a pair in the request body; sends one minimal request using that model's
   * config (optionally overridden with an unsaved apiKey / baseUrl) — no tools, no
   * system prompt, thinking at the lowest level, a tiny output cap, 20s timeout —
   * just to see whether the endpoint answers. The model id sent to AgentHub is
   * `modelId` itself (the upstream id verbatim; client_type inference follows it).
   *
   * A reasoning-heavy model can spend the whole tiny output cap on thinking
   * (finish_reason=length with no text — AgentHub raises EmptyResponseError,
   * collapsed to a malformed outcome): the endpoint demonstrably streamed model
   * output, which is everything a connectivity test proves, so that case counts as
   * ok too (see probeVerdict).
   *
   * Never throws: the LLM layer collapses auth/parameter/network errors into an
   * `LLMOutcome`, which is translated here into ok / message. Consumes very few
   * Tokens (single-digit output; speed mode spends up to its 64-token cap to have a
   * window worth timing), and writes no Trace and records no usage.
   */
  /**
   * Vision capability probe: sends one 1x1 PNG plus a one-word prompt and reports whether
   * the model took it (see services/vision-detect.ts for the verdict rules and why this
   * one costs real money, unlike the protocol probes).
   *
   * Credential resolution is the connectivity test's, verbatim — the request's key, else
   * the stored one, unless "clear" is checked. The environment layer needs no code here:
   * omitting apiKey lets AgentHub read the protocol's own variable, which is the same
   * chain protocol detection spells out by hand because it bypasses the SDK. Nothing
   * secret is returned; the failure message is the provider's own text, truncated.
   */
  async detectVision(
    projectId: string,
    req: ModelVisionDetectRequest,
  ): Promise<ModelVisionDetectResponse> {
    const raw = await this.readRaw(projectId);
    // Probeable before the entry exists, so a custom model can be checked while adding it.
    const entry = asArray(raw.models).find((m) => entryMatches(m, req.provider, req.modelId)) ?? {};
    const savedKey = optStr(entry.api_key);
    const apiKey = req.clearApiKey ? undefined : (req.apiKey ?? savedKey);
    const savedBaseUrl = optStr(entry.base_url);
    const baseUrl = req.baseUrl === null ? undefined : (req.baseUrl ?? savedBaseUrl);
    const clientType = canonicalClientType(req.clientType ?? optStr(entry.client_type));
    try {
      // Inside the try for the same reason as testModel: the SDK throws on a missing
      // credential during construction, and that must read as "probe failed", not a 500.
      const llm = new GenerativeModel({
        modelId: req.modelId,
        ...(apiKey ? { apiKey } : {}),
        ...(baseUrl ? { baseUrl } : {}),
        ...(clientType ? { clientType } : {}),
        tools: [],
        // The lowest real level, not "none": several reasoning endpoints reject a request
        // that disables thinking outright, and a probe must not fail on the knob it sends.
        thinkingLevel: "low",
        maxTokens: VISION_PROBE_MAX_TOKENS,
        requestTimeoutMs: VISION_PROBE_TIMEOUT_MS,
      });
      // Both parts must carry role "user" — a mixed-role batch is rejected before it is
      // sent (see generative-model's UniMessage merge).
      const gen = llm.streamGenerate({
        newMessages: [userText(VISION_PROBE_PROMPT), imageUrlMessage(VISION_PROBE_IMAGE)],
      });
      let sawContent = false;
      for (;;) {
        const step = await gen.next();
        if (step.done) {
          const outcome = classifyVisionProbe(step.value, sawContent);
          if (outcome !== "failed") return { outcome };
          const detail =
            "errorMessage" in step.value && step.value.errorMessage
              ? step.value.errorMessage
              : step.value.status;
          return { outcome, message: String(detail).slice(0, 300) };
        }
        if (isProbeContent(step.value)) sawContent = true;
      }
    } catch (err) {
      const outcome = classifyVisionProbeError(err);
      if (outcome !== "failed") return { outcome };
      return {
        outcome,
        message: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      };
    }
  }

  async testModel(projectId: string, req: ModelTestRequest): Promise<ModelTestResponse> {
    const raw = await this.readRaw(projectId);
    // Testable even if the model isn't in the config yet (validate before saving when adding a custom model): in that case all parameters come from the request body.
    const entry = asArray(raw.models).find((m) => entryMatches(m, req.provider, req.modelId)) ?? {};
    // Always tests against the **current form draft**: checking "clear" means the saved key is not fallen back to; an explicit null base URL is treated as cleared.
    const savedKey = optStr(entry.api_key);
    const apiKey = req.clearApiKey ? undefined : (req.apiKey ?? savedKey);
    const savedBaseUrl = optStr(entry.base_url);
    const baseUrl = req.baseUrl === null ? undefined : (req.baseUrl ?? savedBaseUrl);
    // The pre-0.4.2 "openai" spelling (request or stored entry) is normalized to the
    // canonical "openai-chat" (deprecated upstream alias; see canonicalClientType).
    const clientType = canonicalClientType(req.clientType ?? optStr(entry.client_type));
    // Fast mode follows the form draft like baseUrl (the frontend always sends the current
    // toggle), falling back to the stored annotation: the probe then exercises exactly the
    // serving tier sessions would use, so a model rejecting fast_mode fails the test with
    // the actionable message before the config is saved.
    const fastMode = req.fastMode ?? entry.fast_mode === true;

    const startedAt = Date.now();
    try {
      // Construction must be inside the try block: the underlying provider SDK can
      // throw during **client construction** itself when a credential is missing
      // (models on the OpenAI protocol need apiKey/OPENAI_API_KEY) — the whole point
      // of a connectivity test is to collapse that kind of failure into
      // `{ ok:false }`; if construction were outside the try, a missing-key test
      // would bubble up as a 500.
      const llm = new GenerativeModel({
        modelId: req.modelId,
        ...(apiKey ? { apiKey } : {}),
        ...(baseUrl ? { baseUrl } : {}),
        ...(clientType ? { clientType } : {}),
        ...(fastMode ? { fastMode: true } : {}),
        tools: [],
        // The lowest real level, not "none": several reasoning endpoints reject a request
        // that disables thinking outright, and a probe must not fail on the knob it sends.
        thinkingLevel: "low",
        // Speed mode pairs a raised cap with a prompt that keeps generating (see
        // SPEED_PROBE_PROMPT), so the stream lasts long enough for TTFT/TPS to describe
        // decoding rather than one round trip; the plain connectivity test keeps the
        // single-digit-token budget.
        maxTokens: req.speed ? 64 : 16,
        requestTimeoutMs: 20_000,
      });
      const gen = llm.streamGenerate({
        newMessages: [userText(req.speed ? SPEED_PROBE_PROMPT : PROBE_PROMPT)],
      });
      let sawContent = false;
      let firstContentAt: number | null = null;
      let outputTokens = 0;
      for (;;) {
        const step = await gen.next();
        if (step.done) {
          const verdict = probeVerdict(step.value, sawContent);
          if (!verdict.ok) return verdict;
          const res: ModelTestResponse = { ok: true, latencyMs: Date.now() - startedAt };
          if (firstContentAt !== null) {
            res.ttftMs = firstContentAt - startedAt;
            // Output rate over the streaming window (first content -> stream end), dropped
            // when the sample is too small to mean anything (see probeTps): usage is only
            // reported on completed streams, so thinking-only malformed endings carry TTFT
            // but no rate, and so does a model that answers in a couple of tokens.
            const tps = probeTps(outputTokens, Date.now() - firstContentAt);
            if (tps !== undefined) res.tps = tps;
          }
          return res;
        }
        if (isProbeContent(step.value)) {
          sawContent = true;
          if (firstContentAt === null) firstContentAt = Date.now();
        }
        const p = step.value.payload as { type?: string; request?: { output?: number } };
        if (p.type === "token_usage" && typeof p.request?.output === "number") {
          outputTokens = p.request.output;
        }
      }
    } catch (err) {
      // Defensive: an unexpected exception during construction/iteration (the LLM layer promises not to throw; this is a fallback).
      return {
        ok: false,
        message: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      };
    }
  }

  /**
   * Protocol detection for a custom base URL (see services/protocol-detect.ts for the
   * probe order and classification). Credential resolution has three layers, in order:
   *   1. the request body's key (what the user just typed in the dialog);
   *   2. otherwise, when the optional paired reference names a stored entry and "clear"
   *      isn't checked, that entry's saved key (the frontend only ever sees the mask);
   *   3. otherwise the environment variable for whichever protocol each probe speaks,
   *      resolved inside detectModelProtocol because the protocol is the thing being
   *      determined (ANTHROPIC_API_KEY for ant-messages, OPENAI_API_KEY for the two
   *      OpenAI protocols).
   * Layers 2 and 3 are read server-side only and never travel back to the browser.
   * Detection still runs with no credential at all: a protocol-shaped 401/403 proves the
   * route. Never throws on probe failures — every outcome is reported per probe.
   */
  async detectProtocol(
    projectId: string,
    req: ModelProtocolDetectRequest,
  ): Promise<ModelProtocolDetectResponse> {
    let apiKey = req.apiKey;
    if (apiKey === undefined && !req.clearApiKey && req.provider && req.modelId) {
      const raw = await this.readRaw(projectId);
      const entry = asArray(raw.models).find((m) =>
        entryMatches(m, req.provider as string, req.modelId as string),
      );
      apiKey = entry !== undefined ? optStr(entry.api_key) : undefined;
    }
    return detectModelProtocol({ baseUrl: req.baseUrl, ...(apiKey ? { apiKey } : {}) });
  }

  /**
   * Endpoint model listing for the add-group import (see EndpointModelListRequest). All
   * parameters come from the request — a group being created has no stored entry to fall
   * back to; an omitted key follows the same environment chain as the connectivity test
   * (the wrapped SDK reads the protocol's own variable). Never throws: SDK construction
   * and request failures collapse into `{ ok:false, message }`, an AgentHub
   * UnsupportedOperationError additionally sets `unsupported` so the dialog can point at
   * the manual path, and a listing that outlives LIST_MODELS_TIMEOUT_MS is reported as
   * timed out. Nothing cancels the request behind it: the race only stops waiting, and a
   * later rejection is already handled by the race itself. The listing is returned
   * verbatim; dedup against the config is the caller's policy, exactly like the probe
   * routes never write anything either.
   */
  async listEndpointModels(
    req: EndpointModelListRequest,
    listImpl: typeof coreListEndpointModels = coreListEndpointModels,
    timeoutMs: number = LIST_MODELS_TIMEOUT_MS,
  ): Promise<EndpointModelListResponse> {
    const clientType = canonicalClientType(req.clientType) ?? req.clientType;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const listing = listImpl({
        clientType,
        baseUrl: req.baseUrl,
        ...(req.apiKey ? { apiKey: req.apiKey } : {}),
      });
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("model listing timed out")), timeoutMs);
        timer.unref?.();
      });
      const models = await Promise.race([listing, timeout]);
      return { ok: true, models };
    } catch (err) {
      const unsupported = err instanceof Error && err.name === "UnsupportedOperationError";
      return {
        ok: false,
        ...(unsupported ? { unsupported: true } : {}),
        message: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * GET models view: masks credential (inline fields), flags the default Model;
   * the group is the entry's `provider` field, looked up in the built-in catalog by
   * the `(provider, model_id)` pair to fill in displayName / envKey (entries outside
   * the catalog are treated as custom models: envKey only has a fallback for the
   * openai protocol). vision follows the TOML annotation when present, otherwise
   * falls back to the catalog annotation (if neither exists, the field is omitted =
   * supported by default).
   */
  async getModels(projectId: string): Promise<ModelsResponse> {
    const raw = await this.readRaw(projectId);
    const defaultRef = optRef(raw.default_model);
    const visionRef = optRef(raw.vision_model);
    const models: ModelInfo[] = asArray(raw.models)
      // An entry is valid only if both provider and model_id are strings (an entry in the old concatenated format lacks provider and is ignored).
      .filter((m) => typeof m.provider === "string" && typeof m.model_id === "string")
      .map((m) => {
        const provider = m.provider as string;
        const modelId = m.model_id as string;
        const pricing = asTable(m.pricing);
        const pricingDto: ModelPricingDto | undefined =
          optNum(pricing.cache_read) !== undefined ||
          optNum(pricing.cache_write) !== undefined ||
          optNum(pricing.output) !== undefined
            ? {
                cacheRead: optNum(pricing.cache_read) ?? 0,
                cacheWrite: optNum(pricing.cache_write) ?? 0,
                output: optNum(pricing.output) ?? 0,
              }
            : undefined;
        // Normalized on read: entries stored before AgentHub 0.4.2's openai -> openai-chat
        // rename report the canonical spelling without a disk rewrite (the next models PUT
        // persists it).
        const clientType = canonicalClientType(optStr(m.client_type));
        const cat = catalogEntryFor(provider, modelId);
        // The env fallback is reported as-is: follows the same rule as
        // AgentHub routing — an explicit client_type takes priority (the openai
        // protocol reads OPENAI_*, independent of the group), otherwise it's
        // auto-routed to a provider client based on model_id; an id that can't be
        // routed has no fallback (no envKey, and AgentHub will reject that id).
        const envKey = resolveModelEnv(modelId, clientType)?.envKey;
        const vision = typeof m.vision === "boolean" ? m.vision : cat?.supportsVision;
        // Output cap: TOML annotation only (user-owned; the built-in catalog never presets it).
        const maxTokens = optNum(m.max_tokens);
        // Fast mode: TOML annotation only (user-owned); only `true` is reported — absent = off.
        const fastMode = m.fast_mode === true ? true : undefined;
        // Display name: the explicit TOML field (user-edited) takes priority, then the built-in catalog.
        const displayName = optStr(m.display_name) ?? cat?.displayName;
        // credential is inlined on the entry: a credential block is emitted if either api_key or base_url is present.
        const apiKey = optStr(m.api_key);
        const credBaseUrl = optStr(m.base_url);
        const createdAt = optStr(m.created_at);
        // Masked env-fallback preview, first-party entries only (see envFallbackFirstParty):
        // presence is implied by the field, the plaintext never leaves the server, and an
        // empty variable counts as absent — it would not authenticate either. Read from this
        // process's env, which on the desktop already includes the imported login-shell
        // variables.
        const envValue =
          envKey !== undefined &&
          envFallbackFirstParty({ provider, modelId, clientType, baseUrl: credBaseUrl })
            ? (process.env[envKey] ?? "")
            : "";
        const envKeyMasked = envValue !== "" ? maskApiKey(envValue) : undefined;
        const info: ModelInfo = {
          provider,
          modelId,
          ...(displayName !== undefined ? { displayName } : {}),
          isDefault:
            defaultRef !== undefined &&
            defaultRef.provider === provider &&
            defaultRef.model_id === modelId,
          ...(optNum(m.context_window) !== undefined
            ? { contextWindow: optNum(m.context_window)! }
            : {}),
          ...(clientType ? { clientType } : {}),
          ...(vision !== undefined ? { vision } : {}),
          ...(maxTokens !== undefined ? { maxTokens } : {}),
          ...(fastMode !== undefined ? { fastMode } : {}),
          ...(envKey ? { envKey } : {}),
          ...(envKeyMasked !== undefined ? { envKeyMasked } : {}),
          ...(pricingDto ? { pricing: pricingDto } : {}),
          ...(apiKey !== undefined || credBaseUrl !== undefined
            ? {
                credential: {
                  ...(apiKey !== undefined ? { apiKeyMasked: maskApiKey(apiKey) } : {}),
                  ...(credBaseUrl !== undefined ? { baseUrl: credBaseUrl } : {}),
                  ...(createdAt !== undefined ? { createdAt } : {}),
                },
              }
            : {}),
        };
        return info;
      });
    const toDto = (ref: ModelRef): ModelRefDto => ({
      provider: ref.provider,
      modelId: ref.model_id,
    });
    const updatedAt = await this.configUpdatedAt(projectId);
    return {
      ...(defaultRef !== undefined ? { defaultModel: toDto(defaultRef) } : {}),
      ...(visionRef !== undefined ? { visionModel: toDto(visionRef) } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
      models,
    };
  }

  /**
   * PUT replaces the whole models table: key =
   * `(provider, modelId)`; model entries that no longer appear are deleted along
   * with their inline credential; omitting apiKey keeps the existing value,
   * providing one overwrites it and records created_at, clearApiKey clears it;
   * baseUrl null clears it / omitted keeps it. A key change (either the group or
   * the upstream id changes) is migrated as a pair via `renamedFrom`: credential and
   * unknown fields migrate along with the base entry, and default/vision pointers
   * follow. Other extension fields in the toml (name, etc.) are preserved.
   */
  async updateModels(projectId: string, req: ModelsUpdateRequest): Promise<ModelsResponse> {
    const raw = await this.readRaw(projectId);
    const prevModels = asArray(raw.models);

    const seen = new Set<string>();
    const nextModels: RawTable[] = [];
    // Rename mapping (old reference key -> new reference): default model / vision model pointers follow a key change instead of being lost on a full table replacement.
    const renamed = new Map<string, ModelRefDto>();
    for (const entry of req.models) {
      const key = refKey(entry.provider, entry.modelId);
      if (seen.has(key)) {
        throw badRequest(
          `models contains a duplicate model reference: ${showRef(entry.provider, entry.modelId)}.`,
        );
      }
      seen.add(key);
      if (
        entry.renamedFrom !== undefined &&
        !(
          entry.renamedFrom.provider === entry.provider &&
          entry.renamedFrom.modelId === entry.modelId
        )
      ) {
        renamed.set(refKey(entry.renamedFrom.provider, entry.renamedFrom.modelId), {
          provider: entry.provider,
          modelId: entry.modelId,
        });
      }

      // Model entry: uses the old entry (the entry for the original reference when
      // the key changed) as the base, preserving unknown fields and inline
      // credential; known fields are replaced wholesale per the request (omitted
      // means removed).
      const prevRef = entry.renamedFrom ?? { provider: entry.provider, modelId: entry.modelId };
      const prev = prevModels.find((m) => entryMatches(m, prevRef.provider, prevRef.modelId)) ?? {};
      const next: RawTable = { ...prev, provider: entry.provider, model_id: entry.modelId };
      delete next.context_window;
      delete next.client_type;
      delete next.vision;
      delete next.max_tokens;
      delete next.fast_mode;
      delete next.pricing;
      delete next.display_name;
      // Leftover key from the old concatenated format (request_model_id): defensively stripped, never written to disk again.
      delete next.request_model_id;

      // Display name: **only written to disk when it differs from the built-in
      // catalog (looked up by the paired reference)** — preset models keep the
      // config clean, only user-edited ones (including those not found in the
      // catalog) get written into the TOML.
      const catNew = catalogEntryFor(entry.provider, entry.modelId);
      if (entry.displayName && entry.displayName !== catNew?.displayName) {
        next.display_name = entry.displayName;
      }
      if (entry.contextWindow !== undefined) next.context_window = entry.contextWindow;
      // Stored canonically: a client sending the deprecated "openai" alias persists
      // "openai-chat" (see canonicalClientType).
      if (entry.clientType) next.client_type = canonicalClientType(entry.clientType);
      // Treated as supported by default: only written to disk when explicitly annotated (both true/false are kept; false drives a frontend blocking hint).
      if (entry.vision !== undefined) next.vision = entry.vision;
      // Inherit-the-Agent-value by default: only written to disk when explicitly annotated (omitted on a full-table PUT = the annotation is cleared).
      if (entry.maxTokens !== undefined) next.max_tokens = entry.maxTokens;
      // Off by default: only `true` is written to disk (absent = off); omitted or false clears the annotation.
      if (entry.fastMode === true) next.fast_mode = true;
      if (entry.pricing !== undefined) {
        next.pricing = {
          unit: "usd_per_mtok",
          cache_read: entry.pricing.cacheRead,
          cache_write: entry.pricing.cacheWrite,
          output: entry.pricing.output,
        };
      }

      // credential is inlined on the entry; added/removed on top of the old value per the request (migrates automatically with the base entry when the key changes).
      if (entry.clearApiKey) {
        delete next.api_key;
        delete next.created_at;
      }
      if (entry.apiKey !== undefined) {
        next.api_key = entry.apiKey;
        next.created_at = new Date().toISOString();
      }
      if (entry.baseUrl === null) delete next.base_url;
      else if (entry.baseUrl !== undefined) next.base_url = entry.baseUrl;
      nextModels.push(next);
    }

    // default_model: when provided it must be present in models; when omitted the previous value is kept (the pointer follows a key rename; if it was deleted, it's removed).
    let defaultModel: ModelRefDto | undefined;
    if (req.defaultModel !== undefined) {
      if (!seen.has(refKey(req.defaultModel.provider, req.defaultModel.modelId))) {
        throw badRequest(
          `defaultModel must be included in models: ${showRef(req.defaultModel.provider, req.defaultModel.modelId)}.`,
        );
      }
      defaultModel = req.defaultModel;
    } else {
      const prevRef = optRef(raw.default_model);
      if (prevRef !== undefined) {
        const prevKey = refKey(prevRef.provider, prevRef.model_id);
        const followed = renamed.get(prevKey) ?? {
          provider: prevRef.provider,
          modelId: prevRef.model_id,
        };
        if (seen.has(refKey(followed.provider, followed.modelId))) defaultModel = followed;
      }
    }

    // vision_model: same semantics as default_model; additionally must not be annotated vision=false (can't proxy-read images if unsupported).
    const targetOf = (ref: ModelRefDto) =>
      req.models.find((m) => m.provider === ref.provider && m.modelId === ref.modelId);
    let visionModel: ModelRefDto | undefined;
    if (req.visionModel !== undefined) {
      if (!seen.has(refKey(req.visionModel.provider, req.visionModel.modelId))) {
        throw badRequest(
          `visionModel must be included in models: ${showRef(req.visionModel.provider, req.visionModel.modelId)}.`,
        );
      }
      if (targetOf(req.visionModel)?.vision === false) {
        throw badRequest(
          `visionModel must not point to a model annotated as not supporting images: ${showRef(req.visionModel.provider, req.visionModel.modelId)}.`,
        );
      }
      visionModel = req.visionModel;
    } else {
      const prevRef = optRef(raw.vision_model);
      if (prevRef !== undefined) {
        const prevKey = refKey(prevRef.provider, prevRef.model_id);
        const followed = renamed.get(prevKey) ?? {
          provider: prevRef.provider,
          modelId: prevRef.model_id,
        };
        if (seen.has(refKey(followed.provider, followed.modelId))) {
          // The former vision model is now annotated as not supporting images: the annotation takes priority, and the pointer is dropped as invalid.
          if (targetOf(followed)?.vision !== false) visionModel = followed;
        }
      }
    }

    const toRaw = (ref: ModelRefDto): RawTable => ({
      provider: ref.provider,
      model_id: ref.modelId,
    });
    const next: RawTable = { ...raw, models: nextModels };
    if (defaultModel !== undefined) next.default_model = toRaw(defaultModel);
    else delete next.default_model;
    if (visionModel !== undefined) next.vision_model = toRaw(visionModel);
    else delete next.vision_model;
    await this.writeRaw(projectId, next);
    return this.getModels(projectId);
  }

  /**
   * Writes one API key onto every model of a provider group — the credential half of the
   * bulk group-key action, performing the same `api_key` + `created_at` write `updateModels`
   * performs on the entries it rewrites. No other field is read or replaced, so a caller
   * that never saw the rest of the table cannot flatten it.
   *
   * Returns how many entries were written; an empty group writes nothing and returns 0.
   */
  async setGroupApiKey(projectId: string, provider: string, apiKey: string): Promise<number> {
    const raw = await this.readRaw(projectId);
    const createdAt = new Date().toISOString();
    let applied = 0;
    const nextModels = asArray(raw.models).map((m) => {
      if (m.provider !== provider) return m;
      applied += 1;
      return { ...m, api_key: apiKey, created_at: createdAt };
    });
    if (applied === 0) return 0;
    await this.writeRaw(projectId, { ...raw, models: nextModels });
    return applied;
  }
}

/**
 * Whether a streamed message carries genuine model content (thinking or text, partial delta
 * or complete backfill) — the probe's "the endpoint really answered" signal. Tool calls and
 * event messages don't count (the probe declares no tools).
 */
export function isProbeContent(msg: OmniMessage): boolean {
  const p = msg.payload as { type?: string; thinking?: string; text?: string };
  if (p.type === "partial_thinking" || p.type === "thinking") return Boolean(p.thinking);
  if (p.type === "partial_text" || p.type === "text") return Boolean(p.text);
  return false;
}

/**
 * Probe verdict from the terminal LLM outcome. `completed` always passes. A `malformed`
 * ending after genuine streamed content also passes: the typical case is a reasoning-heavy
 * model that spends the probe's tiny max_tokens entirely on thinking (finish_reason=length ->
 * AgentHub's EmptyResponseError, a `retryable` outcome that still streamed content) — the
 * endpoint, credential, and model id all demonstrably work, which is what a connectivity
 * test measures. Everything else (fatal rejections, and retryable failures with nothing
 * received) fails with the outcome's message.
 */
export function probeVerdict(
  outcome: LLMOutcome,
  sawContent: boolean,
): { ok: true } | { ok: false; message: string } {
  if (outcome.status === "completed") return { ok: true };
  if (outcome.status === "retryable" && sawContent) return { ok: true };
  const detail =
    "errorMessage" in outcome && outcome.errorMessage ? outcome.errorMessage : outcome.status;
  return { ok: false, message: String(detail).slice(0, 300) };
}

/**
 * Sample floors below which the streaming window says nothing about decoding rate. The
 * speed probe's 64-token cap clears both by a wide margin, so hitting a floor means the
 * model didn't really stream (a one-word answer, or usage that never arrived).
 */
const PROBE_TPS_MIN_TOKENS = 16;
const PROBE_TPS_MIN_WINDOW_MS = 100;

/**
 * Output rate (tokens/s) over the probe's streaming window (first content -> stream end),
 * rounded to 1dp; undefined when the sample is too small to be meaningful. A stream's
 * closing usage chunk costs a round trip on its own, so a two-token answer measures network
 * jitter and nothing else — 2 tokens in 30ms reads as 66.7 tok/s and the same model 30ms
 * later reads as 33.3, which the card badges would paint green vs yellow. Callers report
 * TTFT alone rather than a fabricated rate; a malformed ending carries no usage at all and
 * lands here as 0 tokens.
 */
export function probeTps(outputTokens: number, windowMs: number): number | undefined {
  if (outputTokens < PROBE_TPS_MIN_TOKENS || windowMs <= PROBE_TPS_MIN_WINDOW_MS) return undefined;
  return Math.round((outputTokens / (windowMs / 1000)) * 10) / 10;
}

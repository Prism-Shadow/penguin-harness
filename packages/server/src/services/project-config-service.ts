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
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  GenerativeModel,
  catalogEntryFor,
  defaultProjectConfig,
  projectConfigPath,
  renderProjectConfigToml,
  resolveModelEnv,
  userText,
} from "@prismshadow/penguin-core";
import type { LLMOutcome, ModelRef, OmniMessage } from "@prismshadow/penguin-core";
import type {
  ModelInfo,
  ModelPricingDto,
  ModelRefDto,
  ModelsResponse,
  ModelsUpdateRequest,
  ModelTestRequest,
  ModelTestResponse,
} from "../api/types.js";
import { badRequest } from "../http/validate.js";
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
 * Speed probe prompt: a one-word answer can't be timed (a compliant model emits 1-3
 * tokens, and the window is then dominated by the final usage chunk's round trip), so
 * speed mode asks for something long enough to run into its raised cap. Counting to 50 is
 * deterministic and needs no knowledge, so every model produces the same token stream at
 * its own decoding rate. Carries the same anti-thinking hint as the connectivity prompt.
 */
const SPEED_PROBE_PROMPT =
  "Count from 1 to 50 as a comma-separated list, and nothing else. Do not think or explain.\n<think></think>";

export class ProjectConfigService {
  constructor(private readonly root: string) {}

  private filePath(projectId: string): string {
    return projectConfigPath(this.root, projectId);
  }

  /** Reads the raw TOML object; returns an empty object if the file doesn't exist (does not write to disk). */
  async readRaw(projectId: string): Promise<RawTable> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath(projectId), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    }
    return asTable(parseToml(raw));
  }

  /**
   * Writes the whole object to disk: the file inlines secrets like api_key, always
   * written with mode 0600 (the `mode` option only applies at creation time, so
   * chmod is used to enforce it on existing files too — matching core's
   * saveProjectConfig behavior).
   */
  async writeRaw(projectId: string, data: RawTable): Promise<void> {
    const file = this.filePath(projectId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Rendering goes through core's single writer: paired references become inline
    // tables, models is placed last — matching the CLI's output format exactly
    // (the same file should never have two formats).
    await fs.writeFile(file, renderProjectConfigToml(data), { encoding: "utf8", mode: 0o600 });
    await fs.chmod(file, 0o600);
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

  /** Paired reference of the default Model; returns undefined if unconfigured (or in the old string format). */
  async getDefaultModelRef(projectId: string): Promise<ModelRef | undefined> {
    const raw = await this.readRaw(projectId);
    return optRef(raw.default_model);
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
   * system prompt, thinking disabled, a tiny output cap, 20s timeout — just to see
   * whether the endpoint answers. The model id sent to AgentHub is `modelId`
   * itself (the upstream id verbatim; client_type inference follows it).
   *
   * A reasoning-heavy model may ignore the disabled thinking level and burn the
   * whole tiny output cap on thinking (finish_reason=length with no text — AgentHub
   * raises EmptyResponseError, collapsed to a malformed outcome): the endpoint
   * demonstrably streamed model output, which is everything a connectivity test
   * proves, so that case counts as ok too (see probeVerdict).
   *
   * Never throws: the LLM layer collapses auth/parameter/network errors into an
   * `LLMOutcome`, which is translated here into ok / message. Consumes very few
   * Tokens (single-digit output; speed mode spends up to its 64-token cap to have a
   * window worth timing), and writes no Trace and records no usage.
   */
  async testModel(projectId: string, req: ModelTestRequest): Promise<ModelTestResponse> {
    const raw = await this.readRaw(projectId);
    // Testable even if the model isn't in the config yet (validate before saving when adding a custom model): in that case all parameters come from the request body.
    const entry = asArray(raw.models).find((m) => entryMatches(m, req.provider, req.modelId)) ?? {};
    // Always tests against the **current form draft**: checking "clear" means the saved key is not fallen back to; an explicit null base URL is treated as cleared.
    const savedKey = optStr(entry.api_key);
    const apiKey = req.clearApiKey ? undefined : (req.apiKey ?? savedKey);
    const savedBaseUrl = optStr(entry.base_url);
    const baseUrl = req.baseUrl === null ? undefined : (req.baseUrl ?? savedBaseUrl);
    const clientType = req.clientType ?? optStr(entry.client_type);

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
        tools: [],
        thinkingLevel: "none",
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
        const clientType = optStr(m.client_type);
        const cat = catalogEntryFor(provider, modelId);
        // The env fallback is reported as-is: follows the same rule as
        // AgentHub routing — an explicit client_type takes priority (the openai
        // protocol reads OPENAI_*, independent of the group), otherwise it's
        // auto-routed to a provider client based on model_id; an id that can't be
        // routed has no fallback (no envKey, and AgentHub will reject that id).
        const envKey = resolveModelEnv(modelId, clientType)?.envKey;
        const vision = typeof m.vision === "boolean" ? m.vision : cat?.supportsVision;
        // Display name: the explicit TOML field (user-edited) takes priority, then the built-in catalog.
        const displayName = optStr(m.display_name) ?? cat?.displayName;
        // credential is inlined on the entry: a credential block is emitted if either api_key or base_url is present.
        const apiKey = optStr(m.api_key);
        const credBaseUrl = optStr(m.base_url);
        const createdAt = optStr(m.created_at);
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
          ...(envKey ? { envKey } : {}),
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
    return {
      ...(defaultRef !== undefined ? { defaultModel: toDto(defaultRef) } : {}),
      ...(visionRef !== undefined ? { visionModel: toDto(visionRef) } : {}),
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
      if (entry.clientType) next.client_type = entry.clientType;
      // Treated as supported by default: only written to disk when explicitly annotated (both true/false are kept; false drives a frontend blocking hint).
      if (entry.vision !== undefined) next.vision = entry.vision;
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
 * model that ignores the disabled thinking level and burns the probe's tiny max_tokens
 * entirely on thinking (finish_reason=length -> AgentHub's EmptyResponseError) — the
 * endpoint, credential, and model id all demonstrably work, which is what a connectivity
 * test measures. Everything else (auth/parameter failures, timeouts, malformed with nothing
 * received) fails with the outcome's message.
 */
export function probeVerdict(
  outcome: LLMOutcome,
  sawContent: boolean,
): { ok: true } | { ok: false; message: string } {
  if (outcome.status === "completed") return { ok: true };
  if (outcome.status === "malformed" && sawContent) return { ok: true };
  const detail = "message" in outcome && outcome.message ? outcome.message : outcome.status;
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

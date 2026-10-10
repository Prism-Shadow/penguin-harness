/**
 * Model & credential config routes:
 * GET|PUT /api/projects/:p/models, PUT /api/projects/:p/models/default,
 * PUT /api/projects/:p/models/providers/:provider, POST /api/projects/:p/models/sync-presets,
 * POST /api/projects/:p/models/test, POST /api/projects/:p/models/detect,
 * POST /api/projects/:p/models/list, POST /api/projects/:p/models/detect-vision (the model
 * reference `(provider, modelId)` is sent as a pair in the request body, avoiding
 * URL-encoding issues), GET /api/projects/:p/models/balance. Any member can read (api_key is
 * masked) and read a group's balance; only the owner can modify, test, or detect.
 */
import { Hono } from "hono";
import { providerInfo } from "@prismshadow/penguin-core/model-catalog";
import type {
  DefaultModelResponse,
  EndpointModelListRequest,
  ModelBalanceResponse,
  ModelProtocolDetectRequest,
  ModelRefDto,
  ModelsUpdateRequest,
  ModelTestRequest,
  ModelUpdateEntry,
  ModelVisionDetectRequest,
  PresetSyncMode,
  ProviderConnectionUpdate,
  ServerEvent,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { badRequest, pathParam, readJson, requireString, requireValidId } from "../validate.js";
import { HttpError } from "../errors.js";
import { isHttpUrl } from "../../services/protocol-detect.js";
import type { ChannelHub } from "../../runtime/channel.js";
import type { SessionManager } from "../../runtime/session-manager.js";
import type { SessionIndex } from "../../mechanisms/sessions.js";
import type { Access, ProjectConfigStore } from "../../mechanisms/projects.js";
import type { Machines } from "../../machines/service.js";
import { ModelBalances } from "../../services/model-balance.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface ModelsRouteDeps {
  /** The machines this Project uses receive a credential change too (machines/service.ts). */
  machines: Machines;
  channels: ChannelHub;
  manager: SessionManager;
  projectConfigService: ProjectConfigStore;
  access: Access;
  sessionsRepo: SessionIndex;
}

/**
 * Live unlock for auth-dead composers: after a models/credential update, publish
 * `credentials_updated` to every EXISTING channel of this Project's Sessions (`peek` —
 * never creates channels: a tab that isn't subscribed learns the same fact from the models
 * response's `updatedAt` when it next loads). Shared with the key-minting routes, which
 * change the same credentials by a different path.
 */
export function publishCredentialsUpdated(deps: ModelsRouteDeps, projectId: string): void {
  const event: ServerEvent = { type: "credentials_updated" };
  for (const row of deps.sessionsRepo.listByProject(projectId)) {
    deps.channels.peek(row.sessionId)?.publish(event, "server_event");
  }
}

/**
 * EVERYTHING that follows a change to a Project's model config, in one place, so that no
 * path that writes it can forget one of the three: the whole-table PUT, the default switch,
 * and the key-minting flows all end here.
 *
 * - Effective-value semantics (mirrors the vault route): no hot swap into a Task already in
 *   flight, but every cached runtime in this Project is invalidated — the next Task on any
 *   of its Sessions re-resumes and reads the new api_key / base_url. Without this, a key
 *   edit would not reach a loaded Session until the 30-minute idle sweep or a restart.
 * - Live unlock: open tabs clear their auth-dead composer immediately (no reload needed).
 * - The machines run their own Agents against their own config, so a change here has to
 *   reach them or their Sessions keep failing on the old one — or start on the wrong default.
 *   Not awaited: the person editing is not the one who should wait for a set of ssh tunnels.
 */
export function modelConfigChanged(deps: ModelsRouteDeps, projectId: string): void {
  deps.manager.invalidateProjectRuntimes(projectId);
  publishCredentialsUpdated(deps, projectId);
  void deps.machines.syncModelsEverywhere(projectId);
}

/** Validate a paired reference object ({ provider, modelId }); shape mismatch throws 400. */
function parseRef(value: unknown, label: string): ModelRefDto {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest(`${label} must be a { provider, modelId } object.`);
  }
  const r = value as Record<string, unknown>;
  return {
    provider: requireString(r, "provider", { minLen: 1, maxLen: 64, label: `${label}.provider` }),
    // Normalized at this single ingestion point: the service's gates judge the trimmed
    // id (unaddableModel / unroutableVendorModel trim), while the dedup and the stored
    // model_id compare it verbatim, so a padded spelling would pass as "new" and store
    // an unroutable near-duplicate. The CLI's `config model add` normalizes the same way.
    modelId: requireString(r, "modelId", {
      minLen: 1,
      maxLen: 200,
      label: `${label}.modelId`,
    }).trim(),
  };
}

/**
 * A user-defined group's name, as the models page's "Add a model group" dialog accepts it:
 * lowercase letters, digits, `-` and `_`, starting with a letter or digit, at most 32.
 */
const USER_GROUP_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/**
 * A group id a connection may be stored under: a built-in group, or a name a user-defined group
 * could carry. Anything else is `400 invalid_provider` — the id becomes a TOML table name, and a
 * group no row can ever join would be a table nothing reads.
 */
function requireProviderId(id: string, label: string): string {
  if (providerInfo(id) !== undefined || USER_GROUP_NAME.test(id)) return id;
  throw new HttpError(
    400,
    "invalid_provider",
    `${label} must name a built-in model group or a group name of lowercase letters, digits, "-" and "_" (at most 32): ${JSON.stringify(id.slice(0, 64))}.`,
  );
}

/**
 * Validate one group connection change (`PUT /models/providers/:provider`, or a member of the
 * whole-table PUT's `providers`). Per field: omitted keeps it; `baseUrl` / `clientType` take a
 * string or `null` (null and a blank string clear); `apiKey` a non-empty string;
 * `clearApiKey` a boolean. A base URL that is set must be an absolute http(s) URL, as /detect
 * and /list require: every model of the group without one of its own is sent there. Every
 * group takes a protocol: a row's own always wins over it.
 */
function parseProviderUpdate(value: unknown, label: string): ProviderConnectionUpdate {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest(`${label} must be an object.`);
  }
  const p = value as Record<string, unknown>;
  const update: ProviderConnectionUpdate = {};
  if (p.baseUrl !== undefined) {
    if (p.baseUrl !== null && (typeof p.baseUrl !== "string" || p.baseUrl.length > 2000)) {
      throw badRequest(`${label}.baseUrl must be null or a string of at most 2000 characters.`);
    }
    const baseUrl = p.baseUrl?.trim();
    if (baseUrl && !isHttpUrl(baseUrl)) {
      throw badRequest(`${label}.baseUrl must be an absolute http(s) URL.`);
    }
    update.baseUrl = baseUrl ? baseUrl : null;
  }
  if (p.clientType !== undefined) {
    if (p.clientType !== null && (typeof p.clientType !== "string" || p.clientType.length > 64)) {
      throw badRequest(`${label}.clientType must be null or a string of at most 64 characters.`);
    }
    update.clientType = p.clientType ? p.clientType : null;
  }
  if (p.apiKey !== undefined) {
    if (typeof p.apiKey !== "string" || p.apiKey.trim().length === 0) {
      throw badRequest(`${label}.apiKey must be a non-empty string.`);
    }
    update.apiKey = p.apiKey;
  }
  if (p.clearApiKey !== undefined) {
    if (typeof p.clearApiKey !== "boolean") {
      throw badRequest(`${label}.clearApiKey must be a boolean.`);
    }
    update.clearApiKey = p.clearApiKey;
  }
  return update;
}

/** Validate the PUT request body and shape it into a ModelsUpdateRequest (rejects any shape errors). */
function parseModelsUpdate(body: Record<string, unknown>): ModelsUpdateRequest {
  if (!Array.isArray(body.models)) throw badRequest("models must be an array.");
  const models: ModelUpdateEntry[] = body.models.map((item, i) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw badRequest(`models[${i}] must be an object.`);
    }
    const m = item as Record<string, unknown>;
    const entry: ModelUpdateEntry = {
      provider: requireString(m, "provider", {
        minLen: 1,
        maxLen: 64,
        label: `models[${i}].provider`,
      }),
      // Same ingestion-point normalization as parseRef (see there): the trimmed id is
      // what the gates judge, the dedup keys on, and the table stores.
      modelId: requireString(m, "modelId", {
        minLen: 1,
        maxLen: 200,
        label: `models[${i}].modelId`,
      }).trim(),
    };
    if (m.displayName !== undefined) {
      if (typeof m.displayName !== "string" || m.displayName.length > 100) {
        throw badRequest(`models[${i}].displayName must be a string of at most 100 characters.`);
      }
      // The empty string is carried through rather than dropped: an absent field means
      // "inherit the built-in catalog's name" and an empty one means "the user cleared it",
      // and the service cannot tell those apart if the validator collapses them here.
      entry.displayName = m.displayName;
    }
    // A key change (either the provider group or the upstream id) goes through renamedFrom's paired old reference; unknown fields are ignored.
    if (m.renamedFrom !== undefined) {
      entry.renamedFrom = parseRef(m.renamedFrom, `models[${i}].renamedFrom`);
    }
    if (m.contextWindow !== undefined) {
      if (typeof m.contextWindow !== "number" || !(m.contextWindow > 0)) {
        throw badRequest(`models[${i}].contextWindow must be a positive number.`);
      }
      entry.contextWindow = m.contextWindow;
    }
    if (m.clientType !== undefined) {
      if (typeof m.clientType !== "string" || m.clientType.length > 64) {
        throw badRequest(`models[${i}].clientType must be a string of at most 64 characters.`);
      }
      // An empty string is treated as "unspecified", leaving MMSP to route by the vendor
      // family the modelId begins with.
      if (m.clientType) entry.clientType = m.clientType;
    }
    if (m.vision !== undefined) {
      if (typeof m.vision !== "boolean") {
        throw badRequest(`models[${i}].vision must be a boolean.`);
      }
      entry.vision = m.vision;
    }
    if (m.maxTokens !== undefined) {
      if (typeof m.maxTokens !== "number" || !Number.isInteger(m.maxTokens) || m.maxTokens <= 0) {
        throw badRequest(`models[${i}].maxTokens must be a positive integer.`);
      }
      entry.maxTokens = m.maxTokens;
    }
    if (m.fastMode !== undefined) {
      if (typeof m.fastMode !== "boolean") {
        throw badRequest(`models[${i}].fastMode must be a boolean.`);
      }
      entry.fastMode = m.fastMode;
    }
    if (m.pricing !== undefined) {
      const p = m.pricing as Record<string, unknown>;
      if (p === null || typeof p !== "object" || Array.isArray(p)) {
        throw badRequest(`models[${i}].pricing must be an object.`);
      }
      for (const key of ["cacheRead", "cacheWrite", "output"] as const) {
        const v = p[key];
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
          throw badRequest(`models[${i}].pricing.${key} must be a non-negative number.`);
        }
      }
      entry.pricing = {
        cacheRead: p.cacheRead as number,
        cacheWrite: p.cacheWrite as number,
        output: p.output as number,
      };
    }
    // The promotion stored for this row (null clears it); the service checks the range.
    if (m.discount !== undefined) {
      if (m.discount !== null && typeof m.discount !== "number") {
        throw badRequest(`models[${i}].discount must be null or a number above 0 and below 1.`);
      }
      entry.discount = m.discount;
    }
    if (m.apiKey !== undefined) {
      if (typeof m.apiKey !== "string" || m.apiKey.length === 0) {
        throw badRequest(`models[${i}].apiKey must be a non-empty string.`);
      }
      entry.apiKey = m.apiKey;
    }
    if (m.clearApiKey !== undefined) {
      if (typeof m.clearApiKey !== "boolean") {
        throw badRequest(`models[${i}].clearApiKey must be a boolean.`);
      }
      entry.clearApiKey = m.clearApiKey;
    }
    if (m.baseUrl !== undefined) {
      if (m.baseUrl !== null && typeof m.baseUrl !== "string") {
        throw badRequest(`models[${i}].baseUrl must be a string or null.`);
      }
      entry.baseUrl = m.baseUrl as string | null;
    }
    return entry;
  });
  const req: ModelsUpdateRequest = { models };
  if (body.defaultModel !== undefined) {
    req.defaultModel = parseRef(body.defaultModel, "defaultModel");
  }
  if (body.visionModel !== undefined) {
    req.visionModel = parseRef(body.visionModel, "visionModel");
  }
  if (body.providers !== undefined) {
    const providers = body.providers;
    if (providers === null || typeof providers !== "object" || Array.isArray(providers)) {
      throw badRequest("providers must be an object keyed by model group.");
    }
    req.providers = Object.fromEntries(
      Object.entries(providers as Record<string, unknown>).map(([id, update]) => [
        requireProviderId(id, "providers"),
        parseProviderUpdate(update, `providers.${id}`),
      ]),
    );
  }
  return req;
}

export function modelsRoutes(deps: ModelsRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  /** The balance reader and its 60 s cache, one per route group. */
  const balances = new ModelBalances({
    groupKey: (projectId, provider) =>
      deps.projectConfigService.getGroupBalanceKey(projectId, provider),
  });

  app.get("/", async (c) => {
    // Defensive id validation.
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    return c.json(await deps.projectConfigService.getModels(projectId));
  });

  app.put("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const req = parseModelsUpdate(await readJson(c));
    const res = await deps.projectConfigService.updateModels(projectId, req);
    modelConfigChanged(deps, projectId);
    return c.json(res);
  });

  // One group's connection (owner): `[providers.<id>]`'s base URL, protocol and key, merged
  // per field — the group settings dialog and Disconnect (`{ clearApiKey: true }`) both land
  // here. Rows are untouched, so a model with its own value keeps it, its own protocol
  // included: any group takes a protocol. An id that is neither a built-in group nor a
  // user-group name is `400 invalid_provider`; a base URL that is not an absolute http(s) URL
  // is a 400 too (parseProviderUpdate), the same check the whole-table PUT's `providers` gets.
  app.put("/providers/:provider", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const provider = requireProviderId(pathParam(c, "provider"), "provider");
    const patch = parseProviderUpdate(await readJson(c), "body");
    const res = await deps.projectConfigService.setProviderConnection(projectId, provider, patch);
    modelConfigChanged(deps, projectId);
    return c.json(res);
  });

  // "Add new models" (`add`) and "Restore defaults" (`restore`) against the built-in catalog
  // (owner): server-side, because restore resets rows, group tables, promotions and the two
  // references at once, and add seeds the promotions of the rows it adds.
  app.post("/sync-presets", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const body = await readJson(c);
    if (body.mode !== "add" && body.mode !== "restore") {
      throw badRequest('mode must be "add" or "restore".');
    }
    const res = await deps.projectConfigService.syncPresets(projectId, body.mode as PresetSyncMode);
    modelConfigChanged(deps, projectId);
    return c.json(res);
  });

  // A group's account balance (any member, like the table itself): the server asks the
  // vendor with the group's key (never a row's own), so the key never reaches the browser. A
  // balance that cannot be read is an answer (`ok: false` with a code), as a failed
  // connectivity test is.
  // `force=1` is the page's refresh click and skips the 60 s cache.
  app.get("/balance", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    const provider = c.req.query("provider") ?? "";
    if (provider === "" || provider.length > 64) {
      throw badRequest("provider must name a model group.");
    }
    const answer: ModelBalanceResponse = await balances.read(
      projectId,
      provider,
      c.req.query("force") === "1",
    );
    return c.json(answer);
  });

  // Narrow default-model switch (owner): flips the same top-level `default_model` the
  // whole-table PUT above maintains, without resending the table — project settings can
  // change the default without carrying credentials. The pair must name a configured
  // entry (400 otherwise, same rule as the whole-table route's defaultModel). No runtime
  // invalidation and no credentials_updated here: existing Sessions pin their model at
  // creation, and no credential changes. The machines DO hear of it — a Session started
  // over there without an explicit model runs on that machine's default, and the default
  // is part of what the sync carries.
  app.put("/default", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const body = await readJson(c);
    const ref: ModelRefDto = {
      provider: requireString(body, "provider", { minLen: 1, maxLen: 64 }),
      modelId: requireString(body, "modelId", { minLen: 1, maxLen: 200 }),
    };
    const defaultModel = await deps.projectConfigService.setDefaultModelRef(projectId, ref);
    void deps.machines.syncModelsEverywhere(projectId);
    return c.json({ defaultModel } satisfies DefaultModelResponse);
  });

  // Connectivity test (owner): the model reference `(provider, modelId)` is sent as a pair
  // in the request body; sends one minimal request using that model's config. May include
  // not-yet-saved apiKey / baseUrl / clientType — when the model isn't in the config yet
  // (adding a custom model), everything is taken from the request body.
  app.post("/test", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const body = await readJson(c);
    const req: ModelTestRequest = {
      provider: requireString(body, "provider", { minLen: 1, maxLen: 64 }),
      modelId: requireString(body, "modelId", { minLen: 1, maxLen: 200 }),
    };
    if (body.apiKey !== undefined) {
      if (typeof body.apiKey !== "string") throw badRequest("apiKey must be a string.");
      if (body.apiKey) req.apiKey = body.apiKey;
    }
    if (body.clearApiKey !== undefined) {
      if (typeof body.clearApiKey !== "boolean") throw badRequest("clearApiKey must be a boolean.");
      req.clearApiKey = body.clearApiKey;
    }
    if (body.speed !== undefined) {
      if (typeof body.speed !== "boolean") throw badRequest("speed must be a boolean.");
      req.speed = body.speed;
    }
    // null = explicit clear (test against the draft, don't fall back to the stored value); empty string is treated as null.
    if (body.baseUrl !== undefined) {
      if (body.baseUrl !== null && typeof body.baseUrl !== "string") {
        throw badRequest("baseUrl must be a string or null.");
      }
      req.baseUrl = body.baseUrl ? body.baseUrl : null;
    }
    if (body.clientType !== undefined) {
      if (typeof body.clientType !== "string") throw badRequest("clientType must be a string.");
      if (body.clientType) req.clientType = body.clientType;
    }
    if (body.fastMode !== undefined) {
      if (typeof body.fastMode !== "boolean") throw badRequest("fastMode must be a boolean.");
      req.fastMode = body.fastMode;
    }
    return c.json(await deps.projectConfigService.testModel(projectId, req));
  });

  // Protocol auto-detection (owner): probes which generic protocol client the base URL
  // serves — openai-responses, then ant-messages, then openai-chat — and returns the
  // first hit plus per-probe outcomes (see services/protocol-detect.ts). Cheap: each
  // probe is a minimal invalid request (no tokens billed). Like the connectivity test,
  // an optional paired reference lets a stored key back the probes without the frontend
  // ever seeing the plaintext.
  //
  // On the server fetching a caller-supplied URL: deliberate, and not a new capability.
  // /test already hands an arbitrary baseUrl to the provider SDK behind the same
  // owner-only guard, and in a self-hosted product pointing the server at an internal or
  // loopback inference endpoint is the feature (vLLM / Ollama / a LAN gateway), not the
  // attack — so no host allowlist. This route is the tighter of the two: it rejects
  // anything that is not an absolute http(s) URL, and reduces every answer to an outcome
  // enum plus an HTTP status, where /test surfaces the upstream message verbatim.
  app.post("/detect", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const body = await readJson(c);
    const req: ModelProtocolDetectRequest = {
      baseUrl: requireString(body, "baseUrl", { minLen: 1, maxLen: 2000 }),
    };
    if (!isHttpUrl(req.baseUrl)) throw badRequest("baseUrl must be an absolute http(s) URL.");
    if (body.apiKey !== undefined) {
      if (typeof body.apiKey !== "string") throw badRequest("apiKey must be a string.");
      if (body.apiKey) req.apiKey = body.apiKey;
    }
    if (body.clearApiKey !== undefined) {
      if (typeof body.clearApiKey !== "boolean") throw badRequest("clearApiKey must be a boolean.");
      req.clearApiKey = body.clearApiKey;
    }
    // The paired reference is optional (adding a not-yet-saved model has none). A model id
    // needs its group, so the stored-key lookup is unambiguous; a group alone (the group
    // settings dialog has no model) means the group's key.
    if (body.provider !== undefined || body.modelId !== undefined) {
      req.provider = requireString(body, "provider", { minLen: 1, maxLen: 64 });
      if (body.modelId !== undefined) {
        req.modelId = requireString(body, "modelId", { minLen: 1, maxLen: 200 });
      }
    }
    return c.json(await deps.projectConfigService.detectProtocol(projectId, req));
  });

  // Endpoint model listing (owner): given a base URL plus the protocol /detect reported,
  // returns every model id the endpoint serves (MMSP's listModels() on the routed
  // client) so the add-group dialog can import a provider's whole listing in one go.
  // Owner-only and server-fetches-a-caller-URL for exactly the reasons /detect documents
  // above; like /detect, the reply is reduced to a DTO (ids / outcome flags / truncated
  // reason) and the key travels only in request headers upstream.
  app.post("/list", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const body = await readJson(c);
    const req: EndpointModelListRequest = {
      baseUrl: requireString(body, "baseUrl", { minLen: 1, maxLen: 2000 }),
      clientType: requireString(body, "clientType", { minLen: 1, maxLen: 64 }),
    };
    if (!isHttpUrl(req.baseUrl)) throw badRequest("baseUrl must be an absolute http(s) URL.");
    if (body.apiKey !== undefined) {
      if (typeof body.apiKey !== "string") throw badRequest("apiKey must be a string.");
      if (body.apiKey) req.apiKey = body.apiKey;
    }
    return c.json(await deps.projectConfigService.listEndpointModels(req));
  });

  /**
   * Vision capability probe (owner only). Body mirrors the connectivity test's, since the
   * probe is one real completion on the same credential — see detectVision. Owner-only for
   * the same reason as /test and /detect: it spends the Project's key.
   */
  app.post("/detect-vision", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const body = await readJson(c);
    const req: ModelVisionDetectRequest = {
      provider: requireString(body, "provider", { minLen: 1, maxLen: 64 }),
      modelId: requireString(body, "modelId", { minLen: 1, maxLen: 200 }),
    };
    if (body.apiKey !== undefined) {
      if (typeof body.apiKey !== "string") throw badRequest("apiKey must be a string.");
      if (body.apiKey) req.apiKey = body.apiKey;
    }
    if (body.clearApiKey !== undefined) {
      if (typeof body.clearApiKey !== "boolean") throw badRequest("clearApiKey must be a boolean.");
      req.clearApiKey = body.clearApiKey;
    }
    // null is meaningful (explicitly no base URL), so it is kept distinct from absent.
    if (body.baseUrl !== undefined) {
      if (body.baseUrl !== null && typeof body.baseUrl !== "string") {
        throw badRequest("baseUrl must be a string or null.");
      }
      req.baseUrl = body.baseUrl as string | null;
    }
    if (body.clientType !== undefined) {
      if (typeof body.clientType !== "string") throw badRequest("clientType must be a string.");
      if (body.clientType) req.clientType = body.clientType;
    }
    return c.json(await deps.projectConfigService.detectVision(projectId, req));
  });

  return app;
}

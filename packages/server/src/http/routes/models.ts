/**
 * Model & credential config routes:
 * GET|PUT /api/projects/:p/models, PUT /api/projects/:p/models/default,
 * POST /api/projects/:p/models/test, POST /api/projects/:p/models/detect,
 * POST /api/projects/:p/models/detect-vision (the model
 * reference `(provider, modelId)` is sent as a pair in the request body, avoiding
 * URL-encoding issues). Any member can read (api_key is masked); only the owner can
 * modify, test, or detect.
 */
import { Hono } from "hono";
import type {
  DefaultModelResponse,
  ModelProtocolDetectRequest,
  ModelRefDto,
  ModelsUpdateRequest,
  ModelTestRequest,
  ModelUpdateEntry,
  ModelVisionDetectRequest,
  ServerEvent,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { badRequest, readJson, requireString, requireValidId } from "../validate.js";
import { isHttpUrl } from "../../services/protocol-detect.js";
import type { AppDeps } from "../../app.js";

/**
 * Live unlock for auth-dead composers: after a models/credential update, publish
 * `credentials_updated` to every EXISTING channel of this Project's Sessions (`peek` —
 * never creates channels: a tab that isn't subscribed learns the same fact from the models
 * response's `updatedAt` when it next loads).
 */
function publishCredentialsUpdated(deps: AppDeps, projectId: string): void {
  const event: ServerEvent = { type: "credentials_updated" };
  for (const row of deps.sessionsRepo.listByProject(projectId)) {
    deps.channels.peek(row.sessionId)?.publish(event, "server_event");
  }
}

/** Validate a paired reference object ({ provider, modelId }); shape mismatch throws 400. */
function parseRef(value: unknown, label: string): ModelRefDto {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest(`${label} must be a { provider, modelId } object.`);
  }
  const r = value as Record<string, unknown>;
  return {
    provider: requireString(r, "provider", { minLen: 1, maxLen: 64, label: `${label}.provider` }),
    modelId: requireString(r, "modelId", { minLen: 1, maxLen: 200, label: `${label}.modelId` }),
  };
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
      modelId: requireString(m, "modelId", {
        minLen: 1,
        maxLen: 200,
        label: `models[${i}].modelId`,
      }),
    };
    if (m.displayName !== undefined) {
      if (typeof m.displayName !== "string" || m.displayName.length > 100) {
        throw badRequest(`models[${i}].displayName must be a string of at most 100 characters.`);
      }
      if (m.displayName) entry.displayName = m.displayName;
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
      // An empty string is treated as "unspecified", leaving AgentHub to infer it from modelId.
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
  return req;
}

export function modelsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    // Defensive id validation (FD-4).
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    return c.json(await deps.projectConfigService.getModels(projectId));
  });

  app.put("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
    const req = parseModelsUpdate(await readJson(c));
    const res = await deps.projectConfigService.updateModels(projectId, req);
    // Effective-value semantics (mirrors the vault route): no hot swap into a Task already
    // in flight, but every cached runtime in this Project is invalidated — the next Task on
    // any of its Sessions re-resumes and reads the new api_key / base_url. Without this, a
    // key edit would not reach a loaded Session until the 30-minute idle sweep or a restart.
    deps.manager.invalidateProjectRuntimes(projectId);
    // Live unlock: open tabs clear their auth-dead composer immediately (no reload needed).
    publishCredentialsUpdated(deps, projectId);
    return c.json(res);
  });

  // Narrow default-model switch (owner): flips the same top-level `default_model` the
  // whole-table PUT above maintains, without resending the table — project settings can
  // change the default without carrying credentials. The pair must name a configured
  // entry (400 otherwise, same rule as the whole-table route's defaultModel). No runtime
  // invalidation and no credentials_updated: existing Sessions pin their model at
  // creation, and no credential changes here.
  app.put("/default", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
    const body = await readJson(c);
    const ref: ModelRefDto = {
      provider: requireString(body, "provider", { minLen: 1, maxLen: 64 }),
      modelId: requireString(body, "modelId", { minLen: 1, maxLen: 200 }),
    };
    const defaultModel = await deps.projectConfigService.setDefaultModelRef(projectId, ref);
    return c.json({ defaultModel } satisfies DefaultModelResponse);
  });

  // Connectivity test (owner): the model reference `(provider, modelId)` is sent as a pair
  // in the request body; sends one minimal request using that model's config. May include
  // not-yet-saved apiKey / baseUrl / clientType — when the model isn't in the config yet
  // (adding a custom model), everything is taken from the request body.
  app.post("/test", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
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
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
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
    // The paired reference is optional (adding a not-yet-saved model has none); when
    // present, both fields are required so the stored-key lookup is unambiguous.
    if (body.provider !== undefined || body.modelId !== undefined) {
      req.provider = requireString(body, "provider", { minLen: 1, maxLen: 64 });
      req.modelId = requireString(body, "modelId", { minLen: 1, maxLen: 200 });
    }
    return c.json(await deps.projectConfigService.detectProtocol(projectId, req));
  });

  /**
   * Vision capability probe (owner only). Body mirrors the connectivity test's, since the
   * probe is one real completion on the same credential — see detectVision. Owner-only for
   * the same reason as /test and /detect: it spends the Project's key.
   */
  app.post("/detect-vision", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
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

/**
 * Model & credential config routes:
 * GET|PUT /api/projects/:p/models, POST /api/projects/:p/models/test (the model reference
 * `(provider, modelId)` is sent as a pair in the request body, avoiding URL-encoding
 * issues). Any member can read (api_key is masked); only the owner can modify or test.
 */
import { Hono } from "hono";
import type {
  ModelRefDto,
  ModelsUpdateRequest,
  ModelTestRequest,
  ModelUpdateEntry,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { badRequest, readJson, requireString, requireValidId } from "../validate.js";
import type { AppDeps } from "../../app.js";

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
    return c.json(await deps.projectConfigService.updateModels(projectId, req));
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
    return c.json(await deps.projectConfigService.testModel(projectId, req));
  });

  return app;
}

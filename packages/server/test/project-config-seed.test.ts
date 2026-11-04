/**
 * A new Project's seed, as the server writes it (presetProjectConfig): core's default config
 * carries no models, so everything model-related here is the catalog's.
 *
 * - Given a new Project, its default model reads images and routes with no pin, every preset
 *   row resolves to its catalog protocol and endpoint from the file alone, the group tables are
 *   the catalog's (a first-party vendor has none), and no row carries a key.
 */
import { describe, expect, it } from "vitest";
import { effectiveConnection, providerConnectionShape } from "@prismshadow/penguin-core";
import {
  MODEL_CATALOG,
  PRESET_DEFAULT_MODEL,
  presetProviderTable,
} from "../src/model-catalog/index.js";
import { presetProjectConfig } from "../src/services/project-config-seed.js";

describe("the seed of a new Project", () => {
  it("a new Project gets the whole catalog: a default that reads images and routes unpinned, every preset row on the file alone, the group tables and no key", () => {
    const cfg = presetProjectConfig();
    expect(cfg.default_model).toEqual(PRESET_DEFAULT_MODEL);
    // The default has to be a model that can actually read an image: a new Project's first
    // pasted screenshot goes to it, and a text-only model would decline one for a reason
    // nothing on screen explains.
    const chosen = MODEL_CATALOG.find(
      (m) =>
        m.provider === cfg.default_model!.provider && m.modelId === cfg.default_model!.model_id,
    );
    expect(chosen?.supportsVision).toBe(true);
    // And it has to be routable as written: `deepseek-flash` begins with the family MMSP
    // routes to its DeepSeek client, so the preset entry for the default pins nothing — a
    // default that resolved to no client would fail every first request.
    const defaultEntry = cfg.models.find(
      (m) =>
        m.provider === cfg.default_model!.provider && m.model_id === cfg.default_model!.model_id,
    );
    expect(defaultEntry).toBeDefined();
    expect(defaultEntry?.client_type).toBeUndefined();
    expect(defaultEntry?.base_url).toBeUndefined();
    // The catalog is presented in full, retired rows aside (they are kept only for Projects
    // that already carry them): provider and model_id are separate columns, model_id being the
    // plain upstream id (vision is only persisted as false for models that don't support images).
    expect(cfg.models.map((m) => [m.provider, m.model_id])).toEqual(
      MODEL_CATALOG.filter((m) => m.retired !== true).map((m) => [m.provider, m.modelId]),
    );
    for (const entry of cfg.models) {
      const cat = MODEL_CATALOG.find(
        (c) => c.provider === entry.provider && c.modelId === entry.model_id,
      )!;
      expect(entry.vision).toBe(cat.supportsVision ? undefined : false);
      // A catalog entry without a list price would preset no pricing (none currently);
      // every priced catalog entry stores USD pricing.
      if (cat.pricing === undefined) expect(entry.pricing).toBeUndefined();
      else expect(entry.pricing?.unit).toBe("usd_per_mtok");
      // No key on any row. The protocol and endpoint come from the file alone — the row's own
      // where it differs from its group, else the group's table the config carries beside the
      // rows: a model that auto-routes resolves to no client_type, a gateway model to its pin
      // (OpenRouter openai-responses, the other gateways openai-chat) and its preset base URL.
      expect(entry.api_key).toBeUndefined();
      const effective = effectiveConnection(
        {
          provider: entry.provider,
          modelId: entry.model_id,
          clientType: entry.client_type,
          baseUrl: entry.base_url,
        },
        providerConnectionShape(cfg.providers?.[entry.provider]),
      );
      expect(effective.clientType).toBe(cat.clientType);
      expect(effective.baseUrl).toBe(cat.baseUrl);
    }
    // The group tables are the catalog's, written once: a gateway's endpoint lives there, a
    // first-party vendor has none (its client's own endpoint).
    expect(cfg.providers).toEqual(presetProviderTable());
    expect(cfg.providers?.openrouter?.base_url).toBe("https://openrouter.ai/api/v1");
    expect(cfg.providers?.deepseek).toBeUndefined();
  });
});

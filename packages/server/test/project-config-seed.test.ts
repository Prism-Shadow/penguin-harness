/**
 * A new Project's seed, as the server writes it (presetProjectConfig): core's default config
 * carries no models, so everything model-related here is the catalog's.
 *
 * - Given a new Project, it names no default model (its owner chooses one), every preset row
 *   resolves to its catalog protocol and endpoint from the file alone, the group tables are the
 *   catalog's (a first-party vendor has none), and no row carries a key.
 */
import { describe, expect, it } from "vitest";
import { effectiveConnection, providerConnectionShape } from "@prismshadow/penguin-core";
import { MODEL_CATALOG, presetProviderTable } from "../src/model-catalog/index.js";
import { presetProjectConfig } from "../src/services/project-config-seed.js";

describe("the seed of a new Project", () => {
  it("a new Project gets the whole catalog with no default model: every preset row on the file alone, the group tables and no key", () => {
    const cfg = presetProjectConfig();
    // Nobody chose a model yet: the first-run guide asks the owner for one.
    expect(cfg.default_model).toBeUndefined();
    expect(cfg.vision_model).toBeUndefined();
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

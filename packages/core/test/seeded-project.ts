/**
 * A Project config the way a host seeds one, cut down to what the SDK's tests run on. Core
 * carries no model catalog (PRN-021): the server writes a new Project's models, groups and
 * default model from its own, and `loadProjectConfig` answers a missing file with no models at
 * all. A test that creates Sessions on the default model therefore writes this first, as a host
 * would.
 *
 * The first-party groups have no table, so their keyless rows name no base URL anywhere: MMSP is
 * handed nothing and its client reads the vendor variable (stubProviderKeys stubs those). The
 * gateway group names its endpoint and protocol and holds no key, so its keyless rows are
 * refused. Facts (context windows, vision
 * flags, list prices) are the catalog's for these rows.
 */
import { DEFAULT_PROJECT_ID, saveProjectConfig } from "../src/index.js";
import type { ProjectConfig } from "../src/index.js";

const usd = (cacheRead: number, cacheWrite: number, output: number) => ({
  unit: "usd_per_mtok" as const,
  cache_read: cacheRead,
  cache_write: cacheWrite,
  output,
});

/** The seeded Project: DeepSeek's Flash as the default, three first-party vendors and one gateway. */
export function seededProjectConfig(): ProjectConfig {
  return {
    default_model: { provider: "deepseek", model_id: "deepseek-flash" },
    providers: {
      tokendance: { base_url: "https://tokendance.space/gateway/v1", client_type: "openai-chat" },
    },
    models: [
      {
        provider: "deepseek",
        model_id: "deepseek-flash",
        context_window: 1_000_000,
        pricing: usd(0.04 / 7, 2 / 7, 8 / 7),
      },
      {
        provider: "deepseek",
        model_id: "deepseek-v4-pro",
        context_window: 1_000_000,
        pricing: usd(0.3 / 7, 9 / 7, 27 / 7),
        vision: false,
      },
      {
        provider: "anthropic",
        model_id: "claude-sonnet-4-6",
        context_window: 1_000_000,
        pricing: usd(0.3, 3.75, 15),
      },
      {
        provider: "anthropic",
        model_id: "claude-opus-4-7",
        context_window: 1_000_000,
        pricing: usd(0.5, 6.25, 25),
      },
      {
        provider: "openai",
        model_id: "gpt-6-astra",
        context_window: 1_050_000,
        pricing: usd(1, 12.5, 50),
      },
      {
        provider: "tokendance",
        model_id: "glm-5.3",
        context_window: 1_000_000,
        pricing: usd(2 / 7, 8 / 7, 28 / 7),
        vision: false,
      },
    ],
  };
}

/** Writes the seeded Project's config under `root`, as a host does when it creates a Project. */
export async function seedProject(root: string, projectId = DEFAULT_PROJECT_ID): Promise<void> {
  await saveProjectConfig(root, projectId, seededProjectConfig());
}

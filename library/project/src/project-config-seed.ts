/**
 * The seed of a Project's config: what the server writes when a Project is created
 * (ProjectConfigService.writeInitialConfig and the onboarding backfill, ensurePresetModels) and
 * what "Restore defaults" puts back (restorePresets). Core carries no model knowledge, so the
 * catalog's part comes from the server's built-in catalog; nothing reads the seed when a
 * request is built.
 */
import { defaultProjectConfig } from "@prismshadow/penguin-core";
import type { ProjectConfig } from "@prismshadow/penguin-core";
import {
  presetModelEntries,
  presetProviderTable,
} from "@prismshadow/penguin-library-model/model-catalog/seed";

/**
 * What a new Project's file holds, and what "Restore defaults" puts back: core's default config
 * (the factory command policy, and no models — core carries no model knowledge) with each
 * built-in group's `[providers.<id>]` table (none for the first-party groups, whose rows go to the
 * client's defaults) and the preset rows. No default model: the user chooses one, in the Web
 * App's first-run guide or with `penguin config model default`, rather than inheriting a model
 * nobody picked (and most often holding no key). No keys:
 * the user fills in an API key once per group, or leaves a first-party group's blank for the
 * vendor's environment variable. From here on the file alone says where every request goes; the
 * catalog is not read again when one is built.
 */
export function presetProjectConfig(): ProjectConfig {
  return {
    ...defaultProjectConfig(),
    providers: presetProviderTable(),
    models: presetModelEntries(),
  };
}

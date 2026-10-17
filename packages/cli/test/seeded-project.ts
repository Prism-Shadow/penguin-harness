/**
 * A Project as the server seeds one when it creates it: core's default config with the built-in
 * catalog's default model, group tables (none for the first-party groups) and preset rows.
 * Core carries no catalog (PRN-021), so the CLI's config commands, which read and write the
 * file directly, find a missing file empty; these tests start from a seeded Project, as a user's
 * does.
 */
import {
  DEFAULT_PROJECT_ID,
  defaultProjectConfig,
  saveProjectConfig,
} from "@prismshadow/penguin-core";
import {
  PRESET_DEFAULT_MODEL,
  presetModelEntries,
  presetProviderTable,
} from "@prismshadow/penguin-server/model-catalog";

/** Writes the seeded Project's config under `root`. */
export async function seedProject(root: string, projectId = DEFAULT_PROJECT_ID): Promise<void> {
  await saveProjectConfig(root, projectId, {
    ...defaultProjectConfig(),
    default_model: { ...PRESET_DEFAULT_MODEL },
    providers: presetProviderTable(),
    models: presetModelEntries(),
  });
}

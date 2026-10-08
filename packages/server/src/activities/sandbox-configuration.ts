/**
 * The configuration a module receives in the preview.
 *
 * The sandbox so far builds the module, serves its media, runs assessment sessions and
 * admits runtime AI. What is still missing is the thing the module asks for first: the
 * activity payload the learner runtime fetches, which carries the module's configuration,
 * its layout and its compartments.
 *
 * All of this is a pure transform over configuration already on disk. Reading the files is
 * the service's job; deciding what the module should see is this.
 */

/** Loom's version for a payload the sandbox made up rather than a deployment produced. */
export const PREVIEW_ACTIVITY_VERSION = 1;

/** A language group key, as the manifest and the configuration both spell it. */
export function isLanguageCode(value: unknown): boolean {
  return /^[a-z]{2}-[A-Z]{2}$/.test(String(value ?? "").trim());
}

const DEFAULT_LANGUAGE = "en-US";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * The module's own configuration, whether or not it arrives wrapped in its id.
 *
 * A configuration file may hold `{ "<moduleId>": { ... } }` or the contents directly.
 * Unwrapping only the single-key case is deliberate: a configuration that happens to have
 * one key named after the module is the wrapper, and one with several keys is the contents.
 *
 * `alsoKeyedBy` names other wrappers that count: Penguin's assembly wraps a configuration
 * in the product code while its definition's id is the activity's, where Loom's modules
 * use one name for both.
 */
export function unwrapModuleConfiguration(
  configuration: unknown,
  moduleId: string,
  alsoKeyedBy: readonly string[] = [],
): Record<string, unknown> {
  if (!isRecord(configuration)) return {};
  const keys = Object.keys(configuration);
  const key = keys[0];
  if (
    keys.length === 1 &&
    key !== undefined &&
    (key === moduleId || alsoKeyedBy.includes(key)) &&
    isRecord(configuration[key])
  )
    return configuration[key] as Record<string, unknown>;
  return configuration;
}

/** Whether this configuration is grouped by language at all. */
export function hasLanguageGroups(configuration: Record<string, unknown>): boolean {
  return Object.keys(configuration).some(isLanguageCode);
}

/**
 * The configuration for one language, with the default layered underneath it.
 *
 * The layering is the whole point. A translated activity carries only what differs from the
 * default group; serving the requested group alone would give a half-translated activity
 * missing scenes, and serving them unmerged would make the module choose. Both groups are
 * sent — the module still expects to find the default — but the requested one is complete.
 *
 * A language this configuration does not have falls back to the default rather than
 * failing: the activity plays in English, which is visibly wrong and therefore reportable,
 * instead of not playing at all.
 */
export function scopeConfigurationToLanguage(
  configuration: Record<string, unknown>,
  languageCode: string | null | undefined,
): Record<string, unknown> {
  if (!hasLanguageGroups(configuration)) return configuration;
  const requested = String(languageCode ?? "").trim() || DEFAULT_LANGUAGE;
  const scoped = Object.fromEntries(
    Object.entries(configuration).filter(([key]) => !isLanguageCode(key)),
  );
  const fallback = isRecord(configuration[DEFAULT_LANGUAGE])
    ? (configuration[DEFAULT_LANGUAGE] as Record<string, unknown>)
    : null;
  const wanted = isRecord(configuration[requested])
    ? (configuration[requested] as Record<string, unknown>)
    : null;

  if (fallback) scoped[DEFAULT_LANGUAGE] = { ...fallback };
  if (requested !== DEFAULT_LANGUAGE && wanted)
    scoped[requested] = { ...(fallback ?? {}), ...wanted };
  return scoped;
}

/**
 * The scene a preview starts on.
 *
 * `__loomPreview` is not a name chosen here: the module templates this harness generates
 * already read `configuration.__loomPreview.startSceneId` before the state machine boots,
 * and the book reader entry does the same. Changing it would break every module already
 * authored.
 *
 * Returns a new object rather than mutating: the configuration is read once per module and
 * served to every preview, and two previews on different scenes must not overwrite each
 * other's start.
 */
export function withPreviewStartScene(
  configuration: Record<string, unknown>,
  startSceneId: string | null | undefined,
): Record<string, unknown> {
  const sceneId = String(startSceneId ?? "").trim();
  if (!sceneId) return configuration;
  const existing = isRecord(configuration.__loomPreview) ? configuration.__loomPreview : {};
  return { ...configuration, __loomPreview: { ...existing, startSceneId: sceneId } };
}

export interface CompartmentDeclaration {
  id: string;
  [key: string]: unknown;
}

export interface PayloadInput {
  moduleId: string;
  title: string;
  layout: string;
  resolution: string;
  /** The module's own declaration, and the navbar's, which every layout carries. */
  declaration: CompartmentDeclaration;
  navBarDeclaration: CompartmentDeclaration;
  configuration: Record<string, unknown>;
  navBarConfiguration: Record<string, unknown>;
  /** Set only when the activity has assessment items; absent is not zero. */
  hasAssessment: boolean;
}

export interface ActivityPayload {
  id: string;
  version: number;
  title: string;
  assessmentKey?: string;
  assessmentVersion?: number;
  configuration: Record<string, unknown>;
  layout: {
    name: string;
    compartments: { main: CompartmentDeclaration; navBar: CompartmentDeclaration };
  };
}

/**
 * The payload the learner runtime fetches for an activity.
 *
 * The id is prefixed so nothing mistakes a preview for a deployed activity — the same
 * payload shape reaches the same runtime, and the only thing separating them is this.
 *
 * The assessment keys are omitted rather than nulled when there is no assessment: the
 * runtime treats their presence as the signal to start a session, so an empty key would
 * open a session with nothing in it.
 */
export function activityPayload(input: PayloadInput): ActivityPayload {
  return {
    id: `preview:${input.moduleId}`,
    version: PREVIEW_ACTIVITY_VERSION,
    title: input.title,
    ...(input.hasAssessment
      ? { assessmentKey: input.moduleId, assessmentVersion: PREVIEW_ACTIVITY_VERSION }
      : {}),
    configuration: {
      resolution: input.resolution,
      [input.declaration.id]: input.configuration,
      [input.navBarDeclaration.id]: input.navBarConfiguration,
    },
    layout: {
      name: input.layout,
      compartments: { main: input.declaration, navBar: input.navBarDeclaration },
    },
  };
}

/**
 * What the module chooser lists.
 *
 * Deliberately smaller than the payload: a list that carried whole configurations would
 * read every module's files to draw a dropdown.
 */
export interface ModuleSummary {
  id: string;
  label: string;
  hasAssessment: boolean;
}

export function moduleSummaries(
  entries: readonly { id: string; label?: string | null; hasAssessment?: boolean }[],
): ModuleSummary[] {
  return entries
    .map((entry) => ({
      id: entry.id,
      // A module with no label shows its id, which is what an author typed.
      label: entry.label?.trim() || entry.id,
      hasAssessment: entry.hasAssessment === true,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

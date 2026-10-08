/**
 * The state machine a ref's configuration carries, ported from Loom's
 * `app/services/state_machine/configuration.py` and `activity_spec/scene_catalog.py`.
 *
 * `waf-state-machine` boots from the product configuration, not from the module's
 * `spec/state-machine.json`: it reads `stateMachine` and validates `activityScenes` against
 * its top-level scenes. Both are derived, the machine from that file and the catalog from
 * the specification, so Loom rewrites them whenever either changes. A configuration without
 * them loads its module and then stops with "State machine definition must be an object."
 */
import fs from "node:fs/promises";
import path from "node:path";

export const STATE_MACHINE_CONFIGURATION_KEY = "stateMachine";
export const ACTIVITY_SCENES_CONFIGURATION_KEY = "activityScenes";
const LEGACY_ACTIVITY_MACHINE_CONFIGURATION_KEY = "activityMachine";
const GENERAL_SCENE_ID = "general";
const SCAFFOLD_PLACEHOLDER_SCENE_ID = "scaffold-placeholder";

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keys(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) =>
        isRecord(entry) && typeof entry.key === "string" ? [entry.key] : [],
      )
    : [];
}

function isGeneralScene(scene: Json): boolean {
  const role = String(scene.role ?? "")
    .trim()
    .toLowerCase();
  if (role === "general") return true;
  return (
    !role &&
    String(scene.id ?? "")
      .trim()
      .toLowerCase() === GENERAL_SCENE_ID
  );
}

/** Each scene's id, description and media keys, as `waf-state-machine`'s scene catalog reads them. */
export function activitySceneCatalog(spec: unknown): Json[] {
  // A specification may still name its scenes `stages`; the scaffold builds the machine from
  // either, so the catalog must too or the player rejects the machine's scene ids.
  const rawScenes = isRecord(spec) ? (spec.scenes ?? spec.stages) : undefined;
  const scenes = Array.isArray(rawScenes) ? rawScenes.filter(isRecord) : [];
  const entries = scenes.map((scene) => {
    const media = isRecord(scene.media) ? scene.media : {};
    const audio = isRecord(scene.audio) ? scene.audio : {};
    return {
      animationKeys: keys(media.animations),
      audioKeys: keys(audio.tracks),
      description: typeof scene.description === "string" ? scene.description : "",
      id: scene.id,
      imageKeys: keys(media.images),
      videoKeys: keys(media.video),
    };
  });
  if (scenes.some((scene) => !isGeneralScene(scene))) return entries;
  return [
    ...entries,
    {
      animationKeys: [],
      audioKeys: [],
      description: "Run generate_activity_spec to scaffold scene behavior.",
      id: SCAFFOLD_PLACEHOLDER_SCENE_ID,
      imageKeys: [],
      videoKeys: [],
    },
  ];
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Writes the machine and the scene catalog into the product's configuration, in place, and
 * drops the legacy `activityMachine`. True when anything changed.
 *
 * A null machine leaves `stateMachine` as it is; a null spec removes the catalog.
 */
export function syncStateMachineConfiguration(
  configuration: Json,
  productCode: string,
  machine: Json | null,
  spec: unknown,
): boolean {
  let changed = false;
  let product = configuration[productCode];
  if (!isRecord(product)) {
    product = {};
    configuration[productCode] = product;
    changed = true;
  }
  const productConfiguration = product as Json;
  for (const key of [STATE_MACHINE_CONFIGURATION_KEY, LEGACY_ACTIVITY_MACHINE_CONFIGURATION_KEY])
    if (key in configuration) {
      delete configuration[key];
      changed = true;
    }
  if (LEGACY_ACTIVITY_MACHINE_CONFIGURATION_KEY in productConfiguration) {
    delete productConfiguration[LEGACY_ACTIVITY_MACHINE_CONFIGURATION_KEY];
    changed = true;
  }
  if (machine && !same(productConfiguration[STATE_MACHINE_CONFIGURATION_KEY], machine)) {
    productConfiguration[STATE_MACHINE_CONFIGURATION_KEY] = machine;
    changed = true;
  }
  if (spec == null) {
    if (ACTIVITY_SCENES_CONFIGURATION_KEY in productConfiguration) {
      delete productConfiguration[ACTIVITY_SCENES_CONFIGURATION_KEY];
      changed = true;
    }
    return changed;
  }
  const catalog = activitySceneCatalog(spec);
  if (!same(productConfiguration[ACTIVITY_SCENES_CONFIGURATION_KEY], catalog)) {
    productConfiguration[ACTIVITY_SCENES_CONFIGURATION_KEY] = catalog;
    changed = true;
  }
  return changed;
}

/**
 * The module's state machine: the product's `spec/state-machine.json`, where Loom keeps it,
 * else the ref's, where Penguin's scaffold writes it. Null when the module has neither, as
 * a legacy sequence module does — and then its configuration is left alone, as Loom does.
 */
export async function readModuleStateMachine(
  moduleRoot: string,
  productCode: string,
  refNum: number,
): Promise<Json | null> {
  const product = path.join(moduleRoot, "generated", productCode);
  for (const file of [
    path.join(product, "spec", "state-machine.json"),
    path.join(product, "refs", `${productCode}-${refNum}`, "spec", "state-machine.json"),
  ]) {
    const text = await fs.readFile(file, "utf8").catch(() => null);
    if (text === null) continue;
    const machine: unknown = JSON.parse(text);
    return isRecord(machine) ? machine : null;
  }
  return null;
}

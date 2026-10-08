export const ACTIVITY_SCENES_CONFIGURATION_KEY = 'activityScenes';

export interface ActivitySceneMetadata {
  readonly animationKeys: readonly string[];
  readonly audioKeys: readonly string[];
  readonly description: string;
  readonly id: string;
  readonly imageKeys: readonly string[];
  readonly videoKeys: readonly string[];
}

export interface ActivitySceneCatalog {
  readonly sceneIds: readonly string[];
  scene(sceneId: string): ActivitySceneMetadata;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  return Object.freeze([...new Set(value)]);
}

function sceneMetadata(value: unknown, index: number): ActivitySceneMetadata {
  const scene = objectValue(value, `Activity scene at index ${index}`);
  const label = `Activity scene at index ${index}`;
  return Object.freeze({
    animationKeys: stringArray(scene.animationKeys, `${label}.animationKeys`),
    audioKeys: stringArray(scene.audioKeys, `${label}.audioKeys`),
    description: typeof scene.description === 'string' ? scene.description : '',
    id: stringValue(scene.id, `${label}.id`),
    imageKeys: stringArray(scene.imageKeys, `${label}.imageKeys`),
    videoKeys: stringArray(scene.videoKeys, `${label}.videoKeys`),
  });
}

export function sceneCatalogFromConfiguration(
  configuration: Readonly<Record<string, unknown>>,
  expectedSceneIds?: readonly string[],
): ActivitySceneCatalog {
  const configuredScenes = configuration[ACTIVITY_SCENES_CONFIGURATION_KEY];
  if (!Array.isArray(configuredScenes)) {
    throw new Error(`Activity configuration requires an "${ACTIVITY_SCENES_CONFIGURATION_KEY}" array.`);
  }

  const scenes = configuredScenes.map(sceneMetadata);
  const byId = new Map<string, ActivitySceneMetadata>();
  scenes.forEach((scene) => {
    if (byId.has(scene.id)) {
      throw new Error(`Activity scene "${scene.id}" is defined more than once.`);
    }
    byId.set(scene.id, scene);
  });
  if (expectedSceneIds) {
    expectedSceneIds.forEach((sceneId) => {
      if (!byId.has(sceneId)) {
        throw new Error(`Activity scene catalog is missing state machine scene "${sceneId}".`);
      }
    });
  }
  const sceneIds = Object.freeze(scenes.map((scene) => scene.id));

  return Object.freeze({
    sceneIds,
    scene(sceneId: string): ActivitySceneMetadata {
      const scene = byId.get(sceneId);
      if (!scene) {
        throw new Error(`Unknown activity scene "${sceneId}".`);
      }
      return scene;
    },
  });
}

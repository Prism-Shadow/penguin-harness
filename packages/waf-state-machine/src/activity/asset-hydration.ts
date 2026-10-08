import { getPlayOperation, getSpeechPlayOperation, isObject, loadAssets } from 'waf-utils';

type Configuration = Record<string, unknown>;
type Assets = Record<string, unknown>;

export interface HydrateAssetRequest {
  readonly deep?: boolean;
  readonly id: string;
}

export type HydrateSelectedAssets = (ids?: readonly (string | HydrateAssetRequest)[]) => Promise<void>;

function createPlayOperation(customClipUrl: string, channel = 'vocals'): unknown {
  return Object.assign(getPlayOperation({ audioPaths: [customClipUrl], channel }), { customClipUrl });
}

function setPathValue(configuration: Configuration, path: readonly string[], asset: unknown): void {
  const parts = [...path];
  const key = parts.pop();
  if (!key) {
    return;
  }
  let target = configuration;
  for (const part of parts) {
    const next = target[part];
    if (!isObject(next)) {
      return;
    }
    target = next;
  }
  target[key] = typeof Audio !== 'undefined' && asset instanceof Audio
    ? createPlayOperation(asset.src)
    : asset;
}

function configurationPropertyType(value: unknown): string {
  if (isObject(value)) {
    return value.customClipUrl ? 'speechPlayOperation' : 'data';
  }
  if (Array.isArray(value)) {
    return 'data';
  }
  if (typeof value !== 'string') {
    return '';
  }
  const extension = value.slice(value.lastIndexOf('.') + 1).toLowerCase();
  if (extension === 'mp3') return 'audio';
  if (['png', 'jpg', 'jpeg'].includes(extension)) return 'image';
  if (extension === 'json') return 'json';
  return '';
}

function collectConfigurationAssets(
  configuration: Configuration | unknown[],
  path: readonly string[],
  assets: Record<string, WafAssetDescriptor>,
): void {
  for (const [key, value] of Object.entries(configuration)) {
    if (path.length === 0 && (key === 'stateMachine' || key === 'activityMachine')) {
      continue;
    }
    const type = configurationPropertyType(value);
    if (!type) {
      continue;
    }
    if (type === 'data') {
      collectConfigurationAssets(value as Configuration | unknown[], [...path, key], assets);
      continue;
    }
    if (type === 'speechPlayOperation') {
      (configuration as Configuration)[key] = Object.assign(getSpeechPlayOperation(value as Configuration), value);
      continue;
    }
    assets[[...path, key].join('.')] = { id: [...path, key].join('.'), isDefinition: false, type, url: value as string };
  }
}

export function createSelectedAssetHydrator(configuration: Configuration, declarationAssets: Assets): HydrateSelectedAssets {
  const configurationAssets: Record<string, WafAssetDescriptor> = {};
  collectConfigurationAssets(configuration, [], configurationAssets);
  Object.assign(declarationAssets, configurationAssets);
  return async (ids = []): Promise<void> => {
    const requests = ids.map((entry) => typeof entry === 'string' ? { deep: false, id: entry } : entry);
    const selected = Object.entries(declarationAssets).flatMap(([id, descriptor]) => {
      const include = requests.some((request) => request.deep ? id === request.id || id.startsWith(`${request.id}.`) : id === request.id);
      return include && isObject(descriptor) ? [{ ...descriptor, id } as WafAssetDescriptor] : [];
    });
    const order: Record<string, number> = { audio: 0, json: 1, image: 2 };
    selected.sort((left, right) => (order[left.type] ?? 3) - (order[right.type] ?? 3));
    for (const descriptor of selected) {
      await loadAssets([descriptor]);
      if (descriptor.isDefinition !== false) {
        declarationAssets[descriptor.id] = typeof Audio !== 'undefined' && descriptor.asset instanceof Audio
          ? createPlayOperation(descriptor.asset.src)
          : descriptor.asset;
      } else {
        setPathValue(configuration, descriptor.id.split('.'), descriptor.asset);
        delete declarationAssets[descriptor.id];
      }
    }
  };
}

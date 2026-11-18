/**
 * The settings store, as the pet sees it: the server's settings mechanism, declared here as
 * the consumer's own interface so the package depends on no harness type.
 *
 * The shape is a subset of the server's `Settings` (its `get`, `set` and `watch`). `watch`
 * is what makes this interface name one store: the platform's preference store answers the
 * same `get`/`set` signatures but has no watch, so a module requiring this shape resolves to
 * the settings store alone. The pet's state lives under key `plugin-state:@penguinharness/pet`
 * — one JSON document, whole, that this plugin never parses into pieces.
 */
import { Interface } from "@prismshadow/penguin-core/plugin";
import { mergePetState } from "./pet-state.js";

@Interface()
export abstract class SettingsStore {
  abstract get(key: string): string | null;
  abstract set(key: string, value: string): void;
  /** Hears every write, by key. Returns the unsubscribe. */
  abstract watch(listener: (key: string) => void): () => void;
}

/** How the pet's faces reach one document: read it, or merge an update over it. */
export interface PetStateChannel {
  /** The stored document, as data (an object; an unparsable stored document reads as empty). */
  read(): unknown;
  /** Merges the update over the stored document, keeps it, and answers the merged document. */
  merge(update: Record<string, unknown>): Record<string, unknown>;
}

/** The key one plugin package's state lives under in the settings store. */
export const petStateKey = (pkg: string): string => `plugin-state:${pkg}`;

/**
 * The pet's state channel over the settings store: one JSON document per package, merged
 * shallowly (pet-state.ts owns the pet's facet rules). The server keeps the document whole
 * and never reads inside it — the shape is the plugin's own.
 */
export function petStateChannel(settings: SettingsStore, pkg: string): PetStateChannel {
  const key = petStateKey(pkg);
  const read = (): unknown => {
    const raw = settings.get(key);
    if (raw === null) return {};
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      // A stored document this build cannot parse reads as empty; a merge overwrites it.
      return {};
    }
  };
  return {
    read,
    merge(update) {
      const next = mergePetState(read(), update);
      settings.set(key, JSON.stringify(next));
      return next;
    },
  };
}

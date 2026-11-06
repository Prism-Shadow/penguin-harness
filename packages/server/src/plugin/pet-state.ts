/**
 * The pet plugin's state shape: the first user of the plugin state routes (widgets.ts), and
 * the shape every face of the pet shares — the CLI's `pet` commands, the widget's iframe
 * document, and whatever later reads it. One JSON document per package in the shared
 * settings store; this module owns its shape and its merge.
 *
 * The document is faceted, not one flat object: the PERSISTENT facet (the pet's name and its
 * fullness — what survives a restart and what `pet feed` and `pet name` write) stands beside
 * the TRANSIENT one (what the pet is doing right now, as its widget draws it), and a write
 * names its facet. The server merges shallowly; the facets keep each other from clobbering
 * what a concurrent face wrote.
 */
export interface PetState {
  /** The persistent facet. */
  pet?: {
    /** The pet's name; the widget and the commands print it. */
    name?: string;
    /** How fed the pet is, 0–100; feeding raises it, the widget's idle ticks lower it. */
    fullness?: number;
    /** Portions of food in the pantry; a feed eats one. Absent = none. */
    food?: number;
    /** Coins: earned from Token usage (1M tokens = 1 coin), spent on food in the widget's shop. */
    coins?: number;
    /** Lifetime Tokens already turned into coins — the waterline the widget's next sync measures from. */
    mined?: number;
    /** Whether the pet's one-off starter bowl was granted; true after the first run. */
    gift?: boolean;
    /** How often the pet speaks on its own: `off` | `rare` | `normal` | `chatty`. */
    talk?: string;
    /** How much of the page the pet may roam: `page` | `lower` | `dock` | `spot`. */
    area?: string;
  };
  /** The transient facet: what the pet is doing right now, as the widget draws it. */
  mood?: {
    /** `idle` | `walk` | `sit` | `sleep` | `eat` — the widget's animation phase. */
    doing?: string;
    /** One line the pet says in its bubble; absent = no bubble. */
    bubble?: string | null;
  };
}

/** Clamps a number into the fullness range; null when the value is not a finite number. */
function fullnessOf(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * A count the pet's document keeps non-negative: portions are whole, coins may be fractional
 * (a million Tokens is one coin, and usage arrives in smaller pieces than that).
 */
function amountOf(value: unknown, whole: boolean): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const n = whole ? Math.round(value) : Math.round(value * 100) / 100;
  return Math.max(0, n);
}

/** True when the value is a plain object (not an array, not null). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merges one pet-state update over the stored document: a shallow merge per facet, with the
 * fullness clamped into 0–100 and unknown facets kept as the update wrote them (the document
 * is the package's own — a future facet needs no server change). `null` drops its key.
 */
export function mergePetState(
  stored: unknown,
  update: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = isObject(stored) ? { ...stored } : {};
  for (const [facet, value] of Object.entries(update)) {
    if (value === null) {
      delete out[facet];
      continue;
    }
    if (facet === "pet" && isObject(value)) {
      const pet = { ...(isObject(out[facet]) ? (out[facet] as Record<string, unknown>) : {}) };
      if ("fullness" in value) {
        const fullness = fullnessOf(value.fullness);
        if (fullness === undefined) delete pet.fullness;
        else pet.fullness = fullness;
      }
      for (const [key, whole] of [
        ["food", true],
        ["coins", false],
      ] as const) {
        if (!(key in value)) continue;
        const amount = amountOf(value[key], whole);
        if (amount === undefined) delete pet[key];
        else pet[key] = amount;
      }
      for (const [k, v] of Object.entries(value)) {
        if (k === "fullness" || k === "food" || k === "coins") continue;
        if (v === null) delete pet[k];
        else pet[k] = v;
      }
      out[facet] = pet;
      continue;
    }
    if (isObject(value) && isObject(out[facet])) {
      const merged = { ...(out[facet] as Record<string, unknown>) };
      for (const [k, v] of Object.entries(value)) {
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      out[facet] = merged;
      continue;
    }
    out[facet] = value;
  }
  return out;
}

/**
 * The generic merge the state routes run (any package): a shallow merge with `null` dropping
 * its key. The pet's facets come in as plain nested objects and are handled by the generic
 * rule; `mergePetState` adds only the fullness clamp on top.
 */
export function mergeState(
  stored: unknown,
  update: Record<string, unknown>,
): Record<string, unknown> {
  return mergePetState(stored, update);
}

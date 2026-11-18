/**
 * The pet's state shape: the shape every face of the pet shares — the CLI's `pet` commands,
 * the widget's document, and whatever later reads it. One JSON document per package in the
 * server's shared settings store (key `plugin-state:@penguinharness/pet`); this module owns
 * its shape and its merge.
 *
 * The document is faceted, not one flat object: the PERSISTENT facet (the pet's name and its
 * fullness — what survives a restart and what `pet feed` and `pet name` write) stands beside
 * the TRANSIENT one (what the pet is doing right now, as her page draws it), and a write
 * names its facet. The merge is shallow per facet; the facets keep each other from clobbering
 * what a concurrent face wrote.
 */
export interface PetState {
  /** The persistent facet. */
  pet?: {
    /** The pet's name; the page and the commands print it. */
    name?: string;
    /** How fed the pet is, 0–100; feeding raises it, the page's idle ticks lower it. */
    fullness?: number;
    /** Portions of food in the pantry; a feed eats one. Absent = none. */
    food?: number;
    /** Coins: earned from Token usage (1M tokens = 1 coin), spent on food in the page's shop. */
    coins?: number;
    /** Lifetime Tokens already turned into coins — the waterline the page's next sync measures from. */
    mined?: number;
    /** Whether the pet's one-off starter bowl was granted; true after the first run. */
    gift?: boolean;
    /** How often the pet speaks on her own: `off` | `rare` | `normal` | `chatty`. */
    talk?: string;
    /** How much of the page the pet may roam: `page` | `lower` | `dock` | `spot`. */
    area?: string;
    /** The last day she was signed in for, and how many days in a row. */
    checkin?: { last?: string; streak?: number };
    /**
     * The pet's figure, as her driver reads it (ui/figure/contract.ts in the pet package):
     * `driver` is the package of the plugin whose `ui/figure.js` draws her
     * (`@penguinharness/pet-live2d-cubism`, `@penguinharness/pet-live2d-coopanion`); the rest
     * is that driver's own configuration — a model pack's path, a scheme — handed over
     * verbatim, never read here. Absent = no figure: the page stays up and says so.
     */
    figure?: { driver?: string; [key: string]: unknown };
  };
  /** The transient facet: what the pet is doing right now, as the page draws it. */
  mood?: {
    /** `idle` | `walk` | `sit` | `sleep` | `eat` — the page's animation phase. */
    doing?: string;
    /** One line the pet says in her bubble; absent = no bubble. */
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
 * is the plugin's own — a future facet needs no kernel change). `null` drops its key.
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
      // One pass over the update's own keys, in their order: the stored facet keeps its key
      // order, a new key lands where the update wrote it, and each known key gets its clamp.
      for (const [k, v] of Object.entries(value)) {
        if (k === "fullness") {
          const fullness = fullnessOf(v);
          if (fullness === undefined) delete pet.fullness;
          else pet.fullness = fullness;
        } else if (k === "food" || k === "coins") {
          const amount = amountOf(v, k === "food");
          if (amount === undefined) delete pet[k];
          else pet[k] = amount;
        } else if (v === null) delete pet[k];
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

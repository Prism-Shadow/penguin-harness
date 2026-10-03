/**
 * Telemetry's memoryCost estimate (PRFC-0008) for a value it cannot ask the engine about:
 * a walk that adds two bytes per string character, eight per number and a flat overhead per
 * object, array and property. It allocates nothing beyond its own stack and seen-set, and
 * a shared or cyclic object counts once.
 *
 * TODO(telemetry-memory): an estimate, not the heap's answer — no hidden classes, no
 * interning, no shared backing stores. Replace it with a V8 measurement (heap statistics or
 * a sampled heap profile) once one is chosen; this module is then deleted.
 */

const OBJECT_OVERHEAD = 16;
const PROPERTY_OVERHEAD = 8;
const NUMBER_BYTES = 8;

/** Walks at most this many objects; past it the estimate stops growing rather than stalling a read. */
const MAX_OBJECTS = 1_000_000;

export function estimateBytes(root: unknown): number {
  let bytes = 0;
  const seen = new Set<object>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value === "string") bytes += value.length * 2;
    else if (typeof value === "number" || typeof value === "bigint") bytes += NUMBER_BYTES;
    else if (typeof value === "object" && value !== null) {
      if (seen.has(value) || seen.size >= MAX_OBJECTS) continue;
      seen.add(value);
      bytes += OBJECT_OVERHEAD;
      for (const key of Object.keys(value)) {
        bytes += PROPERTY_OVERHEAD + key.length * 2;
        stack.push((value as Record<string, unknown>)[key]);
      }
    }
  }
  return bytes;
}

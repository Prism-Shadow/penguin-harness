/**
 * Random ids for the things the browser mints on its own: parked drafts, user shortcuts.
 *
 * Drawn from `crypto.getRandomValues`, not `crypto.randomUUID`. The latter exists only in a
 * secure context (HTTPS, or localhost), so a Web App opened over plain HTTP from any address but
 * localhost has no such function, and the first id it tried to mint threw — which is how the "+"
 * button died as soon as there was a typed draft to park. `getRandomValues` is present wherever
 * `crypto` is at all.
 */

/** `length` random lowercase hex characters. */
export function randomHex(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(length / 2)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

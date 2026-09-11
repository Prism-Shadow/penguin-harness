/**
 * A v4 UUID for the client-side ids the draft screen mints — never for a secret.
 *
 * `crypto.randomUUID` is defined only in a **secure context**: HTTPS, `localhost`, or a
 * `file://` document. A harness served over plain HTTP on a LAN address (the common
 * `http://<host>:7364` deployment) is not one, and there `crypto` exists while
 * `crypto.randomUUID` is `undefined` — so every caller that reached for it threw
 * `TypeError: crypto.randomUUID is not a function` at the moment of the click, before any
 * request left the browser. `crypto.getRandomValues` carries no such restriction, so the id
 * is assembled from it instead; a secure context gets an equally random id, and the two
 * callers (the parked-draft id and the saved-shortcut id) behave identically either way.
 *
 * These ids are opaque handles the server stores and hands back — nothing authenticates
 * against them, nothing is derived from them — so the fallback below weakens nothing that
 * was ever a guarantee. Keep it that way: an id that has to be unguessable belongs on the
 * server, not here.
 */
export function randomUuid(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    // No Web Crypto at all (a test shim, an embedded view): `Math.random` still separates
    // two ids minted in the same session, which is all these handles need.
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // RFC 4122 version 4 (random) and variant, written as the bytes are hex-encoded, so the
  // shape matches what `randomUUID` returns without re-reading the array.
  const hex = Array.from(bytes, (byte, i) => {
    if (i === 6) return ((byte & 0x0f) | 0x40).toString(16).padStart(2, "0");
    if (i === 8) return ((byte & 0x3f) | 0x80).toString(16).padStart(2, "0");
    return byte.toString(16).padStart(2, "0");
  }).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

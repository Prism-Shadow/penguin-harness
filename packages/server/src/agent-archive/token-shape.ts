/**
 * Whether a string looks like a token — an API key, an access token — whatever it is called. The
 * MCP blanking (mcp-credentials.ts) and the Trace scrub (vault-scrub.ts) use the same test.
 *
 * A token is 16 characters or more of the characters tokens are written in, letters and digits
 * both, no spaces, and high in entropy. A structured name is not one, however random it looks
 * as a whole: a path (`/etc/penguin/store.p12`, `./data2024/run7`), a package (`mcp-server-
 * github2`; `@scope/name@1.2.3` never passes the characters anyway), a dotted version, a file
 * name with an extension (`app2.config.json`). Such a name is a token only through a part that is
 * one by itself: `/run/secrets/<40 random characters>` still counts.
 */

const TOKEN_MIN_LENGTH = 16;
const TOKEN_SHAPE = /^[A-Za-z0-9+/=_.~-]+$/;
const MIN_TOKEN_ENTROPY = 3.5;
/** Below this, a short part of a name reads as a word rather than as random characters. */
const MIN_PART_ENTROPY = 3;

const PATH_START = /^(\/|~\/|\.\/|\.\.\/)/;
const PLAIN_PART = /^[A-Za-z0-9._-]+$/;
const VERSION = /^v?\d+(\.\d+)+([-+][0-9A-Za-z.-]+)?$/;
const PACKAGE_NAME = /^[a-z0-9][a-z0-9._-]*$/;
const FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*\.[A-Za-z][A-Za-z0-9]{0,9}$/;

/** Shannon entropy of a string, in bits per character. */
function entropy(text: string): number {
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** The shape alone: long enough, letters and digits, random enough. */
function looksRandom(value: string): boolean {
  return (
    value.length >= TOKEN_MIN_LENGTH &&
    TOKEN_SHAPE.test(value) &&
    /[A-Za-z]/.test(value) &&
    /\d/.test(value) &&
    entropy(value) >= MIN_TOKEN_ENTROPY
  );
}

/** A part of a name that reads as a word: no mix of letters and digits, or little entropy. */
const wordLike = (part: string): boolean =>
  !/[A-Za-z]/.test(part) || !/\d/.test(part) || entropy(part) < MIN_PART_ENTROPY;

/** The parts of a structured name (a path, a version, a package, a file name); null otherwise. */
function partsOf(value: string): string[] | null {
  if (value.includes("/")) {
    const parts = value.split("/").filter((part) => part !== "");
    const plain = parts.every((part) => PLAIN_PART.test(part));
    return PATH_START.test(value) || (plain && parts.some(wordLike)) ? parts : null;
  }
  if (VERSION.test(value)) return value.split(/[.+-]/);
  if (PACKAGE_NAME.test(value)) return value.split(/[._-]/);
  if (FILE_NAME.test(value)) return value.split(".");
  return null;
}

export function isTokenShaped(value: string): boolean {
  if (!looksRandom(value)) return false;
  const parts = partsOf(value);
  return parts === null || parts.some(looksRandom);
}

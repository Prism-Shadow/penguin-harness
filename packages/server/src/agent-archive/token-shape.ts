/**
 * Whether a string looks like a token — an API key, an access token — whatever it is called: 16
 * characters or more of the characters tokens are written in, letters and digits both, no
 * spaces, and high in entropy. The MCP blanking (mcp-credentials.ts) and the Trace scrub
 * (vault-scrub.ts) use the same test.
 */

const TOKEN_MIN_LENGTH = 16;
const TOKEN_SHAPE = /^[A-Za-z0-9+/=_.~-]+$/;
const MIN_TOKEN_ENTROPY = 3.5;

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

export function isTokenShaped(value: string): boolean {
  return (
    value.length >= TOKEN_MIN_LENGTH &&
    TOKEN_SHAPE.test(value) &&
    /[A-Za-z]/.test(value) &&
    /\d/.test(value) &&
    entropy(value) >= MIN_TOKEN_ENTROPY
  );
}

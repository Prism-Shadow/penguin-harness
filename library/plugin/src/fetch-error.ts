/**
 * A failed fetch in words a person can act on. undici rejects with a bare `TypeError: fetch
 * failed` and keeps what actually happened underneath it, in `cause`: the resolver's miss, the
 * refused or reset connection, the certificate the TLS handshake would not accept, the proxy
 * that would not open a tunnel. When a host resolves to several addresses and each was tried,
 * that cause is an `AggregateError` whose own message is empty and whose `errors` each say what
 * happened at one address. A message that stops at the outermost layer therefore says nothing
 * about why; this walks the chain and keeps every layer that says something.
 */

/** One layer's own words: its message, with its `code` when the message does not already say it. */
function layerWords(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const { code } = err as { code?: unknown };
  const message = err.message.trim();
  if (typeof code === "string" && code !== "" && !message.includes(code)) {
    return message === "" ? code : `${message} [${code}]`;
  }
  return message === "" ? err.name : message;
}

/**
 * The failure as one line: the outermost message, then what lay under it in parentheses —
 * `fetch failed (getaddrinfo ENOTFOUND example.com)`, or for several addresses
 * `fetch failed (connect ETIMEDOUT 192.0.2.1:443; connect ENETUNREACH 2001:db8::1:443)`. A layer
 * that only repeats the one above it is left out, and the walk stops at a depth no real chain
 * reaches, so a cause that loops back on itself cannot hang it.
 */
export function fetchFailureText(err: unknown): string {
  const head = layerWords(err);
  const under: string[] = [];
  let current: unknown = err instanceof Error ? err.cause : undefined;
  for (let depth = 0; current !== undefined && current !== null && depth < 8; depth += 1) {
    if (current instanceof AggregateError && current.errors.length > 0) {
      for (const one of current.errors) {
        const words = layerWords(one);
        if (!under.includes(words)) under.push(words);
      }
      break;
    }
    const words = layerWords(current);
    if (words !== head && !under.includes(words)) under.push(words);
    current = current instanceof Error ? current.cause : undefined;
  }
  return under.length === 0 ? head : `${head} (${under.join("; ")})`;
}

/**
 * The parts of a URL an Agent archive treats as secret: its user info (`user:password@`, or a
 * user alone, which is as often a token: `https://<token>@host`). The MCP blanking
 * (mcp-credentials.ts) and the Trace scrub (vault-scrub.ts) read a URL the same way here.
 */

/** Where a URL's authority (`user:password@host:port`) starts and ends in `text`, from `://`. */
export function authorityOf(text: string): { start: number; end: number } | null {
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.exec(text);
  if (scheme === null) return null;
  const start = scheme[0].length;
  const stop = text.slice(start).search(/[/?#]/);
  return { start, end: stop < 0 ? text.length : start + stop };
}

/**
 * Where the user info of the URL `text` starts with lies (`start` to `end`, the `@` excluded),
 * and where its password starts (after the first `:`), or null for a user alone; null when the
 * URL has no user info. The host follows the last `@`, so a password holding one, unescaped, is
 * still all password.
 */
export function userInfoOf(
  text: string,
): { start: number; end: number; password: number | null } | null {
  const authority = authorityOf(text);
  if (authority === null) return null;
  const at = text.lastIndexOf("@", authority.end - 1);
  if (at < authority.start) return null;
  const colon = text.indexOf(":", authority.start);
  return { start: authority.start, end: at, password: colon >= 0 && colon < at ? colon + 1 : null };
}

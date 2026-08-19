/**
 * Pure target-safety check for deploy.mjs, split into its own module so it can be
 * imported (and smoke-checked with `node -e`) without deploy.mjs's top-level argv/env
 * side effects — deploy.mjs is a one-shot script, not a library, so everything else in
 * it runs immediately on import.
 */

/** Hostnames that never leave this machine, so plaintext HTTP to them is not a wire secret. */
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * Refuses a target that would send PENGUIN_ADMIN_PASSWORD in the clear: deploy.mjs's
 * login() posts it as a JSON body, and `http://` to anything off this machine puts it
 * on the wire readable by anyone on the path. `https://` is always fine; plain
 * `http://` is only fine to a loopback hostname (the documented `ssh -L` tunnel case —
 * that traffic never leaves the machine). Returns a human-readable reason string when
 * unsafe, `null` when the target is fine to send credentials to.
 */
export function unsafePlaintextTarget(urlStr) {
  const url = new URL(urlStr);
  if (url.protocol === "https:") return null;
  if (LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase())) return null;
  return (
    `refusing to send PENGUIN_ADMIN_PASSWORD in plaintext to ${url.protocol}//${url.hostname} — ` +
    "serve over https:// instead, or reach the target through an `ssh -L` tunnel to 127.0.0.1."
  );
}

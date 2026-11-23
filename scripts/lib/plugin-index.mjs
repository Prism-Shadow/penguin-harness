/**
 * The published plugin index (Prism-Shadow/penguin-harness-plugins), as the build reads it: the
 * sha512 an entry registers for a package version, and the github channel it lists. A server
 * reads the same document through packages/server/src/plugin/registry.ts; the build reads only
 * the two fields it needs from it.
 *
 * The Pages copy rather than the six-hourly release asset a server reads by default: it is
 * rebuilt on every merge into the index, so a pin raised right after its entry merged is
 * compared with that entry, not with the index of six hours ago. `PENGUIN_PLUGIN_INDEX_URL`
 * names another.
 */

export const PLUGIN_INDEX_URL = "https://prism-shadow.github.io/penguin-harness-plugins/index.json";

/** How long one request may take before the source counts as unreachable. */
const TIMEOUT_MS = 60_000;

/** The index the environment names, or the published one. */
export function pluginIndexUrl(env = process.env) {
  return env.PENGUIN_PLUGIN_INDEX_URL || PLUGIN_INDEX_URL;
}

/** The index document at `url`: its entries. Throws when it cannot be read or is not an index. */
export async function readPluginIndex(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const doc = await res.json();
  if (!Array.isArray(doc)) throw new Error(`${url} is not a plugin index (not an array)`);
  return doc;
}

/** The entries an index carries for one package version (several contents may share it). */
function entriesOf(index, { name, version }) {
  return index.filter((e) => e?.name === name && e?.version === version);
}

/**
 * Why the index does not vouch for a pin's bytes — the version is not registered, or registered
 * with another sha512 — or null when an entry registers the sha512 pnpm-lock.yaml pins.
 */
export function indexProblem(index, pin) {
  const entries = entriesOf(index, pin);
  if (entries.length === 0) {
    return `${pin.name}@${pin.version} has no entry in the plugin index: register that version before the build pins it`;
  }
  if (entries.some((e) => e.integrity === pin.integrity)) return null;
  const registered = entries.map((e) => e.integrity ?? "(no integrity)").join(", ");
  return `${pin.name}@${pin.version}: pnpm-lock.yaml pins ${pin.integrity}, the plugin index registers ${registered}`;
}

/**
 * The index's verdict on every pin, read from `url`: `{ problems }`, one line per pin it does not
 * vouch for, or `{ skipped }` with the reason when the index cannot be read (an offline build
 * compares nothing and says so).
 */
export async function checkPinsAgainstIndex(pins, url) {
  let index;
  try {
    index = await readPluginIndex(url);
  } catch (err) {
    return { skipped: err instanceof Error ? err.message : String(err) };
  }
  return { problems: pins.map((pin) => indexProblem(index, pin)).filter((p) => p !== null) };
}

/**
 * The bytes of a pin from the github channel its index entry lists, fetched from the index at
 * `url`. Throws when the index cannot be read, lists no github channel for the version, or the
 * download fails; the caller checks what comes back against the lock.
 */
export async function fetchFromGithubChannel(pin, url) {
  const index = await readPluginIndex(url);
  const entries = entriesOf(index, pin);
  const entry = entries.find((e) => e.integrity === pin.integrity) ?? entries[0];
  const channel = entry?.channels?.find((c) => c?.kind === "github")?.url;
  if (typeof channel !== "string") {
    throw new Error(`the plugin index lists no github channel for ${pin.name}@${pin.version}`);
  }
  return fetchReleaseAsset(channel);
}

export async function fetchReleaseAsset(channel) {
  const res = await fetch(channel, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${channel} answered ${res.status}`);
  return { bytes: Buffer.from(await res.arrayBuffer()), source: channel };
}

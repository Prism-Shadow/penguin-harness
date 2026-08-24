/**
 * Agent config kernel versions: which generation of the built-in defaults a stored
 * `system_config.yaml` is based on, and the per-tab hash record that lets the kernel update
 * (see kernel-update.ts) tell "still the old default" apart from "customized by the user".
 *
 * A kernel version is a date string (`YYYY-MM-DD`). It advances **manually** and only when
 * the built-in defaults change substantively: the pinned-hash test in
 * `core/test/kernel-version.test.ts` recomputes every tab hash and fails the build whenever
 * `defaultSystemConfig()` drifts from `KERNEL_HISTORY.current` — the failure message names
 * the tabs that moved and spells out the edit each one needs. Several changes on the same day
 * may reuse that day's version rather than taking a new one.
 *
 * The user's own edits never move a config between generations: matching is purely by value
 * hash, and a tab that matches no recorded default is conservatively treated as customized.
 */
import { createHash } from "node:crypto";

/**
 * The current kernel version — the generation stamp `defaultSystemConfig()` carries in
 * `kernel_version`, so newly created (and default-restored) configs record which generation
 * of defaults they materialized. The pinned-hash test fails the build whenever the defaults
 * change without it moving. (The reverse — moving it with no default change — is inert rather
 * than an error: nothing is keyed by version, so there is no table to fall out of sync with.)
 */
export const KERNEL_VERSION = "2026-08-21";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The value a config carries at a dotted path, or `undefined` when any segment is missing or
 * is not a plain object (a hand-edited `tools:` with no value parses as null and reads as
 * missing here, exactly as it does on the write side).
 */
export function valueAtPath(root: unknown, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (!isPlainObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

/**
 * The unit of kernel management: one **settings tab** of the Web App's Agent settings page
 * (`web/src/features/agents/agent-settings-page.tsx`), and the config paths it owns. A tab is
 * matched, advanced and kept **whole** — the granularity is deliberately coarse, so a user who
 * edits one field of a tab keeps that entire tab until they restore defaults.
 *
 * Two things the page shows are absent on purpose:
 *
 * - `overview` holds name / description / the Agent State version — identity and user data the
 *   kernel never writes, alongside the Kernel section itself.
 * - the tools tab also hosts `tools.mcpServers`, which is user data; only `tools.builtin` is
 *   kernel-managed, so an MCP Server the user configured survives even a wholesale advance.
 *
 * The order is the page's own tab order, so a reported `advanced` / `kept` list reads in the
 * order the tabs appear.
 */
export const KERNEL_TABS = {
  prompt: ["system_prompt"],
  runtime: ["max_turns", "model", "compaction"],
  tools: ["tools.builtin"],
  skills: ["skills"],
  memory: ["memory"],
  vault: ["vault"],
  schedules: ["schedules"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

/** A kernel-managed settings tab. */
export type KernelTab = keyof typeof KERNEL_TABS;

/** Every kernel-managed tab, in the settings page's tab order. */
export const KERNEL_TAB_KEYS = Object.keys(KERNEL_TABS) as readonly KernelTab[];

/**
 * Canonical JSON: object keys sorted recursively (arrays keep order, `undefined` properties
 * dropped), so the hash is insensitive to key order — a YAML round-trip or a hand edit that
 * only reorders keys still counts as the same value.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  if (isPlainObject(value)) {
    const parts = Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** sha256 hex of a value's canonical JSON — the unit of comparison for kernel matching. */
export function hashKernelValue(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/**
 * A tab's hash over a config: sha256 of `{ ownedPath: value }` across the paths the tab owns
 * that the config actually carries — so an extra key the user added anywhere inside the tab
 * changes it, and the tab is then kept rather than overwritten.
 *
 * `null` when the config carries none of them: the tab is **absent** (a config predating the
 * section, or one that never had it), and a kernel update materializes it from the defaults.
 */
export function kernelTabHash(config: unknown, tab: KernelTab): string | null {
  const owned: Record<string, unknown> = {};
  let present = false;
  for (const path of KERNEL_TABS[tab]) {
    const value = valueAtPath(config, path.split("."));
    if (value === undefined) continue;
    owned[path] = value;
    present = true;
  }
  return present ? hashKernelValue(owned) : null;
}

/** `{ tab: sha256 }` over a config's kernel-managed tabs; a tab the config lacks is omitted. */
export function computeKernelTabHashes(config: unknown): Partial<Record<KernelTab, string>> {
  const hashes: Partial<Record<KernelTab, string>> = {};
  for (const tab of KERNEL_TAB_KEYS) {
    const hash = kernelTabHash(config, tab);
    if (hash !== null) hashes[tab] = hash;
  }
  return hashes;
}

/**
 * Whether a stored kernel stamp is behind the current one: a missing stamp (every config
 * from before the mechanism) always counts as outdated; date strings compare
 * lexicographically, so a stamp from a *newer* build (e.g. after a downgrade) does not.
 */
export function isKernelOutdated(kernelVersion: string | null | undefined): boolean {
  return typeof kernelVersion !== "string" || kernelVersion < KERNEL_VERSION;
}

/**
 * Each tab's hash under today's built-in defaults — the **drift anchor**. The pinned-hash
 * test compares this against `computeKernelTabHashes(defaultSystemConfig())` and fails the
 * build on any difference, which is the mechanical definition of "the defaults changed
 * substantively, bump the kernel". A kernel update never consults it as history: a stored tab
 * equal to the current default short-circuits before any lookup.
 *
 * **Advancing the kernel** — what the pinned-hash test asks for when a default changes, and
 * the whole of the appending workflow. Set `KERNEL_VERSION` to today's date (a second change
 * the same day reuses it), then, per tab the test names, with the hashes from
 * `computeKernelTabHashes(defaultSystemConfig())`: append the tab's **old** hash here to the
 * end of its `KERNEL_SUPERSEDED_TAB_HASHES` entry (creating the entry if this is its first
 * change), then write the new hash in. Then add a line to the generation list below saying
 * what moved. Never edit a hash already superseded: it is a frozen record of what shipped.
 *
 * The generations behind the record, oldest first (the dates are kernel versions; matching is
 * purely by hash, so a stored date never has to line up with anything):
 *
 * - `2026-08-10` — the generation *before* the prompt-injection toggles (PR #257): no `vault`
 *   / `skills` / `schedules` sections, and the default template carried the hardcoded legacy
 *   # Vault / # Skills sections instead of the `{{VAULT}}` / `{{SKILLS}}` / `{{SCHEDULES}}`
 *   placeholders. The date is a retroactive label (configs of that era carry no stamp). This
 *   is where the record starts; anything older cannot be reconstructed at all — those tabs
 *   match no recorded hash and are conservatively kept, with restore-default-config as the
 *   recourse. Only the prompt tab has a hash here: the three missing sections are absent
 *   rather than superseded, and the runtime / tools / memory tabs still shipped what the
 *   toggles generation shipped.
 * - `2026-08-11` — the toggles generation: the `vault` / `skills` / `schedules` sections
 *   appeared and `system_prompt` took the placeholder template (prompt tab).
 * - `2026-08-18` — `run_subagent` gained the optional `thinking_level` argument (issue #306):
 *   the tools tab moved.
 * - `2026-08-19` — the `max` thinking level joined the ladder, widening `run_subagent`'s
 *   `thinking_level` enum: the tools tab moved again.
 * - `2026-08-20` — the seeded `compaction.max_context_length` rose to 256000, with the
 *   per-model `context_window` cap as its backstop: the runtime tab moved.
 * - `2026-08-21` (current) — background execution: `exec_command` / `run_subagent` gained
 *   `run_in_background`, `input_command`'s empty-poll default became 120000ms, and the
 *   `kill_command` / `kill_subagent` tools joined the set, moving the tools tab; alongside
 *   them the memory prompt was reworded to name when a fact is worth saving (PR #397), moving
 *   the memory tab.
 */
export const KERNEL_DEFAULT_TAB_HASHES: Readonly<Record<KernelTab, string>> = {
  prompt: "048198c37b8d7840352c225fdfcb15baf2679973c6eab4bf400d492daf6ce254",
  runtime: "c952d44ecdd6790e17f02bc1b5056118b56ec7f0987dc2cbe950f6051fddbd20",
  tools: "8bbd336ff1f3fc283c4e11e54d43dd2bfe4ba2458577bf9eb3b6e3d7be4f3cde",
  skills: "7e343aa692e5eaeadfc8add6bb375fb50ac33ef81ebe460490fc219b0f3d707f",
  memory: "53d190390829cc0132bb12e468a6891f2e0576ec0c4022a9b4a5d9233666900d",
  vault: "19bd36a6d4ab442b66583c423450602b817990a9a79bafa21c9b6137fb6b47d8",
  schedules: "79123643abd445c8540696c3e4395d9582cfa662bed2e5f879dd859fa09715f2",
};

/**
 * Per tab, the hashes *earlier* kernels shipped, oldest first, the current default excluded.
 * **The only hashes that can decide anything**: a stored tab hitting one is an old default the
 * user never edited, so the whole tab advances instead of being kept.
 *
 * These are literals, **frozen once written** — they must keep matching what old
 * `system_config.yaml` files actually contain even as the defaults evolve, exactly like the
 * LEGACY_* template constants in default-config.ts. A tab whose defaults never changed does
 * not appear here; nor does one that simply did not exist yet, since a config predating a
 * section carries no such tab at all and is materialized on absence rather than matched.
 */
export type KernelSupersededTabHashes = Readonly<Partial<Record<KernelTab, readonly string[]>>>;

export const KERNEL_SUPERSEDED_TAB_HASHES: KernelSupersededTabHashes = {
  // The pre-toggles template, with the hardcoded # Vault / # Skills sections (before #257).
  prompt: ["99b8babb72d95c636a2c2893b657ac9c92d60c270a2e04e346b35b1fb720c932"],
  // compaction.max_context_length was 128000, before the rise to 256000 in 2026-08-20.
  runtime: ["808ae1d1b544f46daff4f59f1e62357b89a61f60803061e86b10635616e0102c"],
  tools: [
    "238440586ad2e075bde04948cf8dc9876301da538aafeb8926cd9c6a5738081b", // before run_subagent's `thinking_level` (#306)
    "c719f2fe8a25bc5c644a4e1a78d26cf960dd0561efc453614af2e395000ed4de", // before `max` joined the ladder
    "074248073c5fe89537ff257cc5d5662159288fc79ede7703eded6b440b4e38e9", // before background execution and the kill tools
  ],
  // The memory prompt's wording before #397 named when a fact is worth saving.
  memory: ["c28acdda755552967cd0c99ba4ced407eddfa843b3dce228a965da4674676dc7"],
};

/**
 * Whether a stored tab hash is a *superseded* default — an old built-in tab the user never
 * edited, which a kernel update rewrites from the current defaults. The current default is
 * deliberately not a match: the update has already short-circuited on it by the time it asks.
 */
export function isSupersededTab(
  tab: KernelTab,
  hash: string,
  superseded: KernelSupersededTabHashes = KERNEL_SUPERSEDED_TAB_HASHES,
): boolean {
  return superseded[tab]?.includes(hash) ?? false;
}

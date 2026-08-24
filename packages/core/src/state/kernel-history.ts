/**
 * Agent config kernel versions: which generation of the built-in defaults a stored
 * `system_config.yaml` is based on, and the per-leaf hash history that lets the kernel
 * update (see kernel-update.ts) tell "still the old default" apart from "customized by
 * the user".
 *
 * A kernel version is a date string (`YYYY-MM-DD`). It advances **manually** and only when
 * the built-in defaults change substantively: the pinned-hash test in
 * `core/test/kernel-version.test.ts` recomputes every default leaf hash and fails the build
 * whenever `defaultSystemConfig()` drifts from `KERNEL_HISTORY.current` — the failure message
 * names the leaves that moved and spells out the edit each one needs below. Several changes
 * on the same day may reuse that day's version rather than taking a new one.
 *
 * The user's own edits never move a config between generations: matching is purely by value
 * hash, and a value that matches no recorded default is conservatively treated as a user
 * customization (see kernel-update.ts).
 */
import { createHash } from "node:crypto";
import type { SystemConfig } from "./default-config.js";

/**
 * The current kernel version — the generation stamp `defaultSystemConfig()` carries in
 * `kernel_version`, so newly created (and default-restored) configs record which generation
 * of defaults they materialized. It is the date `KERNEL_HISTORY.addedIn` calls a leaf "new"
 * by, and the pinned-hash test fails the build whenever the defaults change without it moving.
 * (The reverse — moving it with no default change — is inert rather than an error: nothing is
 * keyed by version any more, so there is no per-generation table left to fall out of sync.)
 */
export const KERNEL_VERSION = "2026-08-21";

/**
 * Identity / user-data fields excluded from kernel management: never hashed, never written
 * by a kernel update. `version` is the Agent State optimization counter (unrelated to the
 * kernel version); `kernel_version` is the stamp itself.
 */
const EXCLUDED_TOP_LEVEL_KEYS = new Set(["name", "description", "version", "kernel_version"]);

/** One kernel-managed leaf of the default config: a dotted path and the value at it. */
export interface KernelLeaf {
  path: string;
  value: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The kernel-managed leaves of a config, in stable traversal order: scalars and arrays are
 * atomic leaves; plain objects recurse. Two special cases:
 *
 * - `tools.builtin` is broken up **per tool name** (`tools.builtin.<name>`, each entry an
 *   atomic leaf), so a user who customized one tool keeps only that one while the rest
 *   follow a kernel update. Tool names allow no `.` (see assertValidId's character set), so
 *   the dotted path stays unambiguous.
 * - `tools.mcpServers` is user data (like name/description/version) and is skipped entirely.
 */
export function kernelLeafEntries(config: SystemConfig): KernelLeaf[] {
  const leaves: KernelLeaf[] = [];
  const visit = (value: unknown, path: string[]): void => {
    if (value === undefined) return;
    if (path.length === 1 && EXCLUDED_TOP_LEVEL_KEYS.has(path[0]!)) return;
    if (path.length === 2 && path[0] === "tools") {
      if (path[1] === "mcpServers") return;
      if (path[1] === "builtin" && Array.isArray(value)) {
        for (const entry of value) {
          if (isPlainObject(entry) && typeof entry["name"] === "string") {
            leaves.push({ path: `tools.builtin.${entry["name"]}`, value: entry });
          }
        }
        return;
      }
    }
    if (isPlainObject(value)) {
      for (const key of Object.keys(value)) visit(value[key], [...path, key]);
      return;
    }
    leaves.push({ path: path.join("."), value });
  };
  for (const key of Object.keys(config)) {
    visit((config as unknown as Record<string, unknown>)[key], [key]);
  }
  return leaves;
}

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

/** `{ leafPath: sha256 }` over a config's kernel-managed leaves (see kernelLeafEntries). */
export function computeKernelHashes(config: SystemConfig): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const { path, value } of kernelLeafEntries(config)) {
    hashes[path] = hashKernelValue(value);
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
 * The kernel's pinned hash record, and the whole of what a kernel update reads.
 *
 * It used to be a full snapshot of every leaf hash per generation (`{ version: { leafPath:
 * sha256 } }`). All but a handful of those entries repeated a value nothing could ever
 * consult: kernel-update.ts short-circuits on `storedHash === defaultHash` **before** it looks
 * up any history, so a leaf's own current hash — and every repeat of an unchanged leaf across
 * generations — decided nothing. What remains is the three things that do decide something:
 *
 * - `current` — the hash of every leaf of today's defaults. The **drift anchor**: the
 *   pinned-hash test in `core/test/kernel-version.test.ts` compares it against
 *   `computeKernelHashes(defaultSystemConfig())` and fails the build on any difference, which
 *   is the mechanical definition of "the defaults changed substantively, bump the kernel".
 *   It is never consulted as history — a stored value equal to it is already current.
 * - `superseded` — per leaf, the default values *earlier* kernels shipped, oldest first, the
 *   current one excluded. **The only hashes that can decide anything**: a stored value hitting
 *   one is an old default the user never edited, so it advances instead of being kept. These
 *   are literals, **frozen once written** — they must keep matching what old
 *   `system_config.yaml` files actually contain even as the defaults evolve, exactly like the
 *   LEGACY_* template constants in default-config.ts. A leaf whose default never changed does
 *   not appear here at all.
 * - `addedIn` — for leaves the record did not start out with, the kernel version that first
 *   shipped them. One decision reads it: a default tool missing from a stored `tools.builtin`
 *   array is a deliberate removal and stays removed, *unless* it was added in the current
 *   kernel — then the config simply predates the tool and it is appended. Comparing against
 *   `version` makes that self-clearing: an entry ages out of "new" at the next bump, no edit.
 *
 * **Advancing the kernel** — what the pinned-hash test asks for when a default changes, and
 * the whole of the appending workflow. Set `KERNEL_VERSION` to today's date (a second change
 * the same day reuses it), then, per leaf the test names, with the hashes from
 * `computeKernelHashes(defaultSystemConfig())`:
 *
 * - *changed* — append the leaf's **old** `current` hash to the end of `superseded[path]`
 *   (creating the entry if this is its first change) and write the new hash into `current`;
 * - *added* — put its hash in `current` and record `addedIn[path]: KERNEL_VERSION`, which is
 *   what makes an existing config receive a brand-new default tool;
 * - *removed* — delete it from `current`, `superseded` and `addedIn`.
 *
 * Finally add a line to the list below saying what moved. Never edit a hash already in
 * `superseded`, and never edit `addedIn` dates in the past: both are frozen records of what
 * shipped.
 *
 * The generations behind the record, oldest first (the dates are kernel versions; matching is
 * purely by hash, so a stored date never has to line up with anything):
 *
 * - `2026-08-10` — the generation *before* the prompt-injection toggles (PR #257): no `vault`
 *   / `skills` / `schedules` sections, and the default template carried the hardcoded legacy
 *   # Vault / # Skills sections instead of the `{{VAULT}}` / `{{SKILLS}}` / `{{SCHEDULES}}`
 *   placeholders. The date is a retroactive label (configs of that era carry no stamp). This
 *   is where the record starts: a leaf absent from `addedIn` was already there, and anything
 *   older than this generation cannot be reconstructed at all — those values match no
 *   recorded hash and are conservatively kept, with restore-default-config as the recourse.
 *   While the toggles generation was current, the test suite proved this generation's hashes
 *   equal a byte-exact reconstruction of that era's defaults from the frozen LEGACY_*
 *   constants; that proof self-retired once the defaults evolved past the toggles generation,
 *   and `system_prompt`'s superseded hash below is what is left of it.
 * - `2026-08-11` — the toggles generation: the `vault` / `skills` / `schedules` sections
 *   appeared and `system_prompt` took the placeholder template.
 * - `2026-08-18` — `run_subagent` gained the optional `thinking_level` argument (issue #306):
 *   only the `tools.builtin.run_subagent` leaf changed.
 * - `2026-08-19` — the `max` thinking level joined the ladder, widening `run_subagent`'s
 *   `thinking_level` enum: again only the `tools.builtin.run_subagent` leaf changed.
 * - `2026-08-20` — the seeded `compaction.max_context_length` rose to 256000, with the
 *   per-model `context_window` cap as its backstop: only the `compaction.max_context_length`
 *   leaf changed.
 * - `2026-08-21` (current) — background execution: `exec_command` / `run_subagent` gained
 *   `run_in_background`, `input_command`'s empty-poll default became 120000ms, and the
 *   `kill_command` / `kill_subagent` tools joined the set; alongside them the memory prompt
 *   was reworded to name when a fact is worth saving (PR #397), changing `memory.prompt`.
 */
export interface KernelHistory {
  /** The kernel version this record describes — `KERNEL_VERSION` for the built-in one. */
  readonly version: string;
  /** `{ leafPath: sha256 }` of the current built-in defaults: the drift anchor, never history. */
  readonly current: Readonly<Record<string, string>>;
  /** `{ leafPath: [sha256, …] }`, oldest first, current default excluded — the hashes that advance a config. */
  readonly superseded: Readonly<Record<string, readonly string[]>>;
  /** `{ leafPath: kernelVersion }` for leaves the record did not start with — their first kernel. */
  readonly addedIn: Readonly<Record<string, string>>;
}

export const KERNEL_HISTORY: KernelHistory = {
  version: KERNEL_VERSION,
  current: {
    system_prompt: "de8952daede04db17400c5cd59b279eccf523cf2d8a0ecedfa37a96de7925b44",
    max_turns: "1bad6b8cf97131fceab8543e81f7757195fbb1d36b376ee994ad1cf17699c464",
    "model.max_tokens": "492f431bae35265f2e5f4ed49bd8c58dda912431be561504846988d00d05d117",
    "model.thinking_level": "60d4c90eee5e731df8d3ef2891de541d2e755ff8ee9db358e26bdec49f6e0db9",
    "model.timeoutMs": "4f9f73b34c5b89879aad65a48025f3187dd9ce6dc3d4e88eecb2fc79227350f1",
    "compaction.max_context_length":
      "b412afcc00967650c9e51efd8cdc35ae59d3d6c30234331b7bf75b382d982ee9",
    "compaction.max_session_turns":
      "1bad6b8cf97131fceab8543e81f7757195fbb1d36b376ee994ad1cf17699c464",
    "compaction.mode": "e58fac0b4b9c0f29b3d224da119dff5f6517a40d139faf92e309705b98bd410a",
    "compaction.prompt": "8ed55781e8071083f8246ed70d9e063ee729d3872d5bc6a2bedfa9c99aed6ae5",
    "memory.enabled": "b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b",
    "memory.prompt": "be1a8733b5d23afb11af3086b369105d42b7209edce6749eed31c4dbede9beff",
    "memory.workspace_prompt": "76c5a8e18a568f471593ef1da6d75d2596f27619cb877703b2dd28bb0554e0d5",
    "vault.enabled": "b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b",
    "vault.prompt": "66e607aa4e205413f1816a677bed31af2d8c24218e71b55adba54aff5aa094ce",
    "skills.enabled": "b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b",
    "skills.prompt": "42934d17f5dd9c02dfa7c1d37f255dea92bd36905c96a54775c65ef7db713bd9",
    "schedules.enabled": "b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b",
    "schedules.prompt": "3c690ff9bb3e4d423b2d5dfce74f5890d52bf8ae159cfe135a671ac3d46da75a",
    "tools.builtin.read_file": "858f128945421043f5f373c908a0ee081e93e9413debaa49c8c7af1c1c76db3c",
    "tools.builtin.edit_file": "165a3e2dabe3d13200a1670f3c23ed2d6561c508439db1972db066719f3549ef",
    "tools.builtin.write_file": "c98253bd5a3b6ff021accda91af016a809a9b50ce56f38a3ed60eeb673c0b130",
    "tools.builtin.exec_command":
      "c7cf0639eb9434b2eecdd064aabeead52e22c966ddce348f987c744e93f9686f",
    "tools.builtin.input_command":
      "071daddb34cba05556cda2b6a87d18d5bd73fb863e6e3bd62f033626fbabf017",
    "tools.builtin.kill_command":
      "1d35d3be0408349c0bb099c442abfde3975c720e2c85cda3c2b749b359bef891",
    "tools.builtin.run_subagent":
      "6d890081b3dcd0405bab35590ee5d85c1ffa4815faf3b1b4de62b2617da77ec6",
    "tools.builtin.input_subagent":
      "22cc4648d773e8422e80a12a7a095b00b7f7eb01ab5a9ea080858dcd7517b4e3",
    "tools.builtin.kill_subagent":
      "8d8c11a1ae565b9b8334a498c5fc5b8903a2f657ac4e46d1c3dc9b7288e12ce4",
    "tools.builtin.read_image": "05b797a88df1e6a90fb3da67ec654b206f8d81291f89d160a505620afcea38bb",
    "tools.builtin.describe_image":
      "fad6d0cdd483eb53b5d243c0508024ab3b708ce6d3c81933acd291f05d4a265f",
  },
  superseded: {
    // The pre-toggles template, with the hardcoded # Vault / # Skills sections (before #257).
    system_prompt: ["7c0dce1e6b4a7b94aaec5f09d4c7bc9bf104c46c9167fdca9543306b9e1ba595"],
    // 128000, before the rise to 256000 in 2026-08-20.
    "compaction.max_context_length": [
      "8eda794b86cb709202a0023fd5273e3de6d24117b7e36b9bdb53c0238dac4785",
    ],
    // The wording before #397 named when a fact is worth saving.
    "memory.prompt": ["9380e2382e5dd3d37a6470b0bc0d27c9ed113fa9a54ff78122784c57a16b992c"],
    // Before `run_in_background` (2026-08-21).
    "tools.builtin.exec_command": [
      "16b327e5c3617b7c4d21505c9d1a72dd33a74de97cd5c60d6c4538b8ec408421",
    ],
    // Before the 120000ms empty-poll default (2026-08-21).
    "tools.builtin.input_command": [
      "4c907500cda145161a9481803cfb57ed814b6793e762fd6284510187e9d781c8",
    ],
    "tools.builtin.run_subagent": [
      "c3f93add8da3032850fb2e1f484e2d6ddf97e57d73639d887549494ce9f15fb2", // before `thinking_level` (#306)
      "be00af47c7098cde840a662c99f9f6d0cdf8358883e09974ce840b0c4683a9af", // before `max` joined the ladder
      "f43ac4f9621032d554275be1d416f994f0d3cc0918537de99c974e436eb69316", // before `run_in_background`
    ],
  },
  addedIn: {
    // The prompt-injection toggles (#257).
    "vault.enabled": "2026-08-11",
    "vault.prompt": "2026-08-11",
    "skills.enabled": "2026-08-11",
    "skills.prompt": "2026-08-11",
    "schedules.enabled": "2026-08-11",
    "schedules.prompt": "2026-08-11",
    // Background execution: new tools, so a config that predates them gets them appended.
    "tools.builtin.kill_command": "2026-08-21",
    "tools.builtin.kill_subagent": "2026-08-21",
  },
};

/**
 * Whether a stored hash is a *superseded* default of this leaf — an old built-in value the
 * user never edited, which a kernel update replaces. The current default is deliberately not
 * a match: kernel-update.ts has already short-circuited on it by the time it asks.
 */
export function isSupersededDefault(
  path: string,
  hash: string,
  history: KernelHistory = KERNEL_HISTORY,
): boolean {
  return history.superseded[path]?.includes(hash) ?? false;
}

/**
 * Whether a leaf is new in the current kernel — no earlier kernel shipped it, so a config
 * that lacks it predates it rather than having dropped it.
 */
export function isNewInCurrentKernel(
  path: string,
  history: KernelHistory = KERNEL_HISTORY,
): boolean {
  return history.addedIn[path] === history.version;
}

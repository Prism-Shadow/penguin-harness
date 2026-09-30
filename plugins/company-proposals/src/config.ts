/**
 * The plugin's configuration: one settings group (a `PluginConfigProvider.groups`
 * contribution, so it is in the generated ifaces.json) an admin edits on the Settings
 * dialog's Plugins page. The harness stores the values server-wide; the plugin reads them
 * back itself through `PluginConfig.get`, merged onto the declared defaults, on every use —
 * so a save applies to the next publish and the next page read without a restart.
 *
 *   testGroups    the test groups a proposal may use, one line `id: description` each; the
 *                 order of the lines is the order the page shows the groups in
 *   deliveryRepo  `owner/repo` the impl PRs are opened on — the PR graph's repository; while
 *                 it is empty, the shared workspace's GitHub remote holding the most impl PRs
 *                 (`origin` when none does, else the first)
 *   deliveryBase  the branch the bottom of the PR stack is based on (`dev`); when empty, the
 *                 delivery repository's default branch
 *   origins       other repositories to annotate the graph with, one line `name=owner/repo`
 *                 each (`origin=Prism-Shadow/penguin-harness`): their PR on a node's branch;
 *                 while it is empty, the workspace's other GitHub remotes by their names
 */
import type { ProposalTestGroup } from "@prismshadow/penguin-server/api";

/** The settings group the module declares — its contribution id, which the values are stored under. */
export const CONFIG_GROUP = "company-proposals";

/** One declared line: a short lower-case id (the same rule a proposal's `group:` follows), `: `, what the group covers. */
export const TEST_GROUP_LINE = "^[a-z0-9_-]{1,32}: \\S.*$";

/** What a fresh installation declares. */
export const DEFAULT_TEST_GROUPS: readonly string[] = [
  "unit: one module in isolation, no I/O",
  "integration: several modules together, real storage or network",
  "e2e: the product end to end, through its UI or CLI",
  "bench: performance measurements",
];

/** The declared groups out of the stored values, in order; a line that does not parse (or repeats an id) is skipped and reported. */
export function testGroupsOf(values: Record<string, unknown>): {
  groups: ProposalTestGroup[];
  skipped: string[];
} {
  const raw = Array.isArray(values.testGroups) ? values.testGroups : DEFAULT_TEST_GROUPS;
  const line = new RegExp(TEST_GROUP_LINE, "u");
  const groups: ProposalTestGroup[] = [];
  const skipped: string[] = [];
  for (const entry of raw) {
    const text = typeof entry === "string" ? entry.trim() : "";
    if (!line.test(text)) {
      skipped.push(String(entry));
      continue;
    }
    const colon = text.indexOf(":");
    const id = text.slice(0, colon);
    if (groups.some((g) => g.id === id)) {
      skipped.push(text);
      continue;
    }
    groups.push({ id, description: text.slice(colon + 1).trim() });
  }
  return { groups, skipped };
}

/** One origin line: a short lower-case name, `=`, `owner/repo`. */
export const ORIGIN_LINE = "^[a-z0-9_-]{1,32}=[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$";

/** The branch a fresh installation stacks on. */
export const DEFAULT_DELIVERY_BASE = "dev";

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH = /^[A-Za-z0-9._/-]{1,200}$/;

/** Where the PR graph reads from; `repo` null = not configured. Unusable values are reported in `skipped`. */
export interface GraphConfig {
  repo: string | null;
  base: string;
  /** Whether `base` was set rather than defaulted. */
  baseDeclared: boolean;
  origins: Array<{ name: string; repo: string }>;
  skipped: string[];
}

export function graphConfigOf(values: Record<string, unknown>): GraphConfig {
  const skipped: string[] = [];
  const rawRepo = typeof values.deliveryRepo === "string" ? values.deliveryRepo.trim() : "";
  let repo: string | null = null;
  if (rawRepo !== "") {
    if (REPO.test(rawRepo)) repo = rawRepo;
    else skipped.push(`deliveryRepo ${rawRepo}`);
  }
  const rawBase = typeof values.deliveryBase === "string" ? values.deliveryBase.trim() : "";
  let base = DEFAULT_DELIVERY_BASE;
  let baseDeclared = false;
  if (rawBase !== "") {
    if (BRANCH.test(rawBase) && !rawBase.includes("..")) {
      base = rawBase;
      baseDeclared = true;
    } else skipped.push(`deliveryBase ${rawBase}`);
  }
  const line = new RegExp(ORIGIN_LINE, "u");
  const origins: GraphConfig["origins"] = [];
  for (const entry of Array.isArray(values.origins) ? values.origins : []) {
    const text = typeof entry === "string" ? entry.trim() : "";
    const at = text.indexOf("=");
    const name = text.slice(0, at);
    if (!line.test(text) || origins.some((o) => o.name === name)) {
      skipped.push(String(entry));
      continue;
    }
    origins.push({ name, repo: text.slice(at + 1) });
  }
  return { repo, base, baseDeclared, origins, skipped };
}

/** A remote name an origin line accepts. */
const ORIGIN_NAME = /^[a-z0-9_-]{1,32}$/;

const GITHUB_REMOTE =
  /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;

/**
 * The GitHub remotes in `git remote -v` output, as origins: each fetch URL on github.com, by
 * the remote's name, in the order git lists them. A name an origin line would not accept, or a
 * remote on another host, is left out.
 */
export function remotesOf(output: string): Array<{ name: string; repo: string }> {
  const out: Array<{ name: string; repo: string }> = [];
  for (const line of output.split("\n")) {
    const [remote, url, kind] = line.trim().split(/\s+/);
    if (kind !== "(fetch)" || remote === undefined || url === undefined) continue;
    const m = GITHUB_REMOTE.exec(url);
    if (m === null || !ORIGIN_NAME.test(remote) || out.some((o) => o.name === remote)) continue;
    out.push({ name: remote, repo: `${m[1]}/${m[2]}` });
  }
  return out;
}

/** The refusal's text: the groups the document used that are not declared, and the ones that are. */
export function undeclaredGroupsMessage(
  undeclared: readonly string[],
  groups: readonly ProposalTestGroup[],
): string {
  const declared =
    groups.length === 0
      ? "none — an admin declares them under Settings → Plugins → Company proposals"
      : groups.map((g) => `\n  - ${g.id}: ${g.description}`).join("");
  return `Test group${undeclared.length === 1 ? "" : "s"} not declared: ${undeclared.join(", ")}. The declared groups are: ${declared}`;
}

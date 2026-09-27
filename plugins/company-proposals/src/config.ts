/**
 * The plugin's configuration: one settings group (a `PluginConfigProvider.groups`
 * contribution, so it is in the generated ifaces.json) an admin edits on the Settings
 * dialog's Plugins page. The harness stores the values server-wide; the plugin reads them
 * back itself through `PluginConfig.get`, merged onto the declared defaults, on every use —
 * so a save applies to the next publish and the next page read without a restart.
 *
 *   testGroups  the test groups a proposal may use, one line `id: description` each; the
 *               order of the lines is the order the page shows the groups in
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

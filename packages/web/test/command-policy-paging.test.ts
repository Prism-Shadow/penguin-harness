// @vitest-environment jsdom
/**
 * The security page's rule table, ten rules to a page
 * (features/projects/project-dialogs/security-policy-section.tsx, command-policy-table.tsx).
 *
 * - Turning the page keeps every unsaved edit: Save sends the whole list, with the edits made
 *   on each page.
 * - A rule added while a later page shows goes to the head of the list, and the table turns to
 *   the first page, where it now is.
 * - When the server refuses a Save over a pattern it cannot compile, the table turns to the
 *   page that rule is on and marks its row with the engine's reason; the draft stays as it was,
 *   still waiting for Save.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import type { CommandPolicyRuleDto } from "@prismshadow/penguin-server/api";
import { ProjectSettingsDialog } from "../src/features/projects/project-dialogs/project-settings-dialog";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { UnsavedPrompt } from "../src/lib/unsaved/unsaved-prompt";
import { AuthProvider } from "../src/state/auth";
import { ProjectProvider } from "../src/state/project";
import { json } from "./helpers/fetch";
import { projectSettingsServer } from "./helpers/project-settings";
import {
  button,
  click,
  field,
  hasButton,
  mount,
  switchNamed,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

/** Fourteen rules, zero-padded so no name is part of another: two pages. */
const RULES: CommandPolicyRuleDto[] = Array.from({ length: 14 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return { name: `rule-${n}`, pattern: `pattern-${n}`, enabled: true };
});

async function openSecurityPage() {
  const server = projectSettingsServer(RULES.map((r) => ({ ...r })));
  await mount(
    h(
      AuthProvider,
      null,
      h(
        ProjectProvider,
        null,
        h(ProjectSettingsDialog, { open: true, onClose: vi.fn() }),
        h(UnsavedPrompt),
      ),
    ),
  );
  await waitFor(() => hasButton(en.project.settingsTabSecurity));
  await click(button(en.project.settingsTabSecurity));
  await waitFor(() => hasButton(en.project.commandPolicyAddRule));
  return server;
}

const shows = (text: string) =>
  document.querySelector('[role="dialog"]')!.textContent!.includes(text);
const ruleSwitch = (name: string) => switchNamed(en.project.commandPolicyRuleSwitch(name));
const isOn = (name: string) => ruleSwitch(name).getAttribute("aria-checked") === "true";

describe("the command policy's paged rule table", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("keeps the edits made on every page, and saves them all together", async () => {
    const server = await openSecurityPage();
    expect(shows("rule-10")).toBe(true);
    expect(shows("rule-11")).toBe(false);

    await click(ruleSwitch("rule-02"));
    await click(button(en.common.nextPage));
    expect(shows("rule-11")).toBe(true);
    expect(shows("rule-01")).toBe(false);
    await click(ruleSwitch("rule-12"));
    await click(button(en.common.previousPage));
    expect(isOn("rule-02")).toBe(false);

    await click(button(en.common.save));
    await waitFor(() => server.policyPuts().length === 1);
    const sent = (server.policyPuts()[0] as { rules: CommandPolicyRuleDto[] }).rules;
    expect(sent.map((r) => r.name)).toEqual(RULES.map((r) => r.name));
    expect(sent.filter((r) => !r.enabled).map((r) => r.name)).toEqual(["rule-02", "rule-12"]);
  });

  it("puts a rule added from a later page at the head of the first", async () => {
    await openSecurityPage();
    await click(button(en.common.nextPage));
    await click(button(en.project.commandPolicyAddRule));
    await type(field(en.project.commandPolicyRuleName), "no-curl");
    await type(field(en.project.commandPolicyRulePattern), "curl ");
    await click(button(en.project.commandPolicyApplyRule));

    expect(shows("no-curl")).toBe(true);
    expect(shows("rule-01")).toBe(true);
    // The first page now ends one rule earlier.
    expect(shows("rule-10")).toBe(false);
  });

  it("turns to the page of a pattern the server refuses, marks its row, and keeps the draft", async () => {
    const server = await openSecurityPage();
    server.refuseNextPolicy(() =>
      json(
        {
          error: {
            code: "invalid_rule_pattern",
            message: 'Rule "rule-12" has an invalid regular expression: Invalid group.',
            details: { rule: "rule-12", index: "11", reason: "Invalid group" },
          },
        },
        400,
      ),
    );
    await click(ruleSwitch("rule-01"));
    await click(button(en.common.save));
    await waitFor(() => server.policyPuts().length === 1 && shows("rule-12"));

    expect(shows("rule-01")).toBe(false);
    const mark = document.querySelector(
      `[role="img"][aria-label="${en.project.commandPolicyPatternRejectedHint("Invalid group")}"]`,
    );
    expect(mark).not.toBeNull();
    expect(mark!.parentElement!.textContent).toContain("rule-12");
    // Nothing was stored, so the edit is still waiting for Save.
    expect(button(en.common.save).disabled).toBe(false);
    await click(button(en.common.previousPage));
    expect(isOn("rule-01")).toBe(false);
  });
});

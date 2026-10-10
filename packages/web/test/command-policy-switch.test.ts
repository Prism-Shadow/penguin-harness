// @vitest-environment jsdom
/**
 * The command policy's master switch on the Project settings' security page
 * (components/layout/project-dialogs.tsx): an instant control beside the rule list's draft.
 *
 * - Flipping it writes at once, alone: the PUT carries the rules as stored with the flag
 *   flipped, never the rule list being edited — an applied but unsaved rule stays in the list,
 *   still waiting for Save.
 * - A refused write puts the switch back as it was.
 * - The rule list's Save waits until the list differs from what is stored.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { UnsavedPrompt } from "../src/lib/unsaved/unsaved-prompt";
import { ProjectSettingsDialog } from "../src/components/layout/project-dialogs";
import { AuthProvider } from "../src/state/auth";
import { ProjectProvider } from "../src/state/project";
import { FACTORY_RULE, projectSettingsServer } from "./helpers/project-settings";
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

async function openSecurityPage() {
  const server = projectSettingsServer();
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

const masterSwitch = () => switchNamed(en.project.commandPolicyEnable);
const listShows = (text: string) =>
  document.querySelector('[role="dialog"]')!.textContent!.includes(text);

describe("the command policy's master switch", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("writes the stored rules with the flag flipped, and leaves an unsaved rule in the list", async () => {
    const server = await openSecurityPage();
    expect(button(en.common.save).disabled).toBe(true);
    await click(button(en.project.commandPolicyAddRule));
    await type(field(en.project.commandPolicyRuleName), "no-curl");
    await type(field(en.project.commandPolicyRulePattern), "curl ");
    await click(button(en.project.commandPolicyApplyRule));
    expect(button(en.common.save).disabled).toBe(false);

    await click(masterSwitch());
    await waitFor(() => server.policyPuts().length === 1);
    expect(server.policyPuts()[0]).toEqual({ enabled: false, rules: [FACTORY_RULE] });
    expect(masterSwitch().getAttribute("aria-checked")).toBe("false");
    expect(listShows("no-curl")).toBe(true);
    expect(button(en.common.save).disabled).toBe(false);
  });

  it("goes back to the stored state when the write is refused", async () => {
    const server = await openSecurityPage();
    server.refuseNextPolicy();
    await click(masterSwitch());
    await waitFor(() => server.policyPuts().length === 1);
    await waitFor(() => masterSwitch().getAttribute("aria-checked") === "true");
    expect(server.policy().enabled).toBe(true);
  });
});

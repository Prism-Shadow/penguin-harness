// @vitest-environment jsdom
/**
 * Adding a rule on the Project settings security page (features/projects/project-dialogs/security-policy-section.tsx).
 *
 * - The rule editor puts the caret in its first field (the rule's name) and nowhere else, so
 *   opening the form is never silent.
 * - A rule added with "Ask" is saved with `action: "ask"`, and its row then says it asks first.
 * - A rule added as the editor opens (Deny, the default) is saved with no action, as the server
 *   stores it, and its row carries no mark.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectSettingsDialog } from "../src/features/projects/project-dialogs/project-settings-dialog";
import { RuleEditor } from "../src/features/projects/project-dialogs/security-policy-section";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { UnsavedPrompt } from "../src/lib/unsaved/unsaved-prompt";
import { AuthProvider } from "../src/state/auth";
import { ProjectProvider } from "../src/state/project";
import { projectSettingsServer } from "./helpers/project-settings";
import { button, click, field, hasButton, mount, type, unmountAll, waitFor } from "./helpers/dom";

describe("command policy: adding a rule", () => {
  it("puts the caret in the first field, so the form is not silently opened", () => {
    const html = renderToStaticMarkup(
      h(RuleEditor, { initial: null, onApply: () => {}, onCancel: () => {} }),
    );
    // Exactly one field takes focus on mount, and it is the first one — the rule's name.
    expect(html.match(/autofocus/g) ?? []).toHaveLength(1);
    expect(/<input\b[^>]*>/.exec(html)?.[0] ?? "").toContain("autofocus");
  });
});

describe("command policy: what a new rule does on a hit", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

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

  async function addRule(name: string, pattern: string, ask: boolean) {
    await click(button(en.project.commandPolicyAddRule));
    await type(field(en.project.commandPolicyRuleName), name);
    await type(field(en.project.commandPolicyRulePattern), pattern);
    if (ask) await click(button(en.project.commandPolicyActionAsk));
    await click(button(en.project.commandPolicyApplyRule));
  }

  const dialogText = () => document.querySelector('[role="dialog"]')!.textContent!;

  it("a rule added with Ask is saved asking, and its row says it asks first", async () => {
    const server = await openSecurityPage();
    expect(dialogText()).not.toContain(en.project.commandPolicyAskPill);

    await addRule("ask-deploy", "fly deploy", true);
    expect(dialogText()).toContain(en.project.commandPolicyAskPill);
    await click(button(en.common.save));
    await waitFor(() => server.policyPuts().length === 1);

    const body = server.policyPuts()[0] as { rules: unknown[] };
    expect(body.rules[0]).toEqual({
      name: "ask-deploy",
      pattern: "fly deploy",
      enabled: true,
      action: "ask",
    });
  });

  it("a rule added as the editor opens is saved refusing, with no action stored", async () => {
    const server = await openSecurityPage();
    await addRule("no-curl", "curl ", false);
    expect(dialogText()).not.toContain(en.project.commandPolicyAskPill);
    await click(button(en.common.save));
    await waitFor(() => server.policyPuts().length === 1);

    const body = server.policyPuts()[0] as { rules: unknown[] };
    expect(body.rules[0]).toEqual({ name: "no-curl", pattern: "curl", enabled: true });
  });
});

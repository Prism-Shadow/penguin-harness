// @vitest-environment jsdom
/**
 * Leaving the Project dialogs with unsaved edits (components/layout/project-dialogs.tsx).
 *
 * - The settings dialog's tab rail asks before it unmounts a page holding edits: "keep
 *   editing" stays on the page with the text, "discard" switches and the text is gone. That
 *   holds for the display name and for a rule half typed in the security page's rule editor.
 * - Esc asks while a page holds edits; an untouched dialog closes at once.
 * - While a page's Save is in flight (the rule list's), Esc, the × and a press outside do
 *   nothing, and no question is asked; once the save has answered, the dialog closes at once.
 * - While that Save is in flight the tab rail does not switch tabs either, and asks nothing; once
 *   the save has answered, it switches at once.
 * - The display name's Save waits for a name other than the stored one; typing the stored name
 *   back is no change.
 * - The create dialog waits for an id that keeps the rule, says a broken one under the field as
 *   it is typed, and asks before Cancel drops what was typed.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { hasUnsaved } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { UnsavedPrompt } from "../src/lib/unsaved/unsaved-prompt";
import { CreateProjectDialog } from "../src/features/projects/project-dialogs/create-project-dialog";
import { ProjectSettingsDialog } from "../src/features/projects/project-dialogs/project-settings-dialog";
import { AuthProvider } from "../src/state/auth";
import { ProjectProvider } from "../src/state/project";
import { projectSettingsServer } from "./helpers/project-settings";
import {
  button,
  click,
  dialogs,
  field,
  hasButton,
  mount,
  pressEscape,
  pressScrim,
  run,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

async function openSettings() {
  const server = projectSettingsServer();
  const onClose = vi.fn();
  await mount(
    h(
      AuthProvider,
      null,
      h(ProjectProvider, null, h(ProjectSettingsDialog, { open: true, onClose }), h(UnsavedPrompt)),
    ),
  );
  await waitFor(
    () => document.querySelector(`input[aria-label="${en.project.displayName}"]`) !== null,
  );
  return { server, onClose };
}

const promptOpen = () => hasButton(en.common.discard);
/** The id box, by the label that names it (the name box's hint mentions the id too). */
const idField = () => {
  const label = [...document.querySelectorAll("label")].find((l) =>
    l.textContent?.startsWith(en.project.id),
  );
  return document.getElementById(label!.htmlFor) as HTMLInputElement;
};
const heading = () => document.querySelector('[role="dialog"] h3')?.textContent ?? "";
const nameField = () => field(en.project.displayName);

describe("the Project settings dialog", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("asks before the tab rail drops an edited name, and switches only on discard", async () => {
    await openSettings();
    await type(nameField(), "Research lab");
    await click(button(en.project.settingsTabSecurity));
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(heading()).toContain(en.project.settingsTabGeneral);
    expect(nameField().value).toBe("Research lab");

    await click(button(en.project.settingsTabSecurity));
    await click(button(en.common.discard));
    expect(heading()).toContain(en.project.settingsTabSecurity);
    expect(hasUnsaved()).toBe(false);
  });

  it("asks before the tab rail drops a rule half typed in the rule editor", async () => {
    await openSettings();
    await click(button(en.project.settingsTabSecurity));
    await waitFor(() => hasButton(en.project.commandPolicyAddRule));
    await click(button(en.project.commandPolicyAddRule));
    await type(field(en.project.commandPolicyRuleName), "no-curl");
    await click(button(en.project.settingsTabGeneral));
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(field(en.project.commandPolicyRuleName).value).toBe("no-curl");
  });

  it("asks on Esc while a page holds edits, and closes an untouched dialog at once", async () => {
    const { onClose } = await openSettings();
    await type(nameField(), "Research lab");
    await pressEscape();
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(onClose).not.toHaveBeenCalled();

    await type(nameField(), "Research");
    await pressEscape();
    expect(promptOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("holds every close while a page's Save is in flight, and closes once it has answered", async () => {
    const { server, onClose } = await openSettings();
    await click(button(en.project.settingsTabSecurity));
    await waitFor(() => hasButton(en.common.delete));
    await click(button(en.common.delete));
    server.hold();
    await click(button(en.common.save));
    // One close at a time: a prompt opened by one would be answered by a later press on its scrim.
    for (const close of [pressEscape, () => click(button("Close")), pressScrim]) {
      await close();
      expect(promptOpen()).toBe(false);
    }
    expect(onClose).not.toHaveBeenCalled();
    expect(dialogs()).toHaveLength(1);

    await run(server.release);
    await waitFor(() => !hasUnsaved());
    expect(server.policy().rules).toEqual([]);
    await pressEscape();
    expect(promptOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the tab while a page's Save is in flight, and the tab rail switches once it has answered", async () => {
    const { server } = await openSettings();
    await click(button(en.project.settingsTabSecurity));
    await waitFor(() => hasButton(en.common.delete));
    await click(button(en.common.delete));
    server.hold();
    await click(button(en.common.save));
    await click(button(en.project.settingsTabGeneral));
    expect(promptOpen()).toBe(false);
    expect(heading()).toContain(en.project.settingsTabSecurity);

    await run(server.release);
    await waitFor(() => !hasUnsaved());
    await click(button(en.project.settingsTabGeneral));
    expect(promptOpen()).toBe(false);
    expect(heading()).toContain(en.project.settingsTabGeneral);
  });

  it("offers Save for the name only once it differs from the stored one", async () => {
    await openSettings();
    expect(button(en.common.save).disabled).toBe(true);
    await type(nameField(), "Research lab");
    expect(button(en.common.save).disabled).toBe(false);
    await type(nameField(), " Research ");
    expect(button(en.common.save).disabled).toBe(true);
  });
});

describe("the create Project dialog", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("waits for an id that keeps the rule, naming a broken one, and asks before Cancel drops the typing", async () => {
    projectSettingsServer();
    const onClose = vi.fn();
    await mount(
      h(
        AuthProvider,
        null,
        h(
          ProjectProvider,
          null,
          h(CreateProjectDialog, { open: true, onClose, onCreated: () => {} }),
          h(UnsavedPrompt),
        ),
      ),
    );
    await waitFor(() => dialogs().length === 1);
    expect(button(en.common.create).disabled).toBe(true);
    await type(idField(), "Bad Id");
    expect(button(en.common.create).disabled).toBe(true);
    expect(idField().getAttribute("aria-invalid")).toBe("true");
    await type(idField(), "lab_notes");
    expect(button(en.common.create).disabled).toBe(false);

    await click(button(en.common.cancel));
    expect(promptOpen()).toBe(true);
    await click(button(en.common.discard));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

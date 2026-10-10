// @vitest-environment jsdom
/**
 * Four record dialogs under the settings commit model: the ssh host form
 * (features/machines/ssh-host-dialog.tsx), the manual Benchmark form
 * (features/benchmark/create-benchmark-modal.tsx), the chat's shortcut editor
 * (features/chat/shortcuts-folder.tsx) and the built-in browser's homepage
 * (features/builtin-browser/homepage-dialog.tsx).
 *
 * - The verb waits for what it needs: an ssh host's alias and address, a malformed value said
 *   under its field as it is typed; every required field of a Benchmark and of each of its
 *   cases; a homepage entry that opens another page than the saved one.
 * - A refused ssh write leaves the dialog open with the typing and the reason under the alias.
 * - Closing with typing asks first; a blank form, and a Benchmark whose added case was removed
 *   again, close at once.
 * - A shortcut's save waits for its write: a refused one leaves the dialog open with the typing
 *   and the list as it was; a landed one closes it and lists the shortcut. A new shortcut
 *   opened from the composer's text can be saved as it stands, and closes untouched without a
 *   question.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement as h, Fragment } from "react";
import type { ReactElement } from "react";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { UnsavedPrompt } from "../src/lib/unsaved/unsaved-prompt";
import { SshHostDialog } from "../src/features/machines/ssh-host-dialog";
import { CreateBenchmarkModal } from "../src/features/benchmark/create-benchmark-modal";
import { ShortcutsFolder } from "../src/features/chat/shortcuts-folder";
import { HomepageDialog } from "../src/features/builtin-browser/homepage-dialog";
import { apiError, json, stubFetch } from "./helpers/fetch";
import {
  button,
  click,
  dialogs,
  field,
  hasButton,
  mount,
  pressEscape,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

const promptOpen = () => hasButton(en.common.discard);
const withPrompt = (element: ReactElement) => h(Fragment, null, element, h(UnsavedPrompt));

describe("record dialogs", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  describe("the ssh host form", () => {
    const m = en.machines.host;

    async function openAdd() {
      const network = stubFetch(() => apiError(409, "ssh_host_exists", "alias already exists"));
      const onClose = vi.fn();
      await mount(
        withPrompt(
          h(SshHostDialog, { mode: { kind: "add" }, projectId: "p1", onClose, onSaved: () => {} }),
        ),
      );
      return { network, onClose };
    }

    it("waits for an alias and an address, and says a malformed one as it is typed", async () => {
      await openAdd();
      expect(button(m.add).disabled).toBe(true);
      await type(field(m.alias), "build-box");
      await type(field(m.hostName), "10.0.0.5 extra");
      expect(button(m.add).disabled).toBe(true);
      expect(document.body.textContent).toContain(m.oneWord);
      await type(field(m.hostName), "10.0.0.5");
      expect(button(m.add).disabled).toBe(false);
    });

    it("keeps the dialog and the typing when the write is refused, the reason under the alias", async () => {
      const { onClose } = await openAdd();
      await type(field(m.alias), "build-box");
      await type(field(m.hostName), "10.0.0.5");
      await click(button(m.add));
      await waitFor(() => document.body.textContent?.includes(m.exists) === true);
      expect(onClose).not.toHaveBeenCalled();
      expect(field(m.hostName).value).toBe("10.0.0.5");
    });

    it("asks before Esc drops the typing, and closes a blank form at once", async () => {
      const { onClose } = await openAdd();
      await type(field(m.alias), "build-box");
      await pressEscape();
      expect(promptOpen()).toBe(true);
      await click(button(en.common.keepEditing));
      await type(field(m.alias), "");
      await pressEscape();
      expect(promptOpen()).toBe(false);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("the manual Benchmark form", () => {
    const b = en.benchmark;

    async function openCreate() {
      stubFetch(() => apiError(404, "not_found"));
      const onClose = vi.fn();
      await mount(
        withPrompt(
          h(CreateBenchmarkModal, { open: true, onClose, projectId: "p1", onCreated: () => {} }),
        ),
      );
      return onClose;
    }

    it("waits for every required field of the form and of its case", async () => {
      await openCreate();
      expect(button(b.createSubmit).disabled).toBe(true);
      await type(field(b.titleField), "Docs QA");
      await type(field(b.idField), "docs-qa");
      await type(field(b.caseSlugField), "install");
      await type(field(b.caseTitleField), "Install steps");
      await type(field(b.caseStatementField), "Explain how to install.");
      expect(button(b.createSubmit).disabled).toBe(true);
      await type(field(b.caseRubricField), "Names every step.");
      expect(button(b.createSubmit).disabled).toBe(false);
    });

    it("asks before Cancel drops a typed case, and closes once an added case is removed again", async () => {
      const onClose = await openCreate();
      await type(field(b.caseStatementField), "Explain how to install.");
      await click(button(en.common.cancel));
      expect(promptOpen()).toBe(true);
      await click(button(en.common.keepEditing));
      await type(field(b.caseStatementField), "");

      await click(button(b.addCase));
      expect(document.querySelectorAll(`button[aria-label="${b.removeCase}"]`)).toHaveLength(2);
      await click(document.querySelectorAll(`button[aria-label="${b.removeCase}"]`)[0]!);
      await click(button(en.common.cancel));
      expect(promptOpen()).toBe(false);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("the shortcut editor", () => {
    const s = en.chat.shortcuts;

    /** The user's prefs: GET answers the stored list, PUT stores it unless told to refuse. */
    function prefsServer() {
      let stored: unknown[] = [];
      let refuse = false;
      stubFetch((req) => {
        if (req.path !== "/api/me/prefs") return apiError(404, "not_found");
        if (req.method === "PUT") {
          if (refuse) {
            refuse = false;
            return apiError(500, "internal", "refused by the test");
          }
          stored = (req.body as { draftShortcuts: unknown[] }).draftShortcuts;
        }
        return json({ prefs: { draftShortcuts: stored } });
      });
      return {
        refuseNext: () => {
          refuse = true;
        },
      };
    }

    async function openFolder() {
      const server = prefsServer();
      await mount(
        withPrompt(
          h(ShortcutsFolder, {
            open: true,
            onOpen: () => {},
            readComposerText: () => "Summarize the diff",
            onFill: () => {},
          }),
        ),
      );
      await waitFor(() => hasButton(s.new));
      return server;
    }

    it("keeps the dialog and the typing when the write is refused, and lists the shortcut once it lands", async () => {
      const server = await openFolder();
      await click(button(s.new));
      await type(field(s.titleLabel), "Diff summary");
      server.refuseNext();
      await click(button(en.common.save));
      await waitFor(() => !button(en.common.save).disabled);
      expect(dialogs()).toHaveLength(1);
      expect(field(s.titleLabel).value).toBe("Diff summary");
      expect(hasButton("Diff summary")).toBe(false);

      await click(button(en.common.save));
      await waitFor(() => dialogs().length === 0);
      expect(hasButton("Diff summary")).toBe(true);
    });

    it("saves a new shortcut as the composer filled it, and closes it untouched without a question", async () => {
      await openFolder();
      await click(button(s.new));
      expect(button(en.common.save).disabled).toBe(false);
      await pressEscape();
      expect(promptOpen()).toBe(false);
      expect(dialogs()).toEqual([]);

      await click(button(s.new));
      await type(field(s.promptLabel), "Summarize the diff, briefly");
      await pressEscape();
      expect(promptOpen()).toBe(true);
    });
  });

  describe("the homepage", () => {
    const bb = en.builtinBrowser;

    it("waits for an entry that opens another page than the saved one, and asks before Esc drops it", async () => {
      stubFetch(() => apiError(404, "not_found"));
      const onClose = vi.fn();
      await mount(
        withPrompt(
          h(HomepageDialog, { homepage: "https://example.com/", currentPage: null, onClose }),
        ),
      );
      expect(button(en.common.save).disabled).toBe(true);
      await type(field(bb.homepageAddress), "example.com");
      expect(button(en.common.save).disabled).toBe(true);
      await type(field(bb.homepageAddress), "example.org");
      expect(button(en.common.save).disabled).toBe(false);
      await pressEscape();
      expect(promptOpen()).toBe(true);
      await click(button(en.common.discard));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});

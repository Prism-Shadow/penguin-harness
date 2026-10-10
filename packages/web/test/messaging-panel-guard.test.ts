// @vitest-environment jsdom
/**
 * Leaving the messaging binding editor with unsaved credentials, in both of its hosts: the
 * conversation's dock panel (features/messaging/messaging-panel.tsx) and the session-row dialog
 * (features/messaging/messaging-binding-modal.tsx).
 *
 * - The dock tab's ×, the gesture that unmounts the panel, asks while a form holds edits:
 *   "keep editing" keeps the tab and the typing, "discard" lets it close. A clean panel's tab
 *   closes without a question.
 * - Save waits for an edit that can be sent: an App ID alone, with no secret stored, is not.
 * - The dialog's Close asks while it holds edits, through the app's one prompt.
 * - The two hosts keep separate scopes: edits in the panel do not make the dialog ask.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement as h, Fragment } from "react";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { UnsavedPrompt } from "../src/lib/unsaved/unsaved-prompt";
import { MessagingPanel } from "../src/features/messaging/messaging-panel";
import { MessagingBindingModal } from "../src/features/messaging/messaging-binding-modal";
import { confirmClose } from "../src/features/dock/close-guard";
import { tabKey } from "../src/features/dock/dock-state";
import { json, stubFetch } from "./helpers/fetch";
import {
  button,
  click,
  field,
  hasButton,
  mount,
  settle,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

const MESSAGING_TAB = tabKey({ kind: "panel", panel: "messaging" });

function noBindings() {
  stubFetch(() => json({ bindings: [] }));
}

const promptOpen = () => hasButton(en.common.discard);

/** Asks the dock whether the messaging tab may close; the answer lands once the prompt is answered. */
async function askToCloseTab() {
  const answer: { ok?: boolean } = {};
  await act(async () => {
    void confirmClose([MESSAGING_TAB]).then((ok) => {
      answer.ok = ok;
    });
  });
  await settle();
  return answer;
}

describe("the messaging dock panel", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  async function openPanel() {
    noBindings();
    await mount(
      h(Fragment, null, h(MessagingPanel, { sessionId: "s1", active: false }), h(UnsavedPrompt)),
    );
    await waitFor(() => document.querySelector(`input[aria-label="${en.feishu.appId}"]`) !== null);
  }

  it("asks before the tab's × drops typed credentials, and closes on discard", async () => {
    await openPanel();
    await type(field(en.feishu.appId), "cli_a1b2");
    const kept = await askToCloseTab();
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(kept.ok).toBe(false);
    expect(field(en.feishu.appId).value).toBe("cli_a1b2");

    const closed = await askToCloseTab();
    await click(button(en.common.discard));
    expect(closed.ok).toBe(true);
  });

  it("lets a clean panel's tab close without a question", async () => {
    await openPanel();
    const closed = await askToCloseTab();
    expect(promptOpen()).toBe(false);
    expect(closed.ok).toBe(true);
  });

  it("waits for an edit that can be sent before Save goes live", async () => {
    await openPanel();
    expect(button(en.common.save).disabled).toBe(true);
    await type(field(en.feishu.appId), "cli_a1b2");
    expect(button(en.common.save).disabled).toBe(true);
    await type(field(en.feishu.appSecret), "s3cret");
    expect(button(en.common.save).disabled).toBe(false);
  });
});

describe("the messaging binding dialog", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("asks before Close drops typed credentials, keeping them on keep editing", async () => {
    noBindings();
    const onClose = vi.fn();
    await mount(
      h(Fragment, null, h(MessagingBindingModal, { sessionId: "s1", onClose }), h(UnsavedPrompt)),
    );
    await waitFor(() => document.querySelector(`input[aria-label="${en.feishu.appId}"]`) !== null);
    await type(field(en.feishu.appId), "cli_a1b2");
    await click(button(en.common.close));
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(onClose).not.toHaveBeenCalled();
    expect(field(en.feishu.appId).value).toBe("cli_a1b2");

    await click(button(en.common.close));
    await click(button(en.common.discard));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes at once while only the dock panel holds edits", async () => {
    noBindings();
    const onClose = vi.fn();
    await mount(
      h(
        Fragment,
        null,
        h(MessagingPanel, { sessionId: "s2", active: false }),
        h(MessagingBindingModal, { sessionId: "s1", onClose }),
        h(UnsavedPrompt),
      ),
    );
    await waitFor(
      () => document.querySelectorAll(`input[aria-label="${en.feishu.appId}"]`).length === 2,
    );
    // The panel renders first: its App ID box comes first in the document.
    await type(
      document.querySelectorAll<HTMLInputElement>(`input[aria-label="${en.feishu.appId}"]`)[0]!,
      "cli_panel",
    );
    await click(button(en.common.close));
    expect(promptOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
/**
 * Leaving a page of the Settings dialog with unsaved edits (features/settings/settings-dialog.tsx),
 * on the Proxy options page, against the admin settings fake.
 *
 * - A dirty address asks before the rail switches pages: "keep editing" stays on the page with
 *   the text, "discard" switches and the text is gone.
 * - Escape, the × and a press on the scrim each ask while the address is dirty; "keep editing"
 *   leaves the dialog open with the text.
 * - Escape while the prompt is up answers "keep editing": the prompt goes, the dialog stays.
 * - "Discard" on a close closes the dialog, and nothing is left dirty.
 * - A clean page closes at once, and a flipped switch does not make it dirty.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement as h, useState } from "react";
import { hasUnsaved } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { UnsavedPrompt } from "../src/lib/unsaved/unsaved-prompt";
import { SettingsDialog } from "../src/features/settings/settings-dialog";
import { AuthProvider } from "../src/state/auth";
import { adminSettingsServer } from "./helpers/admin-settings";
import {
  button,
  click,
  dialogs,
  field,
  hasButton,
  mount,
  pressEscape,
  pressScrim,
  settle,
  switchNamed,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

const PROXY = "Proxy address";
const STORED = "http://proxy.local:8080";

function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return h(
    AuthProvider,
    null,
    h(SettingsDialog, {
      open,
      section: "proxy",
      onClose: () => {
        setOpen(false);
        onClose();
      },
    }),
    h(UnsavedPrompt),
  );
}

async function openProxyPage() {
  const server = adminSettingsServer();
  const onClose = vi.fn();
  await mount(h(Harness, { onClose }));
  await waitFor(() => document.querySelector(`input[aria-label="${PROXY}"]:enabled`) !== null);
  return { server, onClose };
}

const promptOpen = () => hasButton("Discard changes");
const heading = () => document.querySelector("h2")?.textContent ?? "";

describe("leaving a Settings page with unsaved edits", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("asks before the rail switches pages, and switches only on discard", async () => {
    await openProxyPage();
    await type(field(PROXY), "http://other:3128");
    await click(button("Upload limits"));
    expect(promptOpen()).toBe(true);
    await click(button("Keep editing"));
    expect(heading()).toContain("Proxy options");
    expect(field(PROXY).value).toBe("http://other:3128");

    await click(button("Upload limits"));
    await click(button("Discard changes"));
    await settle();
    expect(heading()).toContain("Upload limits");
    expect(hasUnsaved()).toBe(false);
  });

  it.each([
    ["Escape", pressEscape],
    ["the ×", () => click(button("Close"))],
    ["a press on the scrim", pressScrim],
  ])("asks on %s, and keep editing leaves the dialog open with the text", async (_, leave) => {
    const { onClose } = await openProxyPage();
    await type(field(PROXY), "http://other:3128");
    await leave();
    expect(promptOpen()).toBe(true);
    await click(button("Keep editing"));
    expect(onClose).not.toHaveBeenCalled();
    expect(field(PROXY).value).toBe("http://other:3128");
  });

  it("takes Escape on the prompt as keep editing, and the dialog stays behind it", async () => {
    const { onClose } = await openProxyPage();
    await type(field(PROXY), "http://other:3128");
    await pressEscape();
    expect(dialogs()).toHaveLength(2);
    await pressEscape();
    expect(promptOpen()).toBe(false);
    expect(dialogs()).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(field(PROXY).value).toBe("http://other:3128");
  });

  it("closes on discard, leaving nothing dirty", async () => {
    const { onClose } = await openProxyPage();
    await type(field(PROXY), "http://other:3128");
    await click(button("Close"));
    await click(button("Discard changes"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialogs()).toEqual([]);
    expect(hasUnsaved()).toBe(false);
  });

  it("closes at once while clean, a flipped switch included", async () => {
    const { server, onClose } = await openProxyPage();
    await click(switchNamed("Application uses the proxy"));
    expect(server.stored().proxyForApp).toBe(false);
    await type(field(PROXY), "http://other:3128");
    await type(field(PROXY), STORED);
    await pressEscape();
    expect(promptOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

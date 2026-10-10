// @vitest-environment jsdom
/**
 * The Vault tab's Add dialog (features/agents/vault-add-dialog.tsx) as one record form under
 * the settings commit model.
 *
 * - Add waits for a key that keeps the naming rule and a value; a broken key is named as it is
 *   typed.
 * - Esc, Cancel, a press outside and the × each ask while anything is typed; "keep editing"
 *   leaves the dialog and the typing.
 * - An untouched dialog closes at once.
 * - An added key closes the dialog without asking and joins the table.
 * - A key the server refuses keeps the dialog open with the reason under the key, still unsaved.
 * - A key that is already configured asks before its value is overwritten; Cancel there returns
 *   to the form.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { hasUnsaved } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { VaultTab } from "../src/features/agents/vault-tab";
import {
  AGENT_ID,
  agentServer,
  buttonIn,
  fieldIn,
  mountAgentApp,
  topDialog,
} from "./helpers/agent-app";
import {
  button,
  click,
  dialogs,
  hasButton,
  pressEscape,
  pressScrim,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

async function openAdd() {
  const server = agentServer();
  await mountAgentApp(h(VaultTab, { agentId: AGENT_ID }), { at: `/agents/${AGENT_ID}` });
  await waitFor(() => hasButton(en.aiCreate.manual));
  await click(button(en.aiCreate.manual));
  return server;
}

const key = () => fieldIn(topDialog(), en.vault.key);
const value = () => fieldIn(topDialog(), en.vault.value);
const add = () => buttonIn(topDialog(), en.vault.add);
const promptOpen = () => hasButton(en.common.discard);

describe("adding a vault key", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("waits for a key that keeps the naming rule and a value, naming a broken key", async () => {
    await openAdd();
    expect(add().disabled).toBe(true);
    await type(key(), "2FA KEY");
    await type(value(), "s3cret");
    expect(add().disabled).toBe(true);
    expect(topDialog().textContent).toContain(en.vault.keyInvalid);
    await type(key(), "OPENAI_API_KEY");
    expect(add().disabled).toBe(false);
    expect(topDialog().textContent).not.toContain(en.vault.keyInvalid);
  });

  it.each([
    ["Escape", pressEscape],
    ["Cancel", () => click(buttonIn(topDialog(), en.common.cancel))],
    ["a press outside", pressScrim],
    ["the ×", () => click(buttonIn(topDialog(), "Close"))],
  ])("asks on %s with anything typed, and keep editing keeps the typing", async (_, leave) => {
    await openAdd();
    await type(key(), "OPENAI_API_KEY");
    await leave();
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(dialogs()).toHaveLength(1);
    expect(key().value).toBe("OPENAI_API_KEY");
  });

  it("closes an untouched dialog at once", async () => {
    await openAdd();
    await pressEscape();
    expect(promptOpen()).toBe(false);
    expect(dialogs()).toEqual([]);
  });

  it("closes without asking once added, and the key joins the table", async () => {
    const server = await openAdd();
    await type(key(), "OPENAI_API_KEY");
    await type(value(), "sk-test");
    await click(add());
    await waitFor(() => dialogs().length === 0);
    expect(promptOpen()).toBe(false);
    expect(hasUnsaved()).toBe(false);
    expect(server.vaultKeys()).toEqual(["GITHUB_TOKEN", "OPENAI_API_KEY"]);
    expect(document.body.textContent).toContain("OPENAI_API_KEY");
  });

  it("keeps a refused key open with the reason under it, still unsaved", async () => {
    const server = await openAdd();
    server.refuseNext(400, "invalid_vault", "that key is reserved");
    await type(key(), "PATH");
    await type(value(), "/bin");
    await click(add());
    await waitFor(() => topDialog().textContent?.includes("that key is reserved") === true);
    expect(key().getAttribute("aria-invalid")).toBe("true");
    expect(hasUnsaved()).toBe(true);
    expect(server.vaultKeys()).toEqual(["GITHUB_TOKEN"]);
  });

  it("asks before overwriting a configured key, and Cancel there returns to the form", async () => {
    const server = await openAdd();
    await type(key(), "GITHUB_TOKEN");
    await type(value(), "ghp-new");
    await click(add());
    expect(dialogs()).toHaveLength(2);
    expect(server.writes("/vault")).toEqual([]);
    await click(buttonIn(topDialog(), en.common.cancel));
    expect(dialogs()).toHaveLength(1);
    expect(value().value).toBe("ghp-new");

    await click(add());
    await click(buttonIn(topDialog(), en.common.save));
    await waitFor(() => dialogs().length === 0);
    expect(server.writes("/vault")).toHaveLength(1);
  });
});

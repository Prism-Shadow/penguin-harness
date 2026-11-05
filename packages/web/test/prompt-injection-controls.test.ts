// @vitest-environment jsdom
/**
 * The prompt-injection controls shared by the Skills, Vault and Schedules tabs
 * (features/agents/prompt-injection-controls.tsx), on the Vault tab: an enable switch that writes
 * at once, and a prompt that is a typed form.
 *
 * - Save is held until the prompt differs from the stored one; the stored text typed back holds
 *   it again.
 * - Flipping the switch writes the switch alone; the prompt being typed is neither sent nor
 *   reset — it stays typed and unsaved.
 * - Save writes the prompt at once, with no question first, and the stored answer becomes what
 *   the prompt is compared with; Reset puts the stored text back without asking.
 * - A refused save keeps the typed prompt, still unsaved.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { hasUnsaved, toastStore } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { VaultTab } from "../src/features/agents/vault-tab";
import { AGENT_ID, agentServer, mountAgentApp } from "./helpers/agent-app";
import {
  button,
  click,
  dialogs,
  field,
  switchNamed,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

const STORED_PROMPT = "Vault keys: {{VAULT_KEYS}}";

async function openVault() {
  const server = agentServer();
  await mountAgentApp(h(VaultTab, { agentId: AGENT_ID }), { at: `/agents/${AGENT_ID}` });
  await waitFor(() => document.querySelector("textarea") !== null);
  return server;
}

const prompt = () => field(en.vault.injection.promptLabel);
const save = () => button(en.common.save);

describe("the prompt-injection controls", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  beforeEach(() => toastStore.setState({ items: [] }));
  afterEach(async () => {
    await unmountAll();
  });

  it("holds Save until the prompt changes, and again once the stored text is typed back", async () => {
    await openVault();
    expect(save().disabled).toBe(true);
    await type(prompt(), "Keys: {{VAULT_KEYS}}");
    expect(save().disabled).toBe(false);
    await type(prompt(), STORED_PROMPT);
    expect(save().disabled).toBe(true);
    expect(hasUnsaved()).toBe(false);
  });

  it("writes a flipped switch alone, leaving the typed prompt typed and unsaved", async () => {
    const server = await openVault();
    await type(prompt(), "Keys: {{VAULT_KEYS}}");
    await click(switchNamed(en.vault.injection.enable));
    await waitFor(() => server.writes("/config").length === 1);
    expect(server.writes("/config")[0]!.body).toEqual({ config: { vault: { enabled: false } } });
    await waitFor(
      () => switchNamed(en.vault.injection.enable).getAttribute("aria-checked") === "false",
    );
    expect(prompt().value).toBe("Keys: {{VAULT_KEYS}}");
    expect(save().disabled).toBe(false);
    expect(hasUnsaved()).toBe(true);
  });

  it("saves at once and is clean on the stored answer; Reset restores without asking", async () => {
    const server = await openVault();
    await type(prompt(), "Keys: {{VAULT_KEYS}}");
    await click(save());
    await waitFor(() => server.writes("/config").length === 1);
    expect(dialogs()).toEqual([]);
    expect(server.writes("/config")[0]!.body).toEqual({
      config: { vault: { prompt: "Keys: {{VAULT_KEYS}}" } },
    });
    await waitFor(() => save().disabled);
    expect(hasUnsaved()).toBe(false);

    await type(prompt(), "Something else");
    await click(button(en.common.reset));
    expect(dialogs()).toEqual([]);
    expect(prompt().value).toBe("Keys: {{VAULT_KEYS}}");
    expect(save().disabled).toBe(true);
  });

  it("keeps a refused prompt typed and unsaved", async () => {
    const server = await openVault();
    server.refuseNext(400, "invalid_config");
    await type(prompt(), "Keys: {{VAULT_KEYS}}");
    await click(save());
    await waitFor(() => toastStore.getState().items.length > 0);
    expect(toastStore.getState().items.map((t) => t.kind)).toEqual(["error"]);
    expect(prompt().value).toBe("Keys: {{VAULT_KEYS}}");
    expect(save().disabled).toBe(false);
    expect(hasUnsaved()).toBe(true);
  });
});

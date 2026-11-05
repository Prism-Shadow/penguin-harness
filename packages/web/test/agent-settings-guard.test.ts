// @vitest-environment jsdom
/**
 * Leaving the Agent settings page (features/agents/agent-settings-page.tsx) with unsaved edits,
 * on the app's leave guard: the open tab lives in `?tab=`, so every way off the tab is a
 * navigation the router holds while a form on it is dirty.
 *
 * - A dirty System Prompt tab asks before the tab strip switches tabs; "keep editing" leaves the
 *   address and the typed text as they were, "discard" switches and the text is gone.
 * - It asks before Back to the Agents list, a sidebar link and the browser's Back too.
 * - A clean tab never asks — typing the stored text back included.
 * - A saved tab leaves without asking: Save writes at once, with no question first, and the
 *   stored answer becomes what the tab is compared with.
 * - The Memory prompts ask too, and so do the Skills, Vault and Schedules prompts, untracked
 *   before.
 * - A name typed for a new API key asks; the key row's own Cancel drops it without asking.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { hasUnsaved } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { AgentSettingsPage } from "../src/features/agents/agent-settings-page";
import { AGENT_ID, agentServer, mountAgentApp, whereIs } from "./helpers/agent-app";
import {
  button,
  click,
  dialogs,
  field,
  hasButton,
  run,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

const PAGE = `/agents/${AGENT_ID}`;
const STORED_PROMPT = "You are a helper.\n{{SKILLS}}";

async function openTab(tab: string) {
  const server = agentServer();
  const router = await mountAgentApp(h(AgentSettingsPage), { at: `${PAGE}?tab=${tab}` });
  await waitFor(() => document.querySelector("textarea, input") !== null);
  return { server, router };
}

const systemPrompt = () => field(en.agent.systemPrompt);
const promptOpen = () => hasButton(en.common.discard) && hasButton(en.common.keepEditing);

describe("leaving a dirty Agent settings tab", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("asks before the tab strip switches, and keep editing leaves address and text", async () => {
    const { router } = await openTab("prompt");
    await type(systemPrompt(), "You are a terse helper.");
    await click(button(en.agent.tabRuntime));
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(whereIs(router)).toBe(`${PAGE}?tab=prompt`);
    expect(systemPrompt().value).toBe("You are a terse helper.");
    expect(hasUnsaved()).toBe(true);
  });

  it("switches tabs on discard, and the typed text is gone", async () => {
    const { router } = await openTab("prompt");
    await type(systemPrompt(), "You are a terse helper.");
    await click(button(en.agent.tabRuntime));
    await click(button(en.common.discard));
    expect(whereIs(router)).toBe(`${PAGE}?tab=runtime`);
    expect(hasUnsaved()).toBe(false);
    await click(button(en.agent.tabPrompt));
    expect(systemPrompt().value).toBe(STORED_PROMPT);
  });

  it.each([
    ["Back to the list", () => click(button(en.agent.backToList)), "/agents"],
    ["a sidebar link", () => click(document.querySelector('a[href="/chat"]')!), "/chat"],
  ])("asks before %s, and goes once discard is chosen", async (_, leave, target) => {
    const { router } = await openTab("prompt");
    await type(systemPrompt(), "You are a terse helper.");
    await leave();
    expect(promptOpen()).toBe(true);
    expect(whereIs(router)).toBe(`${PAGE}?tab=prompt`);
    await click(button(en.common.discard));
    expect(whereIs(router)).toBe(target);
  });

  it("holds the browser's Back the same way", async () => {
    const { router } = await openTab("prompt");
    await type(systemPrompt(), "You are a terse helper.");
    await run(() => router.navigate(-1));
    expect(promptOpen()).toBe(true);
    expect(whereIs(router)).toBe(`${PAGE}?tab=prompt`);
    await click(button(en.common.discard));
    expect(whereIs(router)).toBe("/chat");
  });

  it("never asks while the tab is clean, the stored text typed back included", async () => {
    const { router } = await openTab("prompt");
    await type(systemPrompt(), "You are a terse helper.");
    await type(systemPrompt(), STORED_PROMPT);
    await click(button(en.agent.tabRuntime));
    expect(promptOpen()).toBe(false);
    expect(whereIs(router)).toBe(`${PAGE}?tab=runtime`);
  });

  it("leaves a saved tab without asking: Save writes at once and becomes the baseline", async () => {
    const { server, router } = await openTab("prompt");
    expect(button(en.common.save).disabled).toBe(true);
    await type(systemPrompt(), "You are a terse helper.");
    await click(button(en.common.save));
    await waitFor(() => server.writes("/config").length === 1);
    expect(dialogs()).toEqual([]);
    expect(server.writes("/config")[0]!.body).toEqual({
      config: { systemPrompt: "You are a terse helper." },
    });
    await waitFor(() => button(en.common.save).disabled);
    await click(button(en.agent.tabRuntime));
    expect(promptOpen()).toBe(false);
    expect(whereIs(router)).toBe(`${PAGE}?tab=runtime`);
  });

  it.each([
    ["memory", en.memory.promptLabel],
    ["skills", en.skills.injection.promptLabel],
    ["vault", en.vault.injection.promptLabel],
    ["schedules", en.schedule.injection.promptLabel],
  ])("asks before leaving the %s tab with its prompt edited", async (tab, label) => {
    const { router } = await openTab(tab);
    await waitFor(() => document.querySelector("textarea") !== null);
    await type(field(label), "Use them wisely.");
    await click(button(en.agent.tabOverview));
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(whereIs(router)).toBe(`${PAGE}?tab=${tab}`);
    expect(field(label).value).toBe("Use them wisely.");
  });

  it("asks before leaving with a key name typed; the row's Cancel drops it without asking", async () => {
    const { router } = await openTab("api");
    await waitFor(() => hasButton(en.agent.apiNewKey));
    await click(button(en.agent.apiNewKey));
    await type(field(en.agent.apiKeyName), "ci-bot");
    await click(button(en.agent.tabOverview));
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(whereIs(router)).toBe(`${PAGE}?tab=api`);

    await click(button(en.common.cancel));
    expect(promptOpen()).toBe(false);
    expect(hasUnsaved()).toBe(false);
    await click(button(en.agent.tabOverview));
    expect(whereIs(router)).toBe(`${PAGE}?tab=overview`);
  });
});

/** @vitest-environment jsdom */
/**
 * Choosing an Agent opens a searchable dialog with its description and workbench count.
 * Selecting an Agent commits once and closes; dismissal changes no selection.
 * A large list can be filtered and selected using the keyboard without scrolling the page.
 */
import { createElement as h } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { AgentSelect } from "../src/features/agents/agent-select";
import { S } from "../src/lib/strings";
import { button, click, field, mount, pressScrim, type, unmountAll, run } from "./helpers/dom";
const general: AgentSummary = {
  agentId: "general",
  name: "General",
  description: "Everyday help",
  activeSessionCount: 0,
  sessionCount: 0,
  sessionActivity: [],
  toolCount: 0,
  version: 1,
  kernelOutdated: false,
  vaultKeyCount: 0,
  scheduleCount: 0,
  workbenchCount: 0,
  skillCount: 0,
  hookCount: 0,
  pluginUpdates: [],
  memoryCount: 0,
  apiEnabled: false,
};
const support = {
  ...general,
  agentId: "support",
  name: "Support",
  description: "Documentation questions",
  workbenchCount: 2,
};
afterEach(unmountAll);
it("finds an Agent by description, shows its workbenches and commits only on selection", async () => {
  const onSelect = vi.fn();
  await mount(
    h(AgentSelect, { agents: [general, support], selected: general, onSelect, empty: "No agents" }),
  );
  await click(button(S.chat.chooseAgent));
  await type(field(S.workbenches.searchAgents), "documentation");
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.querySelector(`[aria-label="${S.workbenches.count(2)}"]`)).not.toBeNull();
  expect(dialog.textContent).not.toContain("Everyday help");
  await pressScrim();
  expect(onSelect).not.toHaveBeenCalled();
  await click(button(S.chat.chooseAgent));
  const row = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (b) => b.textContent?.includes("Support"),
  )!;
  await click(row);
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(support);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("filters a large list and selects from the keyboard", async () => {
  const agents = Array.from({ length: 60 }, (_, n) => ({
    ...general,
    agentId: `agent_${n}`,
    name: `Helper ${n}`,
    description: `Topic ${n}`,
  }));
  const onSelect = vi.fn();
  await mount(h(AgentSelect, { agents, selected: agents[0]!, onSelect, empty: "No agents" }));
  await click(button(S.chat.chooseAgent));
  const search = field(S.workbenches.searchAgents);
  await type(search, "Topic 59");
  await run(() =>
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
  );
  await run(() =>
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(agents[59]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

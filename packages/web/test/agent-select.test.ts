/** @vitest-environment jsdom */
/**
 * Choosing an Agent opens a searchable dialog with its description and workbench count.
 * Selecting an Agent commits once and closes; dismissal changes no selection.
 */
import { createElement as h } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { AgentSelect } from "../src/features/agents/agent-select";
import { S } from "../src/lib/strings";
import { button, click, field, mount, pressScrim, type, unmountAll } from "./helpers/dom";
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
  expect(dialog.textContent).toContain(S.workbenches.count(2));
  expect(dialog.textContent).not.toContain("Everyday help");
  await pressScrim();
  expect(onSelect).not.toHaveBeenCalled();
  await click(button(S.chat.chooseAgent));
  const row = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (b) => b.textContent?.includes("Documentation questions"),
  )!;
  await click(row);
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(support);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

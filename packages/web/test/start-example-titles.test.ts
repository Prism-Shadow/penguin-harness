import { expect, it } from "vitest";
import type { AppCenterShortcut } from "@prismshadow/penguin-server/api";
import { EXAMPLE_TASKS } from "../src/features/chat/example-tasks";
import { shortPromptTitle } from "../src/features/chat/prompt-action-row";
import { appShortcutTitle, filterAppShortcuts } from "../src/features/chat/start-dashboard";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

it("defines only the two app preset shortcuts", () => {
  expect(EXAMPLE_TASKS.map((t) => t.id)).toEqual(["buildApp", "optimizeApp"]);
  for (const task of EXAMPLE_TASKS) {
    expect(task.skills).toEqual(["penguin-plugin", "web-design"]);
  }
});

it.each([
  ["zh", zh],
  ["en", en],
] as const)("keeps all %s suggestion labels short and distinct", (locale, strings) => {
  const names = EXAMPLE_TASKS.map(({ id }) => strings.chat.exampleTasks[id].label);
  expect(new Set(names).size).toBe(names.length);
  for (const name of names) expect(shortPromptTitle(name, locale)).toBe(name);
});

it("formats the optimizeApp prompt for a chosen workbench", () => {
  const zhPrompt = zh.chat.exampleTasks.optimizeApp.promptFor(
    "客服工作台",
    "penguin_support",
    "support",
  );
  expect(zhPrompt).toContain("客服工作台");
  expect(zhPrompt).toContain("penguin_support");
  expect(zhPrompt).toContain("support");

  const enPrompt = en.chat.exampleTasks.optimizeApp.promptFor(
    "Support Desk",
    "penguin_support",
    "support",
  );
  expect(enPrompt).toContain("Support Desk");
  expect(enPrompt).toContain("penguin_support");
  expect(enPrompt).toContain("support");
});

it("filters existing apps by localized title, workbench id and agent", () => {
  const sample: AppCenterShortcut[] = [
    {
      agentId: "penguin_support",
      agentName: "Support Agent",
      workbenchId: "support",
      title: "Support Desk",
      titleZh: "客服工作台",
      path: "/app/demo/penguin_support/support",
      build: "ready",
      showInSidebar: true,
    },
    {
      agentId: "default_agent",
      agentName: "Default",
      workbenchId: "slides",
      title: "Bento Slides",
      titleZh: "幻灯片",
      path: "/app/demo/default_agent/slides",
      build: "ready",
      showInSidebar: true,
    },
  ];
  expect(appShortcutTitle(sample[0]!, "zh")).toBe("客服工作台");
  expect(appShortcutTitle(sample[0]!, "en")).toBe("Support Desk");
  expect(filterAppShortcuts(sample, "zh", "客服").map((a) => a.workbenchId)).toEqual(["support"]);
  expect(filterAppShortcuts(sample, "en", "slides").map((a) => a.workbenchId)).toEqual(["slides"]);
  expect(filterAppShortcuts(sample, "en", "penguin_support").map((a) => a.workbenchId)).toEqual([
    "support",
  ]);
  expect(filterAppShortcuts(sample, "en", "nonexistent")).toEqual([]);
});

it("keeps whole graphemes in a long saved title", () => {
  expect(shortPromptTitle("ABCDEFe\u0301👩‍👩‍👦 xyz", "zh")).toBe("ABCDEFe\u0301…");
  expect(shortPromptTitle("ABCDEF👩‍👩‍👦 xyz", "zh")).toBe("ABCDEF👩‍👩‍👦…");
});

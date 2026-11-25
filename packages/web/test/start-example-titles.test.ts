import { expect, it } from "vitest";
import type { AppCenterShortcut } from "@prismshadow/penguin-server/api";
import { EXAMPLE_TASKS } from "@prismshadow/penguin-library-session/web/chat/example-tasks";
import { shortPromptTitle } from "@prismshadow/penguin-library-session/web/chat/prompt-action-row";
import { appShortcutTitle, filterAppShortcuts } from "@prismshadow/penguin-library-session/web/chat/start-dashboard";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

it.each([
  ["zh", zh],
  ["en", en],
] as const)("keeps all %s suggestion labels short and distinct", (locale, strings) => {
  const names = EXAMPLE_TASKS.map(({ id }) => strings.chat.exampleTasks[id].label);
  expect(new Set(names).size).toBe(names.length);
  for (const name of names) expect(shortPromptTitle(name, locale)).toBe(name);
});

it.each(["optimizeApp", "publishApp"] as const)(
  "names the chosen app, its Agent and its workbench in the %s prompt",
  (id) => {
    const zhPrompt = zh.chat.exampleTasks[id].promptFor("客服工作台", "penguin_support", "desk");
    expect(zhPrompt).toContain("「客服工作台」");
    expect(zhPrompt).toContain("`penguin_support`");
    expect(zhPrompt).toContain("`desk`");

    const enPrompt = en.chat.exampleTasks[id].promptFor("Support Desk", "penguin_support", "desk");
    expect(enPrompt).toContain('"Support Desk"');
    expect(enPrompt).toContain("`penguin_support`");
    expect(enPrompt).toContain("`desk`");
  },
);

it("names both repositories the publish prompt submits to", () => {
  for (const strings of [zh, en]) {
    const prompt = strings.chat.exampleTasks.publishApp.promptFor("Desk", "a1", "desk");
    expect(prompt).toContain("https://github.com/Prism-Shadow/penguin-harness-apps");
    expect(prompt).toContain("https://github.com/Prism-Shadow/penguin-harness-plugins");
  }
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

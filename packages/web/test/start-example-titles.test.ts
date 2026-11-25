import { expect, it } from "vitest";
import { EXAMPLE_TASKS } from "@prismshadow/penguin-library-session/web/chat/example-tasks";
import { shortPromptTitle } from "@prismshadow/penguin-library-session/web/chat/prompt-action-row";
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

it("keeps whole graphemes in a long saved title", () => {
  expect(shortPromptTitle("ABCDEFe\u0301👩‍👩‍👦 xyz", "zh")).toBe("ABCDEFe\u0301…");
  expect(shortPromptTitle("ABCDEF👩‍👩‍👦 xyz", "zh")).toBe("ABCDEF👩‍👩‍👦…");
});

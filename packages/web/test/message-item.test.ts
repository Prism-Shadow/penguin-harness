/**
 * How the transcript draws a message (src/features/chat/message-item.tsx): through the UI
 * package's reply body and bubbles, with no Markdown, caret or bubble chrome of its own — so a
 * theme's reveal and the package's tests cover what the transcript shows. vitest runs node-only
 * here, so the source is read.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const item = readFileSync(
  fileURLToPath(new URL("../src/features/chat/message-item.tsx", import.meta.url)),
  "utf8",
);

describe("the transcript's messages (source contract)", () => {
  it("renders every assistant reply through AssistantText", () => {
    expect(item).toContain("<AssistantText text={item.text} streaming={item.streaming}>");
    expect(item).not.toContain("▌");
    expect(item).not.toMatch(/<Md\b/);
  });

  it("draws what the person sent through the package's bubbles", () => {
    expect(item).toContain('<MessageBubble variant="user">{text}</MessageBubble>');
    expect(item).not.toContain("max-w-[88%]");
  });
});

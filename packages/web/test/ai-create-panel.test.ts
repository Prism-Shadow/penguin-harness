/**
 * The "Create with AI" panel (src/features/ai-create/ai-create-panel.tsx): the example whose
 * prompt the draft still equals is the selected one, and the full-prompt fold shows what is
 * actually sent.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { AiCreatePanel } from "../src/features/ai-create/ai-create-panel";
import { composeAiPrompt } from "../src/features/ai-create/ai-create-prompt";
import { S } from "../src/lib/strings";

const agents = [{ agentId: "default_agent", name: "Penguin" } as AgentSummary];
const examples = [
  { key: "cli", label: "A CLI", description: "One command", prompt: "Build a CLI" },
  { key: "bot", label: "A bot", prompt: "Build a bot" },
];
const TAIL = "Confirm the name first.";

function render(value: string) {
  return renderToStaticMarkup(
    createElement(AiCreatePanel, {
      value,
      onChange: () => undefined,
      examples,
      tail: TAIL,
      agents,
      agentId: "default_agent",
    }),
  );
}

describe("AiCreatePanel", () => {
  it("marks the example the draft still equals as selected, and no other", () => {
    const html = render("Build a CLI");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(1);
    expect(render("Build a CLI, edited").match(/aria-pressed="true"/g)).toBeNull();
  });

  it("names who does the work and previews the composed prompt in the fold", () => {
    const html = render("Build a CLI");
    expect(html).toContain(S.aiCreate.byAgent("Penguin"));
    expect(html).toContain(composeAiPrompt("Build a CLI", TAIL));
    expect(html).toContain(S.aiCreate.fullPrompt);
  });
});

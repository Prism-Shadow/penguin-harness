// @vitest-environment jsdom
/**
 * - Given an owner's API tab, choosing a model, thinking tier and workspace through the shared
 *   pickers writes only that setting; reopening shows it and resets restore the defaults.
 * - Given a refused choice, the stored value stays selected and an error reaches the screen.
 * - Given a non-owner, all three pickers are disabled and no settings can be written.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { Toaster, hasUnsaved } from "@prismshadow/penguin-ui";
import type { ModelInfo } from "@prismshadow/penguin-server/api";
import { ApiTab } from "../src/features/agents/api-tab";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { AGENT_ID, PROJECT_ID, agentServer, mountAgentApp } from "./helpers/agent-app";
import { button, click, run, unmountAll, waitFor } from "./helpers/dom";

const model: ModelInfo = {
  provider: "custom",
  modelId: "api-model",
  displayName: "API test model",
  credential: { apiKeyMasked: "***" },
  isDefault: false,
  effective: { apiKeySource: "model", baseUrlSource: "none", clientTypeSource: "none" },
};

async function open(isOwner = true) {
  const server = agentServer(undefined, {
    models: { models: [model], providers: {} },
    directory: { path: "/work", parent: "/", entries: [] },
  });
  const router = await mountAgentApp(
    h("div", null, h(ApiTab, { projectId: PROJECT_ID, agentId: AGENT_ID, isOwner }), h(Toaster)),
    { at: `/agents/${AGENT_ID}?tab=api` },
  );
  await waitFor(
    () => document.querySelector('button[aria-label="' + en.chat.chooseModel + '"]') !== null,
  );
  return { server, router };
}

const thinking = () =>
  document.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!;
const option = (value: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((el) =>
    el.textContent?.startsWith(value),
  )!;

describe("API Session settings", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(unmountAll);

  it("uses the shared pickers, persists each choice alone, and clears back to defaults", async () => {
    const { server, router } = await open();
    await click(button(en.chat.chooseModel));
    await click(option("API test model").querySelector("button")!);
    await click(thinking());
    await click(option("high"));
    await click(button(en.chat.workspace));
    await waitFor(() => !button(en.chat.finder.choose).disabled);
    await click(button(en.chat.finder.choose));
    expect(server.writes("/api").map((r) => r.body)).toEqual([
      { model: { provider: model.provider, modelId: model.modelId } },
      { thinkingLevel: "high" },
      { workspace: "/work" },
    ]);
    await run(() => router.navigate("/chat"));
    await run(() => router.navigate(-1));
    await waitFor(
      () => document.querySelector('button[aria-label="' + en.chat.chooseModel + '"]') !== null,
    );
    expect(button(en.chat.chooseModel).textContent).toContain("API test model");
    expect(thinking().textContent).toContain("high");
    expect(button(en.chat.workspace).textContent).toContain("work");
    expect(hasUnsaved()).toBe(false);
    await click(button(en.company.modelClear));
    await click(button(en.common.reset));
    await click(button(en.chat.workspace));
    await click(button(en.chat.workspaceClear));
    expect(
      server
        .writes("/api")
        .slice(-3)
        .map((r) => r.body),
    ).toEqual([{ model: null }, { thinkingLevel: null }, { workspace: null }]);
  });

  it("rolls back a refused choice and displays the failure", async () => {
    const { server } = await open();
    server.refuseNext(400, "bad_request", "Cannot save this choice.");
    await click(thinking());
    await click(option("high"));
    expect(thinking().textContent).toContain(en.agent.defaultValue);
    expect(document.body.textContent).toContain("Cannot save this choice.");
    expect(hasUnsaved()).toBe(false);
  });

  it("disables every picker for a member who is not the owner", async () => {
    const { server } = await open(false);
    expect(button(en.chat.chooseModel).disabled).toBe(true);
    expect(thinking().disabled).toBe(true);
    expect(button(en.chat.workspace).disabled).toBe(true);
    expect(server.writes("/api")).toEqual([]);
  });
});

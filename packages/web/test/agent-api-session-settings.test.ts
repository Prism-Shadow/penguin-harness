// @vitest-environment jsdom
/**
 * - Given an owner's API tab, choosing a model, thinking tier and workspace through the shared
 *   pickers writes only that setting; reopening shows it and resets restore the defaults.
 * - Given inherited thinking settings, the concrete Agent, Project or built-in tier is shown
 *   without writing an override; a saved API tier wins and clearing it restores that fallback.
 * - Given a refused choice, the stored value stays selected and an error reaches the screen.
 * - Given a concurrency edit, no write happens before Save; invalid input blocks Save, Reset
 *   restores the stored number, refused writes keep the draft, and successful writes persist.
 * - Given a dirty concurrency field, changing approvals writes only approvalMode and keeps
 *   the typed limit until it is saved.
 * - Given the example actions, documentation opens at the guide and copying gives an Agent the
 *   current address and id with key handling instructions, never a key.
 * - Given a non-owner, all three pickers are disabled and no settings can be written.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { Toaster, hasUnsaved, ClipboardWriterProvider } from "@prismshadow/penguin-ui";
import type {
  ModelInfo,
  AgentConfigResponse,
  ChatDefaultsDto,
} from "@prismshadow/penguin-server/api";
import { ApiTab } from "../src/features/agents/api-tab";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { AGENT_ID, PROJECT_ID, agentConfig, agentServer, mountAgentApp } from "./helpers/agent-app";
import { button, buttonSoon, click, field, type, run, unmountAll, waitFor } from "./helpers/dom";

const model: ModelInfo = {
  provider: "custom",
  modelId: "api-model",
  displayName: "API test model",
  credential: { apiKeyMasked: "***" },
  isDefault: false,
  effective: { apiKeySource: "model", baseUrlSource: "none", clientTypeSource: "none" },
};

async function open(
  isOwner = true,
  config: AgentConfigResponse = agentConfig(),
  chatDefaults: ChatDefaultsDto = {},
) {
  const server = agentServer(config, {
    chatDefaults,
    models: { models: [model], providers: {} },
    directory: { path: "/work", parent: "/", entries: [] },
  });
  const copied: string[] = [];
  const router = await mountAgentApp(
    h(
      ClipboardWriterProvider,
      {
        write: async (text: string) => {
          copied.push(text);
          return true;
        },
      },
      h("div", null, h(ApiTab, { projectId: PROJECT_ID, agentId: AGENT_ID, isOwner }), h(Toaster)),
    ),
    { at: `/agents/${AGENT_ID}?tab=api` },
  );
  // The pickers' catalog rides the second wave of loads (models, the Agent's config, the
  // chat defaults); a trigger that is mounted but still loading is disabled, and a click on
  // it would be the flake this suite once was. Wait for the tab to be live, not just drawn.
  await waitFor(() => {
    const model = document.querySelector('button[aria-label="' + en.chat.chooseModel + '"]');
    const level = document.querySelector('button[aria-label="' + en.chat.thinkingLevel + '"]');
    if (isOwner) {
      return (
        model !== null &&
        (model as HTMLButtonElement).disabled === false &&
        level !== null &&
        (level as HTMLButtonElement).disabled === false
      );
    }
    // A member's tab is disabled by design; it is live once the pickers stopped loading
    // (a loading picker is disabled too, but shows the "…" of a tier still being resolved).
    return model !== null && level !== null && level.textContent !== "…";
  });
  const level = await buttonSoon(en.chat.thinkingLevel);
  await waitFor(() => level.textContent !== "…");
  await buttonSoon(en.chat.workspace);
  return { server, router, copied };
}

const thinking = async () => buttonSoon(en.chat.thinkingLevel);
const option = (value: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((el) =>
    el.textContent?.startsWith(value),
  )!;

/** The trigger named `name` reads open. */
const expanded = (name: string) =>
  (
    document.querySelector('button[aria-label="' + name + '"]') as HTMLButtonElement | null
  )?.getAttribute("aria-expanded") === "true";

/**
 * Opens the picker whose trigger is named `name`: a click racing the previous panel's
 * outside-click close can lose to it and leave the picker shut, so the open read is waited
 * for and a lost click is clicked again.
 */
const openPicker = async (name: string, attempts = 3) => {
  for (let i = 0; i < attempts; i++) {
    await click(await buttonSoon(name));
    try {
      await waitFor(() => expanded(name));
      return;
    } catch {
      // shut again: the close before won this round; click once more
    }
  }
  throw new Error("the picker " + JSON.stringify(name) + " never opened");
};

describe("API Session settings", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(unmountAll);

  it("uses the shared pickers, persists each choice alone, and clears back to defaults", async () => {
    const { server, router } = await open();
    await openPicker(en.chat.chooseModel);
    await waitFor(() => option("API test model") !== null);
    await click(option("API test model").querySelector("button")!);
    await waitFor(() => !expanded(en.chat.chooseModel));
    await openPicker(en.chat.thinkingLevel);
    await click(await buttonSoon("high"));
    await waitFor(() => !expanded(en.chat.thinkingLevel));
    await openPicker(en.chat.workspace);
    const choose = await buttonSoon(en.chat.finder.choose);
    await waitFor(() => !choose.disabled);
    await click(choose);
    await waitFor(() => server.writes("/api").length === 3);
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
    expect((await buttonSoon(en.chat.chooseModel)).textContent).toContain("API test model");
    await waitFor(
      () =>
        (
          document.querySelector(
            'button[aria-label="' + en.chat.thinkingLevel + '"]',
          ) as HTMLButtonElement | null
        )?.disabled === false,
    );
    expect((await thinking()).textContent).toContain("high");
    expect((await buttonSoon(en.chat.workspace)).textContent).toContain("work");
    expect(hasUnsaved()).toBe(false);
    await click(await buttonSoon(en.company.modelClear));
    await click(
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (el) => el.textContent === en.common.reset && !el.disabled,
      )!,
    );
    expect((await thinking()).textContent).toContain("medium");
    await click(await buttonSoon(en.chat.workspace));
    await click(await buttonSoon(en.chat.workspaceClear));
    expect(
      server
        .writes("/api")
        .slice(-3)
        .map((r) => r.body),
    ).toEqual([{ model: null }, { thinkingLevel: null }, { workspace: null }]);
  });

  it.each([
    [undefined, undefined, "medium"],
    [undefined, "low", "low"],
    ["xhigh", "low", "xhigh"],
    ["none", "low", "none"],
  ] as const)(
    "resolves Agent %s and Project %s to %s without writing",
    async (agent, project, expected) => {
      const config = agentConfig();
      if (agent !== undefined)
        config.config.model = { ...config.config.model, thinkingLevel: agent };
      const { server } = await open(
        true,
        config,
        project === undefined ? {} : { thinkingLevel: project },
      );
      expect((await thinking()).textContent).toContain(expected);
      expect(server.writes()).toEqual([]);
      await click(await thinking());
      await click(await buttonSoon("high"));
      expect((await thinking()).textContent).toContain("high");
      await click(
        [...document.querySelectorAll<HTMLButtonElement>("button")].find(
          (el) => el.textContent === en.common.reset && !el.disabled,
        )!,
      );
      expect((await thinking()).textContent).toContain(expected);
    },
  );

  it("rolls back a refused choice and displays the failure", async () => {
    const { server } = await open();
    server.refuseNext(400, "bad_request", "Cannot save this choice.");
    await click(await thinking());
    await click(await buttonSoon("high"));
    expect((await thinking()).textContent).toContain("medium");
    expect(document.body.textContent).toContain("Cannot save this choice.");
    expect(hasUnsaved()).toBe(false);
  });

  it("saves concurrency only on Save, rejects invalid input, and retains a failed draft", async () => {
    const { server } = await open();
    const limit = field(en.agent.apiConcurrency);
    await type(limit, "0");
    expect(button(en.common.save).disabled).toBe(true);
    expect(document.body.textContent).toContain(en.agent.apiConcurrencyInvalid);
    await type(limit, "2");
    expect(server.writes("/api")).toEqual([]);
    expect(hasUnsaved()).toBe(true);
    await click(button(en.common.reset));
    expect(field(en.agent.apiConcurrency).value).toBe("4");
    expect(hasUnsaved()).toBe(false);
    await type(limit, "2");
    server.refuseNext(400, "bad_request", "Cannot save this limit.");
    await click(button(en.common.save));
    expect(field(en.agent.apiConcurrency).value).toBe("2");
    expect(document.body.textContent).toContain("Cannot save this limit.");
    expect(hasUnsaved()).toBe(true);
    await click(button(en.common.save));
    expect(server.writes("/api").at(-1)?.body).toEqual({ maxConcurrentRuns: 2 });
    expect(hasUnsaved()).toBe(false);
  });

  it("keeps an unsaved concurrency edit when the adjacent approval mode changes", async () => {
    const { server } = await open();
    await type(field(en.agent.apiConcurrency), "7");
    await click(button(en.chat.approvalModeNames["read-only"]!));
    await click(option(en.chat.approvalModeNames["always-ask"]!));
    expect(server.writes("/api").map((r) => r.body)).toEqual([{ approvalMode: "always-ask" }]);
    expect(field(en.agent.apiConcurrency).value).toBe("7");
    expect(hasUnsaved()).toBe(true);
    await click(button(en.common.save));
    expect(server.writes("/api").at(-1)?.body).toEqual({ maxConcurrentRuns: 7 });
  });

  it("links to the usage guide and copies a prompt with this Agent's connection details", async () => {
    const { copied } = await open();
    const link = [...document.querySelectorAll("a")].find(
      (el) => el.textContent === en.agent.apiReadDocs,
    )!;
    expect(link.href).toBe("https://penguin.ooo/docs/agent-api");
    expect(link.target).toBe("_blank");
    const copy = button(en.agent.apiCopyAgentPrompt);
    expect(link.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    await click(copy);
    expect(copied).toHaveLength(1);
    expect(copied[0]).toContain(link.href);
    expect(copied[0]).toContain(`${window.location.origin}/api/amsp/v1`);
    expect(copied[0]).toContain(`${PROJECT_ID}/${AGENT_ID}`);
    expect(copied[0]).toContain("PENGUIN_AGENT_KEY");
    expect(copied[0]).toContain("stream()");
    expect(copied[0]).toContain("await run()");
  });

  it("disables every picker for a member who is not the owner", async () => {
    const { server } = await open(false);
    expect(button(en.chat.chooseModel).disabled).toBe(true);
    expect((await thinking()).disabled).toBe(true);
    expect(button(en.chat.workspace).disabled).toBe(true);
    expect(field(en.agent.apiConcurrency).disabled).toBe(true);
    expect(button(en.common.save).disabled).toBe(true);
    expect(server.writes("/api")).toEqual([]);
  });
});

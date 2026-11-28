// @vitest-environment jsdom
/**
 * The Runtime tab of the Agent settings page (the agents feature's runtime-form.ts and the tab in
 * agent-settings-page.tsx) under the settings commit model.
 *
 * The form's rules:
 * - A box cleared of a saved value is a change, and one Save cannot make: the server cannot drop
 *   an override, so it is an error and Save is held.
 * - Text that is not a number is a change too (it no longer slips past the leave guard as "no
 *   change"), and an error.
 * - Typing the stored number back, spaces and all, is no change.
 * - A number is accepted when it is an integer > 0 or exactly -1; 0, 1.5 and words are not.
 *   The compaction's tool rounds are the exception: any integer of 0 or more (0 allows none).
 * - A text blanked is a change of its own (no reminder; the quoted data alone), sent as "".
 * - A box left as stored is never judged, so an odd stored value cannot block another edit.
 * - Save sends only the keys that changed, each in its own section.
 *
 * On the page:
 * - Save is held while nothing changed, goes live on an edit, and is held again — with the hint
 *   under the box — while a saved number is cleared; Reset puts the stored values back.
 * - Save writes at once, with no question first, sends only what changed, and leaves the tab
 *   clean on the stored answer.
 * - A refused save keeps the edit, still unsaved.
 * - An unset Agent thinking level shows the Project default without making the form dirty;
 *   choosing a localized tier waits for Save and sends its wire value.
 * - A persisted legacy off tier stays reachable before Save, and Reset restores it.
 * - The tool rounds, the reminder and the hand-off note save with the rest of the form, with the
 *   tool rounds' own inline error, and Reset puts the loaded values back; a server that does not
 *   report them (an older one, on a machine) shows none of the three.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { hasUnsaved, sameDraft, toastStore } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { AgentSettingsPage } from "@prismshadow/penguin-library-agent/web/agents/agent-settings-page";
import {
  normalizeRuntime,
  runtimeDraftOf,
  runtimeErrors,
  runtimeUpdateOf,
  type RuntimeDraft,
} from "@prismshadow/penguin-library-agent/web/agents/runtime-form";

import { AGENT_ID, agentConfig, agentServer, mountAgentApp } from "./helpers/agent-app";
import { button, click, dialogs, field, type, unmountAll, waitFor } from "./helpers/dom";

const STORED: RuntimeDraft = runtimeDraftOf(agentConfig().config);
const edit = (patch: Partial<RuntimeDraft>): RuntimeDraft => ({ ...STORED, ...patch });
const dirty = (draft: RuntimeDraft) =>
  !sameDraft(normalizeRuntime(draft), normalizeRuntime(STORED));

describe("the Runtime form's rules", () => {
  it("treats a box cleared of a saved value as a change Save cannot make", () => {
    const draft = edit({ maxTurns: "" });
    expect(dirty(draft)).toBe(true);
    expect(runtimeErrors(draft, STORED)).toEqual({ maxTurns: "cannotClear" });
  });

  it("treats text that is not a number as a change, and an error", () => {
    const draft = edit({ maxTokens: "lots" });
    expect(dirty(draft)).toBe(true);
    expect(runtimeErrors(draft, STORED)).toEqual({ maxTokens: "invalid" });
  });

  it("treats the stored number typed back, spaces and all, as no change", () => {
    expect(dirty(edit({ maxTurns: " 50 " }))).toBe(false);
    expect(runtimeErrors(edit({ maxTurns: " 50 " }), STORED)).toBeNull();
  });

  it("accepts an integer > 0 or -1, and nothing else", () => {
    for (const ok of ["1", "-1", "300000"]) {
      expect(runtimeErrors(edit({ timeoutMs: ok }), STORED)).toBeNull();
    }
    for (const bad of ["0", "-2", "1.5", "abc"]) {
      expect(runtimeErrors(edit({ timeoutMs: bad }), STORED)).toEqual({ timeoutMs: "invalid" });
    }
  });

  it("accepts any integer of 0 or more as the tool rounds, and nothing else", () => {
    for (const ok of ["0", "1", "12"]) {
      expect(runtimeErrors(edit({ maxRounds: ok }), STORED)).toBeNull();
    }
    for (const bad of ["-1", "1.5", "abc"]) {
      expect(runtimeErrors(edit({ maxRounds: bad }), STORED)).toEqual({ maxRounds: "invalid" });
    }
  });

  it("sends a blanked text as the blank it is, beside the tool rounds", () => {
    const draft = edit({ maxRounds: "0", reminder: "", handoffNote: "Carry on." });
    expect(dirty(draft)).toBe(true);
    expect(runtimeUpdateOf(draft, STORED)).toEqual({
      compaction: { maxRounds: 0, reminder: "", handoffNote: "Carry on." },
    });
  });

  it("never judges a box left as stored", () => {
    const stored = { ...STORED, maxContextLength: "0" };
    expect(runtimeErrors({ ...stored, maxTurns: "60" }, stored)).toBeNull();
  });

  it("sends only the keys that changed, each in its section", () => {
    const draft = edit({ maxTurns: "80", thinkingLevel: "high", prompt: "Shorter." });
    expect(runtimeUpdateOf(draft, STORED)).toEqual({
      maxTurns: 80,
      model: { thinkingLevel: "high" },
      compaction: { prompt: "Shorter." },
    });
  });
});

async function openRuntime(config = agentConfig(), projectThinking?: "low" | "high") {
  const server = agentServer(config, {
    chatDefaults: projectThinking === undefined ? {} : { thinkingLevel: projectThinking },
  });
  const router = await mountAgentApp(h(AgentSettingsPage), {
    at: `/agents/${AGENT_ID}?tab=runtime`,
  });
  await waitFor(() => document.querySelector("input[inputmode=numeric]") !== null);
  await waitFor(() => button(en.chat.thinkingLevel).textContent !== "…");
  return { server, router };
}

const maxTurns = () => field(en.agent.maxTurns);
const maxRounds = () => field(en.agent.maxRounds);
const reminder = () => field(en.agent.compactionReminder);
const handoffNote = () => field(en.agent.compactionHandoffNote);
const hasField = (label: string) => {
  try {
    field(label);
    return true;
  } catch {
    return false;
  }
};
const save = () => button(en.common.save);
const reset = () => button(en.common.reset);

describe("the Runtime tab", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  beforeEach(() => toastStore.setState({ items: [] }));
  afterEach(async () => {
    await unmountAll();
  });

  it("holds Save while clean, and while a saved number is cleared, with the hint; Reset restores", async () => {
    await openRuntime();
    expect(save().disabled).toBe(true);
    await type(maxTurns(), "80");
    expect(save().disabled).toBe(false);

    await type(maxTurns(), "");
    expect(save().disabled).toBe(true);
    expect(document.body.textContent).toContain(en.agent.numberCannotClear);
    expect(hasUnsaved()).toBe(true);

    await click(reset());
    expect(maxTurns().value).toBe("50");
    expect(save().disabled).toBe(true);
    expect(hasUnsaved()).toBe(false);
  });

  it("writes at once on Save, only what changed, and is clean on the stored answer", async () => {
    const { server } = await openRuntime();
    await type(maxTurns(), "80");
    await click(save());
    await waitFor(() => server.writes("/config").length === 1);
    expect(dialogs()).toEqual([]);
    expect(server.writes("/config")[0]!.body).toEqual({ config: { maxTurns: 80 } });
    await waitFor(() => save().disabled);
    expect(maxTurns().value).toBe("80");
    expect(hasUnsaved()).toBe(false);
  });

  it("shows the Project tier and saves a localized choice only on Save", async () => {
    const { server } = await openRuntime(agentConfig(), "low");
    expect(button(en.chat.thinkingLevel).textContent).toContain("low");
    expect(save().disabled).toBe(true);
    expect(server.writes()).toEqual([]);
    await click(button(en.chat.thinkingLevel));
    await click(button("high"));
    expect(server.writes()).toEqual([]);
    await click(save());
    expect(server.writes("/config").at(-1)?.body).toEqual({
      config: { model: { thinkingLevel: "high" } },
    });
    expect(hasUnsaved()).toBe(false);
  });

  it("keeps the stored off tier reachable while a settings pick is unsaved", async () => {
    const config = agentConfig();
    config.config.model = { ...config.config.model, thinkingLevel: "none" };
    const { server } = await openRuntime(config, "high");
    expect(button(en.chat.thinkingLevel).textContent).toContain("none");
    await click(button(en.chat.thinkingLevel));
    await click(button("low"));
    await click(button(en.chat.thinkingLevel));
    await click(button("none"));
    expect(hasUnsaved()).toBe(false);
    await click(button(en.chat.thinkingLevel));
    await click(button("medium"));
    await click(reset());
    expect(button(en.chat.thinkingLevel).textContent).toContain("none");
    expect(server.writes()).toEqual([]);
  });

  it("saves the tool rounds and the two texts on Save, and Reset puts the loaded ones back", async () => {
    const { server } = await openRuntime();
    expect(maxRounds().value).toBe("8");
    expect(reminder().value).toBe("Round {{ROUNDS_USED}} done.");
    expect(handoffNote().value).toBe("No summary.\n{{LAST_TURN}}");

    await type(maxRounds(), "3");
    await type(reminder(), "");
    await type(handoffNote(), "Carry on.\n{{USER_MESSAGES}}");
    expect(save().disabled).toBe(false);
    await click(reset());
    expect(maxRounds().value).toBe("8");
    expect(reminder().value).toBe("Round {{ROUNDS_USED}} done.");
    expect(handoffNote().value).toBe("No summary.\n{{LAST_TURN}}");
    expect(save().disabled).toBe(true);
    expect(server.writes()).toEqual([]);

    await type(maxRounds(), "3");
    await type(reminder(), "");
    await type(handoffNote(), "Carry on.\n{{USER_MESSAGES}}");
    await click(save());
    await waitFor(() => server.writes("/config").length === 1);
    expect(server.writes("/config")[0]!.body).toEqual({
      config: {
        compaction: { maxRounds: 3, reminder: "", handoffNote: "Carry on.\n{{USER_MESSAGES}}" },
      },
    });
    await waitFor(() => save().disabled);
    // Compaction settings only: a running conversation picks them up at its next checkpoint.
    expect(toastStore.getState().items.map((t) => t.text)).toEqual([en.agent.savedTakesEffectNow]);
    expect(reminder().value).toBe("");
    expect(hasUnsaved()).toBe(false);
  });

  it("holds Save with the tool rounds' own hint while they are not an integer of 0 or more", async () => {
    await openRuntime();
    await type(maxRounds(), "-1");
    expect(save().disabled).toBe(true);
    expect(document.body.textContent).toContain(en.agent.maxRoundsInvalid);
    await type(maxRounds(), "0");
    expect(save().disabled).toBe(false);
    expect(document.body.textContent).not.toContain(en.agent.maxRoundsInvalid);
  });

  it("shows none of the three when the server does not report them", async () => {
    const config = agentConfig();
    config.config.compaction = {
      maxContextLength: 100000,
      mode: "summarize",
      prompt: "Summarize.",
    };
    const { server } = await openRuntime(config);
    expect(hasField(en.agent.maxRounds)).toBe(false);
    expect(hasField(en.agent.compactionReminder)).toBe(false);
    expect(hasField(en.agent.compactionHandoffNote)).toBe(false);
    await type(field(en.agent.compactionPrompt), "Shorter.");
    await click(save());
    await waitFor(() => server.writes("/config").length === 1);
    expect(server.writes("/config")[0]!.body).toEqual({
      config: { compaction: { prompt: "Shorter." } },
    });
  });

  it("keeps a refused edit, still unsaved", async () => {
    const { server } = await openRuntime();
    server.refuseNext(400, "invalid_config", "max_turns refused");
    await type(maxTurns(), "80");
    await click(save());
    await waitFor(() => toastStore.getState().items.length > 0);
    expect(toastStore.getState().items.map((t) => t.kind)).toEqual(["error"]);
    expect(maxTurns().value).toBe("80");
    expect(save().disabled).toBe(false);
    expect(hasUnsaved()).toBe(true);
  });
});

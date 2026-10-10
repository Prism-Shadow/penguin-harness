// @vitest-environment jsdom
/**
 * The Runtime tab of the Agent settings page (features/agents/runtime-form.ts and the tab in
 * agent-settings-page.tsx) under the settings commit model.
 *
 * The form's rules:
 * - A box cleared of a saved value is a change, and one Save cannot make: the server cannot drop
 *   an override, so it is an error and Save is held.
 * - Text that is not a number is a change too (it no longer slips past the leave guard as "no
 *   change"), and an error.
 * - Typing the stored number back, spaces and all, is no change.
 * - A number is accepted when it is an integer > 0 or exactly -1; 0, 1.5 and words are not.
 * - A box left as stored is never judged, so an odd stored value cannot block another edit.
 * - Save sends only the keys that changed, each in its own section.
 *
 * On the page:
 * - Save is held while nothing changed, goes live on an edit, and is held again — with the hint
 *   under the box — while a saved number is cleared; Reset puts the stored values back.
 * - Save writes at once, with no question first, sends only what changed, and leaves the tab
 *   clean on the stored answer.
 * - A refused save keeps the edit, still unsaved.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { hasUnsaved, sameDraft, toastStore } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { AgentSettingsPage } from "../src/features/agents/agent-settings-page";
import {
  normalizeRuntime,
  runtimeDraftOf,
  runtimeErrors,
  runtimeUpdateOf,
} from "../src/features/agents/runtime-form";
import type { RuntimeDraft } from "../src/features/agents/runtime-form";
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

async function openRuntime() {
  const server = agentServer();
  const router = await mountAgentApp(h(AgentSettingsPage), {
    at: `/agents/${AGENT_ID}?tab=runtime`,
  });
  await waitFor(() => document.querySelector("input[inputmode=numeric]") !== null);
  return { server, router };
}

const maxTurns = () => field(en.agent.maxTurns);
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

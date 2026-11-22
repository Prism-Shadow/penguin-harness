// @vitest-environment jsdom
/**
 * A view of a Project's tool-model bindings follows them (state/use-tool-bindings.ts).
 *
 * - It shows the bindings the server lists, and the multimodal tools plugin's model for a key.
 * - When the server says the Project's bindings changed — from this tab, another tab, or a
 *   machine — it reads them again; a change in another Project leaves it alone.
 * - When a plugin is turned on or off in this window, it reads them again.
 * - Binding a model shows the list the server answers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import type { ServerEvent } from "@prismshadow/penguin-server/api";

vi.mock("../src/api/endpoints", () => ({
  getToolBindings: vi.fn(),
  patchToolBinding: vi.fn(),
}));
import * as api from "../src/api/endpoints";
import type { ToolBinding } from "../src/api/tool-types";
import { publishUserEvent } from "../src/lib/amsp/user-events";
import { notifyPluginsChanged } from "../src/lib/project-change-events";
import { boundToolModel, useToolBindings } from "../src/state/use-tool-bindings";
import { mount, unmountAll } from "./helpers/dom";

const PLUGIN = "@penguinharness/multimodal-tools";
const ASR = { provider: "deepseek", modelId: "deepseek-asr" };
const OTHER_ASR = { provider: "openai", modelId: "gpt-transcribe" };

const s2t = (model?: typeof ASR): ToolBinding => ({
  key: "s2t",
  title: { en: "Speech recognition", zh: "语音识别" },
  package: PLUGIN,
  ...(model ? { model } : {}),
  candidates: [ASR, OTHER_ASR],
});

let latest: ReturnType<typeof useToolBindings> | null = null;
function Probe({ projectId }: { projectId: string }) {
  latest = useToolBindings(projectId, null);
  const model = boundToolModel(latest.bindings, "s2t");
  return h("output", null, model ? model.modelId : "none");
}

const reads = vi.mocked(api.getToolBindings);
const text = (el: HTMLElement) => el.querySelector("output")?.textContent;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function event(ev: ServerEvent) {
  await act(async () => publishUserEvent(ev));
  await settle();
}

afterEach(async () => {
  await unmountAll();
  reads.mockReset();
  vi.mocked(api.patchToolBinding).mockReset();
  latest = null;
});

describe("a view of the tool bindings", () => {
  it("reads them again when the server says this Project's bindings changed, from anywhere", async () => {
    reads.mockResolvedValue({ bindings: [s2t(ASR)] });
    const { container } = await mount(h(Probe, { projectId: "p1" }));
    await settle();
    expect(text(container)).toBe("deepseek-asr");
    expect(reads).toHaveBeenCalledTimes(1);

    reads.mockResolvedValue({ bindings: [s2t(OTHER_ASR)] });
    await event({ type: "tool_bindings_changed", projectId: "p2" });
    expect(reads).toHaveBeenCalledTimes(1);
    expect(text(container)).toBe("deepseek-asr");

    await event({ type: "tool_bindings_changed", projectId: "p1" });
    expect(reads).toHaveBeenCalledTimes(2);
    expect(text(container)).toBe("gpt-transcribe");

    reads.mockResolvedValue({ bindings: [s2t()] });
    await event({
      type: "machine_event",
      machineId: "m1",
      event: { type: "tool_bindings_changed", projectId: "p1" },
    });
    expect(text(container)).toBe("none");
  });

  it("reads them again when a plugin is turned on in this window", async () => {
    reads.mockResolvedValue({ bindings: [] });
    const { container } = await mount(h(Probe, { projectId: "p1" }));
    await settle();
    expect(text(container)).toBe("none");

    reads.mockResolvedValue({ bindings: [s2t(ASR)] });
    await act(async () => notifyPluginsChanged("p1"));
    await settle();
    expect(text(container)).toBe("deepseek-asr");
  });

  it("shows the list the server answers a binding with", async () => {
    reads.mockResolvedValue({ bindings: [s2t()] });
    vi.mocked(api.patchToolBinding).mockResolvedValue({ bindings: [s2t(OTHER_ASR)] });
    const { container } = await mount(h(Probe, { projectId: "p1" }));
    await settle();
    let ok = false;
    await act(async () => {
      ok = await latest!.bind("s2t", OTHER_ASR);
    });
    expect(ok).toBe(true);
    expect(api.patchToolBinding).toHaveBeenCalledWith("p1", { key: "s2t", model: OTHER_ASR });
    expect(text(container)).toBe("gpt-transcribe");
  });
});

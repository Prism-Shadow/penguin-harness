import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CapabilitySettings } from "@prismshadow/penguin-server/api";
import { hasBoundCapability } from "../src/api/project-capabilities";
import { CapabilityCardActions } from "../src/features/models/capability-card-actions";
import { setActiveStrings, zh } from "../src/lib/strings";

const model = { provider: "river", modelId: "voice" };
const other = { provider: "lake", modelId: "voice" };
const settings: CapabilitySettings = {
  available: [
    {
      key: "stt",
      package: "@example/voice",
      title: { en: "Meeting transcription", zh: "会议转写" },
    },
  ],
  bindings: { tts: model, stt: model },
  candidates: {
    stt: [model, other],
    tts: [model],
    image: [],
    video: [],
    fetch: [],
    search: [],
    chat: [],
  },
  voicePolish: { enabled: false, model: null },
};

describe("project plugin capabilities", () => {
  it("requires an active contribution and the exact configured model before running voice", () => {
    expect(hasBoundCapability(settings, "tts")).toBe(false);
    expect(hasBoundCapability(settings, "stt")).toBe(true);
    expect(
      hasBoundCapability(
        { ...settings, candidates: { ...settings.candidates, stt: [other] } },
        "stt",
      ),
    ).toBe(false);
    expect(hasBoundCapability({ ...settings, available: [] }, "stt")).toBe(false);
  });
  it("takes each card action from the contribution's localized name and removes it when disabled", () => {
    setActiveStrings(zh);
    const render = (current: CapabilitySettings, row = model) =>
      renderToStaticMarkup(
        createElement(CapabilityCardActions, {
          model: row,
          locale: "zh",
          settings: current,
          owner: true,
          busy: false,
          onSelect: () => {},
        }),
      );
    expect(render(settings)).toContain("当前会议转写模型");
    expect(render(settings, other)).toContain("设为会议转写模型");
    expect(render({ ...settings, available: [] })).toBe("");
  });
});

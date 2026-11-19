import { describe, expect, it } from "vitest";
import type { ToolModelSettings } from "@prismshadow/penguin-server/api";
import { hasBoundCapability } from "../src/lib/bound-capability";

const model = { provider: "river", modelId: "voice" };
const other = { provider: "lake", modelId: "voice" };
const settings: ToolModelSettings = {
  available: [
    {
      key: "s2t",
      package: "@example/voice",
      title: { en: "Meeting transcription", zh: "会议转写" },
    },
  ],
  bindings: { t2s: model, s2t: model },
  candidates: {
    s2t: [model, other],
    t2s: [model],
    t2i: [],
    t2v: [],
    fetch: [],
    search: [],
    t2t: [],
    i2t: [],
  },
  voicePolish: { enabled: false, prompt: "Original", defaultPrompt: "Original" },
};

describe("project plugin capabilities", () => {
  it("requires an active contribution and the exact configured model before running voice", () => {
    expect(hasBoundCapability(settings, "t2s")).toBe(false);
    expect(hasBoundCapability(settings, "s2t")).toBe(true);
    expect(
      hasBoundCapability(
        { ...settings, candidates: { ...settings.candidates, s2t: [other] } },
        "s2t",
      ),
    ).toBe(false);
    expect(hasBoundCapability({ ...settings, available: [] }, "s2t")).toBe(false);
  });
});

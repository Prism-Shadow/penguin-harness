/**
 * Session surfaces on the client: the label a "New chat" entry shows follows the interface
 * language, and the renderer names a server-contributed surface may point at are the ones
 * the chat page's registry actually carries.
 */
import { describe, expect, it } from "vitest";
import { surfaceLabel } from "../src/state/contributions";
import { SURFACE_RENDERER_NAMES } from "../src/features/chat/session-surface-view";

const summary = {
  id: "x.surface",
  from: "X",
  kind: "x",
  label: "Claude Code",
  renderer: { builtin: "TerminalSurface" as const },
};

describe("surfaceLabel", () => {
  it("shows the Chinese label on a Chinese interface, falling back to the label", () => {
    expect(surfaceLabel(summary, "en")).toBe("Claude Code");
    expect(surfaceLabel(summary, "zh")).toBe("Claude Code");
    expect(surfaceLabel({ ...summary, labelZh: "代码助手" }, "zh")).toBe("代码助手");
    expect(surfaceLabel({ ...summary, labelZh: "代码助手" }, "en")).toBe("Claude Code");
  });
});

describe("the surface renderer registry", () => {
  it("carries TerminalSurface, the renderer a pty-backed surface names", () => {
    expect(SURFACE_RENDERER_NAMES.has("TerminalSurface")).toBe(true);
  });
});

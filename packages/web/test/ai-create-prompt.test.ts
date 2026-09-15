/**
 * The prompt a "Create with AI" surface sends (src/features/ai-create/ai-create-prompt.ts):
 * the draft, then the surface's fixed tail after a blank line.
 */
import { describe, expect, it } from "vitest";
import { composeAiPrompt } from "../src/features/ai-create/ai-create-prompt";

describe("composeAiPrompt", () => {
  it("joins the trimmed draft and tail with one blank line", () => {
    expect(composeAiPrompt("  Build a CLI  \n", "\nConfirm the name first.\n")).toBe(
      "Build a CLI\n\nConfirm the name first.",
    );
  });

  it("omits an absent or blank tail", () => {
    expect(composeAiPrompt("Build a CLI")).toBe("Build a CLI");
    expect(composeAiPrompt("Build a CLI", "   ")).toBe("Build a CLI");
  });

  it("previews the tail alone while the draft is still empty", () => {
    expect(composeAiPrompt("   ", "Confirm the name first.")).toBe("Confirm the name first.");
  });
});

/** Provider visual-theme coverage for every built-in model group and unknown-group fallback. */
import { describe, expect, it } from "vitest";
import { MODEL_PROVIDERS } from "@prismshadow/penguin-core/model-catalog";
import { PROVIDER_THEMES, providerTheme } from "../src/components/ui/provider-theme";

describe("providerTheme", () => {
  it("covers every built-in model provider", () => {
    const missing = MODEL_PROVIDERS.map((provider) => provider.id).filter(
      (provider) => providerTheme(provider) === undefined,
    );
    expect(missing).toEqual([]);
  });

  it("uses one visual family for the two Qwen billing groups", () => {
    expect(PROVIDER_THEMES["qwen-token-plan"]).toEqual(PROVIDER_THEMES["qwen-pay-as-you-go"]);
  });

  it("defines two valid gradient stops for every built-in provider", () => {
    for (const provider of MODEL_PROVIDERS) {
      const theme = providerTheme(provider.id)!;
      expect(theme.gradientFrom).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.gradientTo).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("leaves unknown providers to the neutral header and letter-tile fallbacks", () => {
    expect(providerTheme("team-proxy")).toBeUndefined();
  });
});

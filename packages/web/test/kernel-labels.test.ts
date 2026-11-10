/**
 * kernelTabLabel: the kernel merge report's tab key → display name.
 *
 * - A tab the settings page has reads as that tab's own label, in the active language.
 * - An unknown key (a tab a newer server manages) falls back to the raw key.
 */
import { afterEach, describe, expect, it } from "vitest";
import { kernelTabLabel } from "../src/features/agents/kernel-labels";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

afterEach(() => setActiveStrings(zh));

describe("kernelTabLabel", () => {
  it("names a settings tab as the tab strip does, in the active language", () => {
    for (const dict of [zh, en]) {
      setActiveStrings(dict);
      expect(kernelTabLabel("vault")).toBe(dict.agent.tabVault);
    }
  });

  it("falls back to the raw key for an unknown tab (a newer server's)", () => {
    expect(kernelTabLabel("future_tab")).toBe("future_tab");
  });
});

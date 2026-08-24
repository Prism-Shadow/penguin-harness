/**
 * kernelTabLabel unit tests: the kernel merge report's tab-key → display-name mapping — every
 * managed tab renders as that tab's own label in both locales, and an unknown key (a tab a
 * newer server manages) falls back to the raw key.
 */
import { afterEach, describe, expect, it } from "vitest";
import { kernelTabLabel } from "../src/features/agents/kernel-labels";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

/** Every tab core's KERNEL_TABS manages, in the settings page's tab order. */
const KERNEL_TABS = ["prompt", "runtime", "tools", "skills", "memory", "vault", "schedules"];

afterEach(() => setActiveStrings(zh));

describe("kernelTabLabel", () => {
  it("renders every managed tab as its own settings-page label, in both locales", () => {
    for (const [locale, dict] of [
      ["zh", zh],
      ["en", en],
    ] as const) {
      setActiveStrings(dict);
      const expected: Record<string, string> = {
        prompt: dict.agent.tabPrompt,
        runtime: dict.agent.tabRuntime,
        tools: dict.agent.tabTools,
        skills: dict.agent.tabSkills,
        memory: dict.agent.tabMemory,
        vault: dict.agent.tabVault,
        schedules: dict.agent.tabSchedules,
      };
      for (const tab of KERNEL_TABS) {
        expect(kernelTabLabel(tab), `${locale} ${tab}`).toBe(expected[tab]);
        // A label that fell through to the raw key would read as the bare tab key.
        expect(kernelTabLabel(tab), `${locale} ${tab}`).not.toBe(tab);
      }
    }
  });

  it("falls back to the raw key for an unknown tab (a newer server's)", () => {
    expect(kernelTabLabel("future_tab")).toBe("future_tab");
  });
});

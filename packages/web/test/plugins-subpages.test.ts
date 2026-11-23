/**
 * Which sub-page of the Agent settings Plugins tab an address opens
 * (features/agents/plugins-subpages.ts).
 *
 * - Given the `?tab=` value of a sub-page, the tab opens on that sub-page.
 * - Given no value, another tab's, a wrong-cased or an unknown one, it opens on its first.
 */
import { describe, expect, it } from "vitest";
import { resolvePluginsSubPage } from "../src/features/agents/plugins-subpages";

describe("the Plugins tab's sub-page in the address", () => {
  it.each(["plugins", "skills", "hooks", "workbenches"] as const)(
    "?tab=%s opens that sub-page",
    (value) => {
      expect(resolvePluginsSubPage(value)).toBe(value);
    },
  );

  it.each([null, "", "tools", "Skills", "skill", "plugin"])(
    "?tab=%s opens the first sub-page",
    (value) => {
      expect(resolvePluginsSubPage(value)).toBe("plugins");
    },
  );
});

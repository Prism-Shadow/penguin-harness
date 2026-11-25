// @vitest-environment jsdom
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { hasUnsaved } from "@prismshadow/penguin-ui";
import { ResourceLimitsSection } from "@prismshadow/penguin-library-setting/web/resource-limits-section";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { adminSettingsServer, STORED_SETTINGS } from "./helpers/admin-settings";
import { button, click, field, mount, type, unmountAll, waitFor } from "./helpers/dom";

beforeAll(() => setActiveStrings(en));
afterAll(() => setActiveStrings(zh));
afterEach(unmountAll);

it("preserves stored limits, rejects invalid values, and saves just the edited limit", async () => {
  const server = adminSettingsServer({ ...STORED_SETTINGS, terminalMaxOpen: 7, browserMaxOpen: 9 });
  await mount(createElement(ResourceLimitsSection));
  const terminal = () => field("Maximum active terminals per user");
  const browser = () => field("Maximum pages per built-in browser backend");
  await waitFor(() => terminal().value === "7");
  expect(browser().value).toBe("9");
  expect(button("Save").disabled).toBe(true);
  for (const invalid of ["0", "", "-1", "1.5", "9007199254740992"]) {
    await type(terminal(), invalid);
    expect(button("Save").disabled).toBe(true);
    expect(terminal().getAttribute("aria-invalid")).toBe("true");
  }
  await type(terminal(), "8");
  await click(button("Save"));
  expect(server.puts()).toEqual([{ terminalMaxOpen: 8 }]);
  expect(browser().value).toBe("9");
  expect(hasUnsaved()).toBe(false);
  await click(button("Restore defaults"));
  expect(terminal().value).toBe("12");
  expect(browser().value).toBe("20");
  expect(server.puts()).toHaveLength(1);
  server.refuseNext(400, "invalid_resource_limit");
  await click(button("Save"));
  expect(hasUnsaved()).toBe(true);
  await click(button("Save"));
  expect(server.stored()).toMatchObject({ terminalMaxOpen: 12, browserMaxOpen: 20 });
  expect(hasUnsaved()).toBe(false);
  expect(button("Restore defaults").disabled).toBe(true);
});

// @vitest-environment jsdom
/**
 * The Upload limits page (features/settings/uploads-section.tsx) under the settings commit
 * model, against the admin settings fake.
 *
 * - Save is held while the limits are as stored, and while a box is empty or not a whole
 *   number — that box is marked with the reason, the other is not.
 * - Typing the stored numbers back is no change.
 * - Save sends both numbers and the page is clean afterwards.
 * - A limit the server refuses stays on screen, unsaved, with the reason under the boxes.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { hasUnsaved } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { UploadsSection } from "../src/features/settings/uploads-section";
import { AuthProvider } from "../src/state/auth";
import { adminSettingsServer } from "./helpers/admin-settings";
import { button, click, field, mount, type, unmountAll, waitFor } from "./helpers/dom";

const MAX = "Max attachment size (MB)";
const TOTAL = "Max total per message (MB)";

async function openPage() {
  const server = adminSettingsServer();
  await mount(h(AuthProvider, null, h(UploadsSection)));
  await waitFor(() => document.querySelector("input:enabled") !== null);
  return server;
}

describe("the Upload limits page", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("holds Save while unchanged, and while a box is not a whole number", async () => {
    await openPage();
    expect(button("Save").disabled).toBe(true);
    await type(field(MAX), "");
    expect(button("Save").disabled).toBe(true);
    expect(field(MAX).getAttribute("aria-invalid")).toBe("true");
    expect(field(TOTAL).getAttribute("aria-invalid")).toBeNull();
    await type(field(MAX), "1.5");
    expect(button("Save").disabled).toBe(true);
    await type(field(MAX), "150");
    expect(button("Save").disabled).toBe(false);
    expect(field(MAX).getAttribute("aria-invalid")).toBeNull();
  });

  it("counts the stored numbers typed back as no change", async () => {
    await openPage();
    await type(field(TOTAL), "200");
    await type(field(TOTAL), "120");
    expect(button("Save").disabled).toBe(true);
    expect(hasUnsaved()).toBe(false);
  });

  it("saves both numbers and is clean afterwards", async () => {
    const server = await openPage();
    await type(field(MAX), "150");
    await type(field(TOTAL), "200");
    await click(button("Save"));
    expect(server.puts()).toEqual([{ attachmentMaxMb: 150, attachmentTotalMb: 200 }]);
    expect(button("Save").disabled).toBe(true);
    expect(hasUnsaved()).toBe(false);
  });

  it("keeps a refused limit on screen, unsaved, with the reason under the boxes", async () => {
    const server = await openPage();
    server.refuseNext(400, "invalid_attachment_limit");
    await type(field(MAX), "5000");
    await click(button("Save"));
    expect(field(MAX).value).toBe("5000");
    expect(field(MAX).getAttribute("aria-invalid")).toBe("true");
    expect(hasUnsaved()).toBe(true);
  });
});

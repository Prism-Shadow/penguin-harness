// @vitest-environment jsdom
/**
 * The account forms reached from the Settings dialog — changing one's password
 * (components/account/change-password-dialog.tsx) and adding a user
 * (library/organization/src/web/admin/admin-users-page.tsx) — under the settings commit model.
 *
 * - Save waits until every field it needs is filled and the two new passwords match; a mismatch
 *   is named under the confirmation as soon as it is typed.
 * - Cancel with anything typed asks first: "keep editing" keeps the dialog and the typing,
 *   "discard" closes it. An untouched dialog closes at once.
 * - A refused password is named under its field and offers no report; a save the server could
 *   not complete is named there too, with 「[报告问题]」 after it, which opens its report.
 * - Add user waits for an id that keeps the naming rule and a password; a broken id is named
 *   under its box as it is typed.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { closeReport, reportStore } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { UnsavedPrompt } from "../src/lib/unsaved/unsaved-prompt";
import { ChangePasswordDialog } from "../src/components/account/change-password-dialog";
import { AdminUsersSection } from "@prismshadow/penguin-library-organization/web/admin/admin-users-page";
import { AuthProvider } from "../src/state/auth";
import { ADMIN_ME, adminSettingsServer } from "./helpers/admin-settings";
import { apiError, json, stubFetch } from "./helpers/fetch";
import {
  button,
  click,
  dialogs,
  field,
  hasButton,
  mount,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

async function openChangePassword() {
  adminSettingsServer();
  const onClose = vi.fn();
  await mount(
    h(AuthProvider, null, h(ChangePasswordDialog, { open: true, onClose }), h(UnsavedPrompt)),
  );
  await waitFor(() => document.querySelector('input[type="password"]') !== null);
  return onClose;
}

describe("changing one's password", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("waits for every field and a matching confirmation before Save goes live", async () => {
    await openChangePassword();
    expect(button("Save").disabled).toBe(true);
    await type(field("Current password"), "old-secret");
    await type(field("New password"), "n3w-Secret!");
    await type(field("Confirm new password"), "n3w-Secret");
    expect(button("Save").disabled).toBe(true);
    expect(document.body.textContent).toContain("New passwords do not match");
    await type(field("Confirm new password"), "n3w-Secret!");
    expect(button("Save").disabled).toBe(false);
    expect(document.body.textContent).not.toContain("New passwords do not match");
  });

  it("asks before Cancel throws the typing away, and closes on discard", async () => {
    const onClose = await openChangePassword();
    await type(field("New password"), "n3w-Secret!");
    await click(button("Cancel"));
    await click(button("Keep editing"));
    expect(onClose).not.toHaveBeenCalled();
    expect(field("New password").value).toBe("n3w-Secret!");
    await click(button("Cancel"));
    await click(button("Discard changes"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes an untouched dialog at once", async () => {
    const onClose = await openChangePassword();
    await click(button("Cancel"));
    expect(hasButton("Discard changes")).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("names a refused password under its field alone, and a failed save with Report after it", async () => {
    // Two saves: the first is refused for the current password, the second fails on the server.
    const saves = [
      apiError(400, "password_mismatch", "Current password is incorrect."),
      apiError(500, "internal", "database is locked"),
    ];
    stubFetch((request) =>
      request.path === "/api/me"
        ? json(ADMIN_ME)
        : request.path === "/api/me/password" && saves.length > 0
          ? saves.shift()!
          : apiError(404, "not_found"),
    );
    await mount(h(AuthProvider, null, h(ChangePasswordDialog, { open: true, onClose: vi.fn() })));
    await waitFor(() => document.querySelector('input[type="password"]') !== null);
    await type(field("Current password"), "old-secret");
    await type(field("New password"), "n3w-Secret!");
    await type(field("Confirm new password"), "n3w-Secret!");
    /** What is said under the current password, through the field's own description. */
    const underCurrent = () =>
      document.getElementById(field("Current password").getAttribute("aria-describedby") ?? "");

    await click(button("Save"));
    await waitFor(() => underCurrent() !== null);
    expect(underCurrent()!.textContent).not.toBe("");
    expect(underCurrent()!.querySelector("[data-report-issue]")).toBeNull();

    await click(button("Save"));
    await waitFor(() => underCurrent()?.querySelector("[data-report-issue]") != null);
    await click(underCurrent()!.querySelector("[data-report-issue]")!);
    expect(reportStore.getState().open?.facts).toContainEqual(["Error code", "internal"]);
    closeReport();
  });
});

describe("adding a user", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("waits for an id that keeps the naming rule and a password, naming a broken id", async () => {
    adminSettingsServer();
    await mount(h(AuthProvider, null, h(AdminUsersSection), h(UnsavedPrompt)));
    await waitFor(() => document.body.textContent?.includes("Add user") === true);
    await click(button("Add user"));
    expect(dialogs()).toHaveLength(1);
    await type(field("Username"), "Bad Name");
    await type(field("Initial password"), "s3cret-Pass");
    expect(button("Create").disabled).toBe(true);
    expect(field("Username").getAttribute("aria-invalid")).toBe("true");
    await type(field("Username"), "alice");
    expect(button("Create").disabled).toBe(false);
  });
});

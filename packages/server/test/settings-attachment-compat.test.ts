/**
 * `Settings.getAttachmentLimitsMb` is a compatibility member: uploads have no size limit on
 * this platform, but a hot push replaces the platform and never the runtime, and an older
 * runtime (the packaged v0.2.13 release) derives its request body cap from this member on every
 * request. A platform whose Settings stopped answering it turned every request on such a
 * runtime into a 500. These tests pin that the platform's Settings, as the tree serves it to
 * the runtime, still answers — with the stored pair, or the old defaults.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Settings } from "../src/mechanisms/settings.js";
import { createTestApp } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("Settings.getAttachmentLimitsMb (compatibility for older runtimes)", () => {
  let t: TestApp | null = null;
  afterEach(async () => {
    await t?.cleanup();
    t = null;
  });

  /** What an older runtime's request middleware resolves: the tree's Settings export. */
  const settingsOf = (app: TestApp): Settings =>
    app.deps.tree.api<Settings>("SettingsModule", "Settings");

  it("answers the old defaults when no limit was ever stored", async () => {
    t = await createTestApp();
    expect(settingsOf(t).getAttachmentLimitsMb()).toEqual({
      attachmentMaxMb: 100,
      attachmentTotalMb: 120,
    });
  });

  it("answers what an admin stored before the limits were retired, clamped to the old bounds", async () => {
    t = await createTestApp();
    const settings = settingsOf(t);
    settings.set("attachment_max_mb", JSON.stringify(10));
    settings.set("attachment_total_mb", JSON.stringify(5000));
    expect(settings.getAttachmentLimitsMb()).toEqual({
      attachmentMaxMb: 10,
      attachmentTotalMb: 200,
    });
  });

  it("falls back to the old defaults on an unreadable stored value", async () => {
    t = await createTestApp();
    const settings = settingsOf(t);
    settings.set("attachment_max_mb", "not json");
    settings.set("attachment_total_mb", JSON.stringify("12"));
    expect(settings.getAttachmentLimitsMb()).toEqual({
      attachmentMaxMb: 100,
      attachmentTotalMb: 120,
    });
  });
});

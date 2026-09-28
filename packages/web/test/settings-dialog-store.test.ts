import { describe, expect, it } from "vitest";
import { createSettingsDialogStore } from "../src/lib/settings-dialog-store";

describe("settings dialog store", () => {
  it("opens on a section and forgets it on close", () => {
    const store = createSettingsDialogStore();
    store.getState().open("deploy");
    expect(store.getState()).toMatchObject({ isOpen: true, section: "deploy" });
    store.getState().close();
    expect(store.getState()).toMatchObject({ isOpen: false, section: null });
    store.getState().open();
    expect(store.getState().section).toBeNull();
  });
});

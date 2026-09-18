/**
 * The work mode the shell stands in across the two switches that make company mode available
 * (state/company.tsx). Turning a switch on offers company mode and never enters it — not even
 * when a company choice is still stored from before the switch went off, which is what used to
 * swap the company sidebar in under the new-chat page. Only the user's own move enters it.
 *
 * Driven against the store, with no React and no DOM: `setServerEnabled` is what the Provider
 * calls with every read of /api/me, and `applyPrefs` what it calls when the preferences arrive.
 * The localStorage mirror is an in-memory stand-in and the preference writes are recorded, so
 * each case says where the choice ends up as well as what the shell shows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/api/endpoints", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/api/endpoints")>()),
  putPrefs: vi.fn(() => Promise.resolve({ prefs: {} })),
}));

import * as api from "../src/api/endpoints";
import { BETA_NOTICE_KEY } from "../src/features/company/beta-badge";
import { WORK_MODE_KEY } from "../src/lib/work-mode";
import { companyModeAvailable, createCompanyStore, effectiveWorkMode } from "../src/state/company";

const putPrefs = vi.mocked(api.putPrefs);
let storage: Map<string, string>;

beforeEach(() => {
  // The beta notice counts as shown, so entering company mode raises no toast here.
  storage = new Map([[BETA_NOTICE_KEY, "1"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  putPrefs.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type Store = ReturnType<typeof createCompanyStore>;

/** What the shell stands in: the mode switch's selection and the sidebar it draws. */
const shown = (store: Store) => effectiveWorkMode(store.getState());

/** Every work mode written to the user's preferences, in order. */
const writtenModes = () =>
  putPrefs.mock.calls.map(([body]) => body.workMode).filter((mode) => mode !== undefined);

describe("availability and the mode the shell stands in", () => {
  it("is available only with both switches on, and stands in development otherwise", () => {
    expect(companyModeAvailable({ serverEnabled: true, personalEnabled: true })).toBe(true);
    expect(companyModeAvailable({ serverEnabled: false, personalEnabled: true })).toBe(false);
    expect(companyModeAvailable({ serverEnabled: true, personalEnabled: false })).toBe(false);
    const company = { workMode: "company" as const };
    expect(effectiveWorkMode({ serverEnabled: true, personalEnabled: true, ...company })).toBe(
      "company",
    );
    expect(effectiveWorkMode({ serverEnabled: false, personalEnabled: true, ...company })).toBe(
      "dev",
    );
    expect(effectiveWorkMode({ serverEnabled: true, personalEnabled: false, ...company })).toBe(
      "dev",
    );
  });
});

describe("turning company mode on offers it and does not enter it", () => {
  it("stays in development when the server's switch comes on", () => {
    const store = createCompanyStore({ serverEnabled: false });
    store.getState().setServerEnabled(false);
    store.getState().setServerEnabled(true);
    expect(companyModeAvailable(store.getState())).toBe(true);
    expect(shown(store)).toBe("dev");
    expect(writtenModes()).toEqual([]);
  });

  it("writes a company choice found while the server's switch is off back as development, so the switch coming on does not apply it", () => {
    // The mirror still holds a choice made before the switch was turned off somewhere else.
    storage.set(WORK_MODE_KEY, "company");
    const store = createCompanyStore({ serverEnabled: false });
    // The first render, before the Provider's effect has reached the store.
    expect(shown(store)).toBe("dev");
    store.getState().setServerEnabled(false);
    expect(store.getState().workMode).toBe("dev");
    expect(storage.get(WORK_MODE_KEY)).toBe("dev");
    expect(writtenModes()).toEqual(["dev"]);

    store.getState().setServerEnabled(true);
    expect(shown(store)).toBe("dev");
  });

  it("puts the choice back to development when the server's switch goes off in a running app", () => {
    const store = createCompanyStore({ serverEnabled: true });
    store.getState().setWorkMode("company");
    store.getState().setCurrentOrg("p1/acme");
    store.getState().setServerEnabled(false);
    expect(store.getState().workMode).toBe("dev");
    expect(store.getState().currentOrgKey).toBeNull();
    // The organization last opened is not part of the choice: switching back still lands there.
    expect(store.getState().lastOrgKey).toBe("p1/acme");

    store.getState().setServerEnabled(true);
    expect(shown(store)).toBe("dev");
    expect(storage.get(WORK_MODE_KEY)).toBe("dev");
    expect(writtenModes()).toEqual(["company", "dev"]);
  });

  it("comes back in development when the user's own switch goes off and on again", () => {
    const store = createCompanyStore({ serverEnabled: true });
    store.getState().setWorkMode("company");
    store.getState().setPersonalEnabled(false);
    expect(shown(store)).toBe("dev");
    expect(store.getState().workMode).toBe("dev");

    store.getState().setPersonalEnabled(true);
    expect(shown(store)).toBe("dev");
    expect(storage.get(WORK_MODE_KEY)).toBe("dev");
    expect(putPrefs.mock.calls.map(([body]) => body)).toEqual([
      { workMode: "company" },
      { workMode: "dev" },
      { companyMode: false },
      { companyMode: true },
    ]);
  });
});

describe("the preferences as they arrive", () => {
  it("settle a company choice while the server's switch is off instead of adopting it", () => {
    const store = createCompanyStore({ serverEnabled: false });
    store.getState().setServerEnabled(false);
    store.getState().applyPrefs({ workMode: "company", lastOrgKey: "p1/acme" });
    expect(store.getState().workMode).toBe("dev");
    expect(storage.get(WORK_MODE_KEY)).toBe("dev");
    expect(writtenModes()).toEqual(["dev"]);
    expect(store.getState().lastOrgKey).toBe("p1/acme");

    store.getState().setServerEnabled(true);
    expect(shown(store)).toBe("dev");
  });

  it("settle it too when they say the user's own switch is off", () => {
    const store = createCompanyStore({ serverEnabled: true });
    store.getState().applyPrefs({ workMode: "company", companyMode: false });
    expect(store.getState().personalEnabled).toBe(false);
    expect(store.getState().workMode).toBe("dev");
    expect(writtenModes()).toEqual(["dev"]);

    store.getState().setPersonalEnabled(true);
    expect(shown(store)).toBe("dev");
  });

  it("keep a company choice while company mode stays available, so a reload stands where the user left it", () => {
    const store = createCompanyStore({ serverEnabled: true });
    store.getState().setServerEnabled(true);
    store.getState().applyPrefs({ workMode: "company" });
    expect(shown(store)).toBe("company");
    expect(storage.get(WORK_MODE_KEY)).toBe("company");
    expect(writtenModes()).toEqual([]);
  });
});

describe("entering company mode", () => {
  it("is the user's own move, and only while company mode is available", () => {
    const store = createCompanyStore({ serverEnabled: false });
    store.getState().setWorkMode("company");
    expect(store.getState().workMode).toBe("dev");
    expect(writtenModes()).toEqual([]);

    store.getState().setServerEnabled(true);
    expect(shown(store)).toBe("dev");
    store.getState().setWorkMode("company");
    expect(shown(store)).toBe("company");
    expect(storage.get(WORK_MODE_KEY)).toBe("company");
    expect(writtenModes()).toEqual(["company"]);
  });
});

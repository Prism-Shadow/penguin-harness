/**
 * The work mode the shell stands in across the two switches that make company mode available
 * (state/company.tsx), driven against the store: `setServerEnabled` is what the Provider calls
 * with every read of /api/me, and `applyPrefs` what it calls when the preferences arrive. Each
 * case says where the choice ends up (the localStorage mirror and the `PUT /api/me/prefs` the
 * fetch fake records) as well as what the shell shows.
 *
 * - Company mode is available only with both switches on; the shell stands in development
 *   otherwise.
 * - A switch coming on offers company mode and never enters it: not when the server's switch
 *   comes on, not with a company choice left from before it went off (which is written back as
 *   development), and not after the server's or the user's own switch went off and on again.
 * - Preferences that arrive with a company choice while a switch is off are settled to
 *   development without passing through company; while company mode stays available, the
 *   choice is kept as it was.
 * - Entering company mode is the user's own move, and only while it is available.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { BETA_NOTICE_KEY } from "../src/features/company/company-beta";
import { WORK_MODE_KEY } from "../src/lib/work-mode";
import { companyModeAvailable, createCompanyStore, effectiveWorkMode } from "../src/state/company";
import { json, stubFetch } from "./helpers/fetch";
import type { FakeFetch } from "./helpers/fetch";
import { memoryStorage, stubLocalStorage } from "./helpers/storage";
import type { MemoryStorage } from "./helpers/storage";

let storage: MemoryStorage;
let setItem: MockInstance<Storage["setItem"]>;
let fetch: FakeFetch;

beforeEach(() => {
  // The beta notice counts as shown, so entering company mode raises no toast here.
  storage = stubLocalStorage(memoryStorage({ [BETA_NOTICE_KEY]: "1" }));
  setItem = vi.spyOn(storage, "setItem");
  fetch = stubFetch((request) => {
    if (request.path === "/api/me/prefs") return json({ prefs: {} });
    throw new TypeError("fetch failed");
  });
});

type Store = ReturnType<typeof createCompanyStore>;

/** What the shell stands in: the mode switch's selection and the sidebar it draws. */
const shown = (store: Store) => effectiveWorkMode(store.getState());

/**
 * Every value written to the work-mode mirror, in order. The end state is not the whole story:
 * a mode the mirror only passes through is a mode the next load finds if the tab closes in that
 * window, so a settled choice must never be written unsettled first.
 */
const modeWrites = () =>
  setItem.mock.calls.filter(([key]) => key === WORK_MODE_KEY).map(([, value]) => value);

/** Every preferences body sent to the server, in order. */
const sentPrefs = () =>
  fetch.requests
    .filter((r) => r.method === "PUT" && r.path === "/api/me/prefs")
    .map((r) => r.body as { workMode?: string });

/** Every work mode written to the user's preferences, in order. */
const writtenModes = () =>
  sentPrefs()
    .map((body) => body.workMode)
    .filter((mode) => mode !== undefined);

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
    storage.setItem(WORK_MODE_KEY, "company");
    setItem.mockClear();
    const store = createCompanyStore({ serverEnabled: false });
    // The first render, before the Provider's effect has reached the store.
    expect(shown(store)).toBe("dev");
    store.getState().setServerEnabled(false);
    expect(store.getState().workMode).toBe("dev");
    expect(storage.getItem(WORK_MODE_KEY)).toBe("dev");
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
    expect(storage.getItem(WORK_MODE_KEY)).toBe("dev");
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
    expect(storage.getItem(WORK_MODE_KEY)).toBe("dev");
    expect(sentPrefs()).toEqual([
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
    expect(storage.getItem(WORK_MODE_KEY)).toBe("dev");
    // Never through "company" on the way: the mirror follows the settled mode, not the stored one.
    expect(modeWrites()).not.toContain("company");
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
    expect(storage.getItem(WORK_MODE_KEY)).toBe("dev");
    expect(modeWrites()).not.toContain("company");
    expect(writtenModes()).toEqual(["dev"]);

    store.getState().setPersonalEnabled(true);
    expect(shown(store)).toBe("dev");
  });

  it("keep a company choice while company mode stays available, so a reload stands where the user left it", () => {
    const store = createCompanyStore({ serverEnabled: true });
    store.getState().setServerEnabled(true);
    store.getState().applyPrefs({ workMode: "company" });
    expect(shown(store)).toBe("company");
    expect(storage.getItem(WORK_MODE_KEY)).toBe("company");
    // One write, and it is the choice itself: nothing was adopted and then taken back.
    expect(modeWrites()).toEqual(["company"]);
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
    expect(storage.getItem(WORK_MODE_KEY)).toBe("company");
    expect(writtenModes()).toEqual(["company"]);
  });
});

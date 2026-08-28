/**
 * The store's `loading` flag never lies "done" (state/sessions.tsx).
 *
 * The flag is what every "no Sessions yet" empty state gates on, so its one hard rule is
 * that it must not read false while nothing has been fetched. The store is exercised
 * directly (node, no DOM): the Provider's reset step owns *raising* the flag on a
 * fetch-context change, which a store test cannot see — what it can pin is that the store
 * itself never clears the flag without having loaded anything.
 */
import { describe, expect, it } from "vitest";
import { createSessionsStore } from "../src/state/sessions";

describe("sessions store loading", () => {
  it("starts loading — a fresh store has fetched nothing", () => {
    expect(createSessionsStore().getState().loading).toBe(true);
  });

  it("reload() without an Agent set returns without claiming to be done", async () => {
    const store = createSessionsStore();
    store.setState({ projectId: "proj", agentIds: [] });
    await store.getState().reload();
    // Nothing was fetched, so nothing may report "loaded" — clearing here is what painted
    // an empty state over a list that was merely not known yet.
    expect(store.getState().loading).toBe(true);
  });

  it("a refresh over rows already on screen does not raise it", async () => {
    // `loading` means "nothing to show yet", not "a fetch is in flight". The chat page draws
    // a skeleton IN PLACE OF the open conversation while it is true, and the list refetches
    // whenever the machine set moves — so a refresh that raised it blanked the conversation
    // being read, over and over for a machine that flaps.
    const store = createSessionsStore();
    store.setState({
      projectId: "proj",
      agentIds: ["default_agent"],
      loading: false,
      sessions: [{ sessionId: "s1" } as never],
    });
    const settled = store.getState().reload();
    expect(store.getState().loading).toBe(false);
    await settled.catch(() => undefined);
  });
});

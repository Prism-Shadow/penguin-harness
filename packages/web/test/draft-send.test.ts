// @vitest-environment jsdom
/**
 * A new conversation's first send (features/chat/draft-view.tsx): two requests, a create and the
 * first task, with the list, the route, the draft and the docks following — and nothing of it
 * left behind when either step is refused.
 *
 * - Given a draft on a machine's Workspace, the first send creates the Session on that machine,
 *   starts its task there, lists the row, opens the conversation, clears the draft and hands the
 *   draft's docks to the new Session.
 * - Given the create refused, nothing else is sent, no row is listed, the page stays on the draft
 *   with the text in the composer, and one toast says why.
 * - Given the task refused after the create, the Session just created is deleted, and once the
 *   server announces the deletion no row is left; the page stays on the draft with its text, and
 *   one toast says why.
 * - Given a second click while the first send is still in flight, one Session is created.
 * - Given the task answering with a self-healed id, the row and the route carry the new id, and
 *   the new id is still addressed to the machine the Session is on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { toastStore } from "@prismshadow/penguin-ui";
import { currentDockScope } from "../src/features/dock/dock-state";
import { LISTING_CHANGE_DELAY_MS } from "../src/state/sessions";
import { S } from "../src/lib/strings";
import { draftKey, loadDraft, saveDraft } from "../src/features/chat/draft-cache";
import { ADMIN_ME } from "./helpers/admin-settings";
import { whereIs } from "./helpers/agent-app";
import { button, click, hasButton, settle, type, unmountAll, waitFor } from "./helpers/dom";
import {
  AGENT_ID,
  MACHINE,
  PROJECT_ID,
  draftWorld,
  listedRows,
  mountDraft,
} from "./helpers/draft-world";

// The page's socket is the test's to drive: the draft world pushes the server's user events
// into the handlers the page registers (helpers/api-socket-world.ts) and carries calls over
// the suite's fetch, as test/socket-stand-in.ts does for every suite. Mocked at the stand-in
// the app imports (vitest.config.ts) — the one seam; the transport itself, frames, reconnects
// and deadlines, is pinned by api-socket.test.ts.
vi.mock("../test/socket-stand-in", async (importActual) => {
  const actual = await importActual<typeof import("../src/api/socket")>();
  const { socketWorld } = await import("./helpers/api-socket-world");
  return { ...actual, apiSocket: socketWorld.apiSocket };
});

const DRAFT_KEY = draftKey(ADMIN_ME.user.userId, PROJECT_ID);
/** The Send button's name in the active language (the locale follows the browser's). */
const send = () => button(S.chat.send);

beforeEach(() => toastStore.setState({ items: [] }));
afterEach(async () => {
  await unmountAll();
  localStorage.clear();
  sessionStorage.clear();
});

const errorToasts = () => toastStore.getState().items.filter((t) => t.kind === "error");
const composer = () => document.querySelector("textarea")!;

/** The draft page with `text` typed, its Send live. `onMachine` puts the Workspace on the machine. */
async function draftReady(text: string, onMachine = false) {
  if (onMachine) {
    saveDraft(DRAFT_KEY, { agentId: AGENT_ID, workspace: "/srv/app", machineId: MACHINE });
  }
  const router = await mountDraft();
  await waitFor(() => composer() !== null);
  await type(composer(), text);
  await waitFor(() => hasButton(S.chat.send) && !send().disabled, 40);
  return router;
}

describe("a new conversation's first send", () => {
  it("creates the Session on the Workspace's machine, starts it there, lists it and opens it", async () => {
    const world = draftWorld();
    const router = await draftReady("Look at the build", true);
    await click(send());
    await waitFor(() => whereIs(router) === "/chat/session-1", 40);

    expect(
      world.creates().map((r) => [r.machine, (r.body as { workspace?: string }).workspace]),
    ).toEqual([[MACHINE, "/srv/app"]]);
    expect(world.tasks().map((r) => [r.machine, r.path])).toEqual([
      [MACHINE, "/api/sessions/session-1/tasks"],
    ]);
    expect(listedRows()).toContain("session-1");
    expect(loadDraft(DRAFT_KEY).text).toBeUndefined();
    expect(currentDockScope()).toBe("session-1");
  });

  it("sends nothing else when the create is refused, lists nothing, and keeps the text", async () => {
    const world = draftWorld();
    world.refuseNext("create", { status: 503, code: "agent_unavailable" });
    const router = await draftReady("Look at the build");
    await click(send());
    await waitFor(() => errorToasts().length > 0);

    expect(world.creates()).toHaveLength(1);
    expect(world.tasks()).toEqual([]);
    expect(world.deletes()).toEqual([]);
    expect(listedRows()).toEqual([]);
    expect(whereIs(router)).toBe("/chat/new");
    expect(composer().value).toBe("Look at the build");
    expect(errorToasts()).toHaveLength(1);
  });

  it("deletes the Session it created when the task is refused, and no row is left", async () => {
    const world = draftWorld();
    const router = await draftReady("Look at the build");
    world.hold("task");
    await click(send());
    // The server announced the new Session: the list has the row while the task is pending.
    await waitFor(() => listedRows().includes("session-1"), 40);

    world.refuseNext("task", { status: 400, code: "invalid_request" });
    // The list applies the server's deletion after its short batching window: the clock is
    // advanced past it rather than waited out.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () => {
      world.release();
      await vi.advanceTimersByTimeAsync(LISTING_CHANGE_DELAY_MS);
    });
    vi.useRealTimers();
    await settle();

    expect(world.deletes().map((r) => [r.machine, r.path])).toEqual([
      [null, "/api/sessions/session-1"],
    ]);
    expect(world.sessionsOn(null)).toEqual([]);
    expect(listedRows()).toEqual([]);
    expect(whereIs(router)).toBe("/chat/new");
    expect(composer().value).toBe("Look at the build");
    expect(errorToasts()).toHaveLength(1);
  });

  it("creates one Session for a second click while the first send is in flight", async () => {
    const world = draftWorld();
    const router = await draftReady("Look at the build");
    world.hold("create");
    await click(send());
    await click(send());
    world.release();
    await waitFor(() => whereIs(router) === "/chat/session-1", 40);
    expect(world.creates()).toHaveLength(1);
    expect(world.tasks()).toHaveLength(1);
  });

  it("lists and opens a self-healed id, still addressed to the machine", async () => {
    const world = draftWorld();
    world.healNext();
    const router = await draftReady("Look at the build", true);
    await click(send());
    await waitFor(() => whereIs(router) === "/chat/session-1-healed", 40);

    expect(listedRows()).toContain("session-1-healed");
    expect(listedRows()).not.toContain("session-1");
    // The row was read back under the new id from the machine, not from this server.
    expect(
      world.fetch.requests
        .filter((r) => r.method === "GET" && r.path === "/api/sessions/session-1-healed")
        .map((r) => r.machine),
    ).toEqual([MACHINE]);
  });
});

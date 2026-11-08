// @vitest-environment jsdom
/**
 * The machine a new conversation is created on travels with its Workspace path
 * (features/chat/draft-view.tsx, features/chat/draft-cache.ts): a path is only meaningful on the
 * machine it was picked on, so a path from anywhere else never inherits a machine left in the
 * draft.
 *
 * - Given a draft on a machine's Workspace when the Project's new-chat defaults are saved with no
 *   draft open (#1414), the next new conversation's first send creates the Session on this
 *   server, in the saved default Workspace.
 * - Given a cached draft that names a machine but no path — what saving the Project's new-chat
 *   defaults used to leave behind — and a Project default Workspace, the first send creates the
 *   Session on this server, in the default Workspace.
 * - Given the same draft and no Project default Workspace, the first send creates the Session on
 *   this server, in a temporary Workspace.
 * - Given a draft on a machine's temporary Workspace (an empty path, the finder's no-folder pick),
 *   the first send still creates the Session on that machine.
 * - Given a draft on a machine's Workspace while the Project's new-chat defaults are saved in this
 *   tab, the draft reseeds to the new default Workspace on this server, and keeps it that way in
 *   its cache.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { toastStore } from "@prismshadow/penguin-ui";
import { S } from "../src/lib/strings";
import { dispatchChatDefaultsChanged } from "../src/features/chat/chat-defaults-event";
import {
  clearDraftChatDefaults,
  draftKey,
  loadDraft,
  saveDraft,
} from "../src/features/chat/draft-cache";
import { ADMIN_ME } from "./helpers/admin-settings";
import { whereIs } from "./helpers/agent-app";
import { button, click, hasButton, settle, type, unmountAll, waitFor } from "./helpers/dom";
import { AGENT_ID, MACHINE, PROJECT_ID, draftWorld, mountDraft } from "./helpers/draft-world";
import type { DraftWorld } from "./helpers/draft-world";

// The page's socket is the test's to drive, as in draft-send.test.ts.
vi.mock("../test/socket-stand-in", async (importActual) => {
  const actual = await importActual<typeof import("../src/api/socket")>();
  const { socketWorld } = await import("./helpers/api-socket-world");
  return { ...actual, apiSocket: socketWorld.apiSocket };
});

const DRAFT_KEY = draftKey(ADMIN_ME.user.userId, PROJECT_ID);
const send = () => button(S.chat.send);
const composer = () => document.querySelector("textarea")!;

beforeEach(() => toastStore.setState({ items: [] }));
afterEach(async () => {
  await unmountAll();
  localStorage.clear();
  sessionStorage.clear();
});

/** The draft page with text typed and its Send live. */
async function draftReady() {
  const router = await mountDraft();
  await waitFor(() => composer() !== null);
  await type(composer(), "Look at the build");
  await waitFor(() => hasButton(S.chat.send) && !send().disabled, 40);
  return router;
}

/** Each create so far: the server it reached (null = this one) and the Workspace it asked for. */
const creates = (world: DraftWorld) =>
  world.creates().map((r) => [r.machine, (r.body as { workspace?: string }).workspace]);

describe("the machine a new conversation is created on", () => {
  it("is this server, in the saved default Workspace, after the Project's defaults are saved with no draft open", async () => {
    saveDraft(DRAFT_KEY, { agentId: AGENT_ID, workspace: "/srv/app", machineId: MACHINE });
    // What the Project dialog's save does once the server has stored the new block.
    clearDraftChatDefaults(ADMIN_ME.user.userId, PROJECT_ID);
    const world = draftWorld({ chatDefaults: { workspace: "/srv/default" } });
    const router = await draftReady();
    await click(send());
    await waitFor(() => whereIs(router) === "/chat/session-1", 40);

    expect(creates(world)).toEqual([[null, "/srv/default"]]);
    expect(world.sessionsOn(MACHINE)).toEqual([]);
  });

  it("is this server when the draft names a machine without a path and the Project names a default Workspace", async () => {
    const world = draftWorld({ chatDefaults: { workspace: "/srv/default" } });
    saveDraft(DRAFT_KEY, { agentId: AGENT_ID, machineId: MACHINE });
    const router = await draftReady();
    await click(send());
    await waitFor(() => whereIs(router) === "/chat/session-1", 40);

    expect(creates(world)).toEqual([[null, "/srv/default"]]);
    expect(world.tasks().map((r) => r.machine)).toEqual([null]);
  });

  it("is this server when the draft names a machine without a path and there is no default Workspace", async () => {
    const world = draftWorld();
    saveDraft(DRAFT_KEY, { agentId: AGENT_ID, machineId: MACHINE });
    const router = await draftReady();
    await click(send());
    await waitFor(() => whereIs(router) === "/chat/session-1", 40);

    expect(world.creates().map((r) => r.machine)).toEqual([null]);
    expect(world.sessionsOn(MACHINE)).toEqual([]);
  });

  it("is the machine when the draft names it with an empty path, a temporary Workspace over there", async () => {
    const world = draftWorld({ chatDefaults: { workspace: "/srv/default" } });
    saveDraft(DRAFT_KEY, { agentId: AGENT_ID, workspace: "", machineId: MACHINE });
    const router = await draftReady();
    await click(send());
    await waitFor(() => whereIs(router) === "/chat/session-1", 40);

    expect(creates(world)).toEqual([[MACHINE, undefined]]);
    expect(world.tasks().map((r) => r.machine)).toEqual([MACHINE]);
  });

  it("follows the new default Workspace to this server when the Project's defaults are saved in this tab", async () => {
    const world = draftWorld();
    saveDraft(DRAFT_KEY, { agentId: AGENT_ID, workspace: "/srv/app", machineId: MACHINE });
    const router = await draftReady();

    await act(async () => {
      dispatchChatDefaultsChanged({ projectId: PROJECT_ID, defaults: { workspace: "/srv/new" } });
    });
    await settle();
    expect(loadDraft(DRAFT_KEY)).toMatchObject({ workspace: "/srv/new" });
    expect(loadDraft(DRAFT_KEY).machineId).toBeUndefined();

    await waitFor(() => hasButton(S.chat.send) && !send().disabled, 40);
    await click(send());
    await waitFor(() => whereIs(router) === "/chat/session-1", 40);
    expect(creates(world)).toEqual([[null, "/srv/new"]]);
  });
});

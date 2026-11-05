/**
 * Discarding a Session whose first Task was refused (features/chat/unstarted-session.ts), with
 * the real sessions store and the real delete wrapper against the fetch fake.
 *
 * - The id is marked deleted in the list before the delete request goes out, so no list
 *   snapshot answered after that can bring the row back.
 * - A delete that fails settles quietly, and the id stays marked deleted.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { deleteSession } from "../src/api/endpoints";
import { discardUnstartedSession } from "../src/features/chat/unstarted-session";
import { createSessionsStore } from "../src/state/sessions";
import { apiError, stubFetch } from "./helpers/fetch";

let store: ReturnType<typeof createSessionsStore>;
beforeEach(() => {
  store = createSessionsStore();
  store.setState({ projectId: "p", agentIds: ["a1"] });
});
const deps = () => ({ remove: store.getState().remove, deleteSession });

describe("discarding an unstarted Session", () => {
  it("marks the id deleted before the delete request goes out", async () => {
    let markedWhenAsked: boolean | null = null;
    const fetch = stubFetch(() => {
      markedWhenAsked = store.getState().deletedSessionIds.has("session-new");
      return new Response(null, { status: 204 });
    });
    await discardUnstartedSession("session-new", deps());
    expect(fetch.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "DELETE /api/sessions/session-new",
    ]);
    expect(markedWhenAsked).toBe(true);
  });

  it("settles quietly when the delete fails, and the id stays marked deleted", async () => {
    stubFetch(() => apiError(500, "internal"));
    await expect(discardUnstartedSession("session-new", deps())).resolves.toBeUndefined();
    expect(store.getState().deletedSessionIds.has("session-new")).toBe(true);
  });
});

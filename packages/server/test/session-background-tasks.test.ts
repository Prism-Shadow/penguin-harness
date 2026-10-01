/**
 * `SessionInfo.backgroundTasks` and its user-channel event `session_background`.
 *
 * The counts are read live from a LOADED runtime's registries: command sessions still running
 * past their yield window, and subagent sessions promoted to a `subagent_id` and mid-round.
 *
 * - The single GET and the list rows carry the counts while something is running; an unloaded
 *   Session (a resumed entry starts with empty registries) and one with nothing running omit
 *   the field, so a list can read its presence as "this row has background work".
 * - The event is published only when the counts moved, carries them as they now stand (zeros
 *   included, so a list clears its mark without refetching), and reaches the same audience
 *   `session_state` does: never a stranger's live channel.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { BackgroundCommandInfo, BackgroundSubagentInfo } from "@prismshadow/penguin-core";
import type { ServerEvent, SessionResponse, SessionsResponse } from "../src/api/types.js";
import { userChannelKey } from "../src/http/routes/events.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { adoptSession, fakeSession, sessionRow, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "owner-default_project";
const STARTED_AT = Date.UTC(2026, 8, 2, 10, 4, 0);

const proc = (processId: string, running: boolean): BackgroundCommandInfo => ({
  processId,
  pid: 4242,
  cmd: "pnpm dev",
  cwd: "/tmp/w",
  startedAt: STARTED_AT,
  running,
});

const sub = (
  sessionId: string,
  subagentId: string | null,
  running: boolean,
): BackgroundSubagentInfo => ({
  sessionId,
  subagentId,
  running,
});

/** The core-side listener seam: the manager subscribes once, the test fires it as core would. */
interface Hook {
  ping: () => void;
}

/** Fake runtime whose registries are two mutable arrays the test edits between pings. */
function backgroundFakeSession(
  sessionId: string,
  procs: BackgroundCommandInfo[],
  subs: BackgroundSubagentInfo[],
  hook: Hook,
): RuntimeSession {
  return fakeSession(sessionId, {
    listBackgroundCommands: () => [...procs],
    listBackgroundSubagents: () => [...subs],
    onBackgroundState: (listener) => {
      hook.ping = listener;
    },
  });
}

/** Everything one user's channel received, as a connected client would see it. */
function inbox(t: TestApp, userId: string) {
  const events: ServerEvent[] = [];
  t.deps.channels.get(userChannelKey(userId)).subscribe((evt) => {
    if (evt.event === "server_event") events.push(JSON.parse(evt.data) as ServerEvent);
  });
  return {
    events,
    background: () => events.flatMap((e) => (e.type === "session_background" ? [e] : [])),
  };
}

let t: TestApp;
let api: ReturnType<typeof apiClient>;

beforeAll(async () => {
  t = await createTestApp();
  api = apiClient(t.app, (await provisionUser(t.app, "owner")).cookie);
  // A logged-in user with a live channel of their own and no access to the Project.
  await provisionUser(t.app, "stranger");
});
afterAll(async () => {
  await t.cleanup();
});

describe("SessionInfo.backgroundTasks", () => {
  let SID: string;
  let SID_UNLOADED: string;
  let procs: BackgroundCommandInfo[];
  let subs: BackgroundSubagentInfo[];
  const hook: Hook = { ping: () => undefined };

  beforeEach(() => {
    SID = uniqueSessionId();
    SID_UNLOADED = uniqueSessionId();
    procs = [proc("proc-11111111", true), proc("proc-22222222", false)];
    subs = [
      sub("session-child-0000000000000001", "subagent-00000001", true),
      // Inside a foreground collect window: no id yet, the running Task's own work.
      sub("session-child-0000000000000002", null, true),
      sub("session-child-0000000000000003", "subagent-00000003", false),
    ];
    adoptSession(t.deps, backgroundFakeSession(SID, procs, subs, hook), { projectId: PROJECT });
    t.deps.sessionsRepo.insert(sessionRow(SID_UNLOADED, { projectId: PROJECT }));
  });

  it("counts running processes and promoted, mid-round subagents on the single GET and on list rows", async () => {
    const single = await api.get(`/api/sessions/${SID}`);
    expect(single.status).toBe(200);
    expect(((await single.json()) as SessionResponse).session.backgroundTasks).toEqual({
      processes: 1,
      subagents: 1,
    });

    const list = await api.get(`/api/projects/${PROJECT}/agents/default_agent/sessions`);
    expect(list.status).toBe(200);
    const rows = ((await list.json()) as SessionsResponse).sessions;
    expect(rows.find((s) => s.sessionId === SID)?.backgroundTasks).toEqual({
      processes: 1,
      subagents: 1,
    });
    // Not loaded: a resumed entry would start with empty registries, so nothing is reported.
    const unloaded = rows.find((s) => s.sessionId === SID_UNLOADED)!;
    expect("backgroundTasks" in unloaded).toBe(false);
  });

  it("omits the field once nothing is running any more", async () => {
    procs[0] = proc("proc-11111111", false);
    subs[0] = sub("session-child-0000000000000001", "subagent-00000001", false);
    const single = (await (await api.get(`/api/sessions/${SID}`)).json()) as SessionResponse;
    expect("backgroundTasks" in single.session).toBe(false);
  });
});

describe("session_background on the user channel", () => {
  let SID: string;
  let procs: BackgroundCommandInfo[];
  let subs: BackgroundSubagentInfo[];
  const hook: Hook = { ping: () => undefined };
  let owner: ReturnType<typeof inbox>;
  let stranger: ReturnType<typeof inbox>;

  beforeEach(() => {
    SID = uniqueSessionId();
    procs = [];
    subs = [];
    adoptSession(t.deps, backgroundFakeSession(SID, procs, subs, hook), { projectId: PROJECT });
    owner = inbox(t, "owner");
    stranger = inbox(t, "stranger");
  });

  it("publishes the counts as they stand after each change, and nothing when they did not move", () => {
    // The counts at load time are the baseline: a ping that changes nothing is not news.
    hook.ping();
    expect(owner.background()).toEqual([]);

    procs.push(proc("proc-11111111", true));
    hook.ping();
    expect(owner.background()).toEqual([
      { type: "session_background", sessionId: SID, processes: 1, subagents: 0 },
    ]);
    hook.ping();
    expect(owner.background()).toHaveLength(1);

    // A promoted child mid-round counts; one still inside its foreground window does not.
    subs.push(sub("session-child-0000000000000001", "subagent-00000001", true));
    hook.ping();
    expect(owner.background().at(-1)).toEqual({
      type: "session_background",
      sessionId: SID,
      processes: 1,
      subagents: 1,
    });
    subs.push(sub("session-child-0000000000000002", null, true));
    hook.ping();
    expect(owner.background()).toHaveLength(2);

    // Zeros are published too: the list clears its mark from the event alone.
    procs[0] = proc("proc-11111111", false);
    subs[0] = sub("session-child-0000000000000001", "subagent-00000001", false);
    hook.ping();
    expect(owner.background().at(-1)).toEqual({
      type: "session_background",
      sessionId: SID,
      processes: 0,
      subagents: 0,
    });
    // The same audience rule as session_state: a stranger's live channel hears nothing.
    expect(stranger.events).toEqual([]);
  });
});

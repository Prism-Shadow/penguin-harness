/**
 * The Session → machine index (machines/session-index.ts): which machine holds a Session this
 * server does not, learnt from the machines' events and by asking them.
 *
 * - Given an id nothing announced, when it is resolved, every connected machine is asked once and
 *   the one that answers 200 holds it; a second resolve asks nobody.
 * - Given two requests for the same unknown id at once, the machines are asked once between them.
 * - Given two machines that both hold the id, the first to answer wins and the later answer does
 *   not replace it.
 * - Given every connected machine says it has no such Session, the id is a miss: asked again
 *   within the miss window it reaches no machine; after the window it asks again.
 * - Given a machine that fails or never answers, the id is unknown but not a miss, so the next
 *   resolve asks again; a machine that never answers is given up on at the deadline.
 * - Given machines that are not connected, they are not asked.
 * - Given a machine's `session_created` event, the id resolves to it without asking; its
 *   `session_deleted` forgets it, while another machine's `session_deleted` for the same id
 *   does not.
 * - Given more Sessions than it holds, the least recently used one is forgotten first.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionMachineIndex } from "../src/machines/session-index.js";
import type { MachineCandidate } from "../src/machines/session-index.js";

const ID = "session-2026-10-22-09-00-00-a1b2c3d4";
const PROJECT = "default_project";

/** A machine's API as the index asks it: `answer` scripts each path, and every ask is counted. */
function machine(
  machineId: string,
  answer: (path: string) => Promise<{ status: number; text: string }>,
): MachineCandidate & { asked: string[] } {
  const asked: string[] = [];
  return {
    machineId,
    alias: `alias-${machineId}`,
    asked,
    api: {
      request: (_method, path) => {
        asked.push(path);
        return answer(path);
      },
    },
  };
}

const holds =
  (projectId = PROJECT) =>
  async () => ({
    status: 200,
    text: JSON.stringify({ session: { sessionId: ID, projectId } }),
  });
const absent = async () => ({
  status: 404,
  text: JSON.stringify({ error: { code: "session_not_found", message: "No." } }),
});
const fleet =
  (...machines: MachineCandidate[]) =>
  async () =>
    machines;

afterEach(() => {
  vi.useRealTimers();
});

describe("the Session → machine index", () => {
  it("asks every connected machine once and remembers the one that holds the Session", async () => {
    const index = new SessionMachineIndex();
    const a = machine("a", absent);
    const b = machine("b", holds("blog"));

    expect(await index.resolve(ID, fleet(a, b))).toEqual({ machineId: "b", projectId: "blog" });
    expect(a.asked).toEqual([`/api/sessions/${ID}`]);
    expect(b.asked).toEqual([`/api/sessions/${ID}`]);

    expect(await index.resolve(ID, fleet(a, b))).toEqual({ machineId: "b", projectId: "blog" });
    expect(a.asked).toHaveLength(1);
    expect(b.asked).toHaveLength(1);
  });

  it("asks the machines once for requests about the same id that arrive together", async () => {
    const index = new SessionMachineIndex();
    const b = machine("b", holds());
    const both = await Promise.all([index.resolve(ID, fleet(b)), index.resolve(ID, fleet(b))]);
    expect(both).toEqual([
      { machineId: "b", projectId: PROJECT },
      { machineId: "b", projectId: PROJECT },
    ]);
    expect(b.asked).toHaveLength(1);
  });

  it("keeps the first machine to answer when two hold the same id", async () => {
    const index = new SessionMachineIndex();
    let late: (value: { status: number; text: string }) => void = () => undefined;
    const slow = machine("slow", () => new Promise((resolve) => (late = resolve)));
    const quick = machine("quick", holds());

    expect(await index.resolve(ID, fleet(slow, quick))).toEqual({
      machineId: "quick",
      projectId: PROJECT,
    });
    late(await holds()());
    await Promise.resolve();
    expect(index.lookup(ID)).toEqual({ machineId: "quick", projectId: PROJECT });
  });

  it("remembers an id every machine denied as a miss, and asks again once the miss expires", async () => {
    let now = 1_000;
    const index = new SessionMachineIndex({ now: () => now, missTtlMs: 10_000 });
    const a = machine("a", absent);

    expect(await index.resolve(ID, fleet(a))).toBeNull();
    now += 9_000;
    expect(await index.resolve(ID, fleet(a))).toBeNull();
    expect(a.asked).toHaveLength(1);

    now += 2_000;
    expect(await index.resolve(ID, fleet(a))).toBeNull();
    expect(a.asked).toHaveLength(2);
  });

  it("does not remember a miss when a machine failed to answer, so the next request asks again", async () => {
    const index = new SessionMachineIndex();
    const denies = machine("a", absent);
    const fails = machine("b", async () => ({ status: 500, text: "{}" }));
    const throws = machine("c", () => Promise.reject(new Error("the channel closed")));

    expect(await index.resolve(ID, fleet(denies, fails, throws))).toBeNull();
    expect(await index.resolve(ID, fleet(denies, fails, throws))).toBeNull();
    expect(denies.asked).toHaveLength(2);
  });

  it("gives up on a machine that never answers at the deadline, without remembering a miss", async () => {
    vi.useFakeTimers();
    const index = new SessionMachineIndex({ askTimeoutMs: 5_000 });
    const silent = machine("a", () => new Promise(() => undefined));

    const pending = index.resolve(ID, fleet(silent));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toBeNull();

    void index.resolve(ID, fleet(silent));
    await vi.advanceTimersByTimeAsync(0);
    expect(silent.asked).toHaveLength(2);
  });

  it("does not ask a machine that is not connected", async () => {
    const index = new SessionMachineIndex();
    const offline: MachineCandidate = { machineId: "a", alias: "box", api: null };
    expect(await index.resolve(ID, fleet(offline))).toBeNull();
  });

  it("learns a Session from its machine's events and forgets it when that machine deletes it", async () => {
    const index = new SessionMachineIndex();
    const a = machine("a", absent);
    index.hear(
      "b",
      JSON.stringify({ type: "session_created", projectId: PROJECT, agentId: "x", sessionId: ID }),
    );
    expect(await index.resolve(ID, fleet(a))).toEqual({ machineId: "b", projectId: PROJECT });
    expect(a.asked).toEqual([]);

    // Another machine deleting a Session it minted under the same id says nothing about b's.
    index.hear("c", JSON.stringify({ type: "session_deleted", projectId: PROJECT, sessionId: ID }));
    expect(index.lookup(ID)).toEqual({ machineId: "b", projectId: PROJECT });

    index.hear("b", JSON.stringify({ type: "session_deleted", projectId: PROJECT, sessionId: ID }));
    expect(index.lookup(ID)).toBeNull();
    // Events that are not about a Session's existence, and frames that are not events, change nothing.
    index.hear("b", JSON.stringify({ type: "machines_changed" }));
    index.hear("b", "not json");
    expect(index.lookup(ID)).toBeNull();
  });

  it("forgets the least recently used Session first when it is full", () => {
    const index = new SessionMachineIndex({ capacity: 2 });
    index.note("s1", "a", PROJECT);
    index.note("s2", "a", PROJECT);
    expect(index.lookup("s1")).not.toBeNull();
    index.note("s3", "a", PROJECT);
    expect(index.lookup("s2")).toBeNull();
    expect(index.lookup("s1")).not.toBeNull();
    expect(index.lookup("s3")).not.toBeNull();
  });
});

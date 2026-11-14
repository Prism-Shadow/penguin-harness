// @vitest-environment jsdom
/**
 * What the chat page says for a link to a conversation the list does not hold while the machines
 * that could hold it are out of reach (features/chat/route-offline-notice.tsx).
 *
 * - Given no machine on record for the Session, the notice says this server does not have it and
 *   names the silent machines it may be on — never that it exists there.
 * - Given more than three silent machines, three are named and the rest are said to exist.
 * - Given the same silent machines in another order, the words are the same: they change only
 *   when the set does.
 * - Given the Session's machine on record, the notice names that machine.
 * - Given a silent machine that is connected (the hub's lookup, or the socket, gave up waiting on
 *   it), it is said not to be answering; one with no connection held is said not to be
 *   connected; several of each kind are said to be one or the other.
 * - Given no machine to name (the socket gave up with none on record), the notice says only that
 *   the conversation may be on a machine this server cannot reach — not that one is disconnected.
 * - Given the same silent machines with the same connections, the words stay the same whatever
 *   else connects or drops: they change only when the set, or the state of one in it, does.
 */
import { createElement as h } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { RouteOfflineNotice } from "../src/features/chat/route-offline-notice";
import { S, setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { mount, unmountAll } from "./helpers/dom";

afterEach(async () => {
  await unmountAll();
});

const LABELS = new Map([
  ["m1", "mdi-b"],
  ["m2", "gpu-box"],
  ["m3", "lab"],
  ["m4", "atlas"],
]);

/** The notice's text; every silent machine is not connected unless `disconnected` says which. */
async function said(
  owner: string | null,
  offline: string[],
  disconnected: string[] = offline,
): Promise<string> {
  const { container } = await mount(
    h(RouteOfflineNotice, { owner, offline, disconnected, labels: LABELS }),
  );
  return container.textContent ?? "";
}

describe("the notice for a link to a conversation no answering server holds", () => {
  it("says this server does not have it and names the one silent machine it may be on", async () => {
    expect(await said(null, ["m1"])).toContain(
      S.chat.sessionMaybeOnMachines(["mdi-b"], false, "disconnected"),
    );
  });

  it("names three silent machines, in one order whatever order they came in, and says there are more", async () => {
    const one = await said(null, ["m4", "m1", "m3", "m2"]);
    await unmountAll();
    const other = await said(null, ["m2", "m3", "m1", "m4"]);
    expect(one).toBe(other);
    expect(one).toContain(
      S.chat.sessionMaybeOnMachines(["atlas", "gpu-box", "lab"], true, "disconnected"),
    );
    expect(one).not.toContain("mdi-b");
  });

  it("names the Session's own machine when it is on record", async () => {
    expect(await said("m1", ["m1", "m2"])).toContain(S.chat.sessionOnOfflineMachine("mdi-b"));
  });
});

describe("a silent machine that is connected, against one that is not", () => {
  it("says the Session's own machine is not answering when it is connected and the socket gave up on it", async () => {
    const text = await said("m1", ["m1"], []);
    expect(text).toContain(S.chat.sessionOnQuietMachine("mdi-b"));
    expect(text).toContain(S.chat.sessionQuietHint);
    expect(text).not.toContain(S.chat.sessionOnOfflineMachine("mdi-b"));
  });

  it("says a machine the hub named, connected, may hold it but is not answering", async () => {
    const text = await said(null, ["m1"], []);
    expect(text).toContain(S.chat.sessionMaybeOnMachines(["mdi-b"], false, "quiet"));
    expect(text).not.toContain(S.chat.sessionMaybeOnMachines(["mdi-b"], false, "disconnected"));
  });

  it("says machines of both kinds are not connected or not answering", async () => {
    expect(await said(null, ["m1", "m2"], ["m2"])).toContain(
      S.chat.sessionMaybeOnMachines(["gpu-box", "mdi-b"], false, "mixed"),
    );
  });

  it("says only that a machine it cannot name is out of reach, not that it is disconnected", async () => {
    for (const strings of [zh, en]) {
      setActiveStrings(strings);
      try {
        const text = await said(null, [], []);
        expect(text).toContain(S.chat.sessionOnOfflineMachineUnknown);
        expect(text).toContain(S.chat.sessionOfflineHint);
        expect(text).not.toMatch(/没有连接|not connected|isn't connected/);
      } finally {
        setActiveStrings(zh);
        await unmountAll();
      }
    }
  });

  it("keeps its words while machines outside the silent set connect or drop", async () => {
    const before = await said(null, ["m1"], []);
    await unmountAll();
    const after = await said(null, ["m1"], ["m3", "m4"]);
    expect(after).toBe(before);
  });
});

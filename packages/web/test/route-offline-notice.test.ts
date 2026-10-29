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
 */
import { createElement as h } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { RouteOfflineNotice } from "../src/features/chat/route-offline-notice";
import { S } from "../src/lib/strings";
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

async function said(owner: string | null, offline: string[]): Promise<string> {
  const { container } = await mount(h(RouteOfflineNotice, { owner, offline, labels: LABELS }));
  return container.textContent ?? "";
}

describe("the notice for a link to a conversation no answering server holds", () => {
  it("says this server does not have it and names the one silent machine it may be on", async () => {
    expect(await said(null, ["m1"])).toContain(S.chat.sessionMaybeOnMachines(["mdi-b"], false));
  });

  it("names three silent machines, in one order whatever order they came in, and says there are more", async () => {
    const one = await said(null, ["m4", "m1", "m3", "m2"]);
    await unmountAll();
    const other = await said(null, ["m2", "m3", "m1", "m4"]);
    expect(one).toBe(other);
    expect(one).toContain(S.chat.sessionMaybeOnMachines(["atlas", "gpu-box", "lab"], true));
    expect(one).not.toContain("mdi-b");
  });

  it("names the Session's own machine when it is on record", async () => {
    expect(await said("m1", ["m1", "m2"])).toContain(S.chat.sessionOnOfflineMachine("mdi-b"));
  });
});

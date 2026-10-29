// @vitest-environment jsdom
/**
 * What the chat page says when the machine holding a linked conversation will not show it to this
 * server (features/chat/route-refused-notice.tsx).
 *
 * - Given the machines list knows the refusing machine, the notice names it by that alias.
 * - Given the list does not, the notice names it as the refusal did.
 */
import { createElement as h } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { RouteRefusedNotice } from "../src/features/chat/route-refused-notice";
import { S } from "../src/lib/strings";
import { mount, unmountAll } from "./helpers/dom";

afterEach(async () => {
  await unmountAll();
});

async function said(machineId: string | null, alias: string | null, labels: [string, string][]) {
  const { container } = await mount(
    h(RouteRefusedNotice, { machineId, alias, labels: new Map(labels) }),
  );
  return container.textContent ?? "";
}

describe("the notice for a conversation its machine will not show this server", () => {
  it("names the machine by the alias the machines list knows", async () => {
    expect(await said("m1", "old-name", [["m1", "mdi-b"]])).toContain(
      S.chat.sessionRefused("mdi-b"),
    );
  });

  it("names it as the refusal did when the list does not know it", async () => {
    expect(await said("m1", "box", [])).toContain(S.chat.sessionRefused("box"));
  });
});

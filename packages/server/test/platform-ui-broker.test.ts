/**
 * The platform UI broker: the held poll, dispatch with a deadline, page selection, and the
 * pruning that turns a closed tab into an answer instead of a hang.
 */
import { describe, expect, it } from "vitest";
import { UiPageBroker } from "../src/platform-ui/service.js";
import type { UiCommandDelivery } from "../src/platform-ui/service.js";

const register = (broker: UiPageBroker, userId = "u1", pageId = "p1"): void => {
  broker.register(userId, { pageId, route: "/chat", title: "Chat" });
};

/** The one command a poll must have delivered. */
function only(commands: readonly UiCommandDelivery[]): UiCommandDelivery {
  const command = commands[0];
  if (command === undefined || commands.length !== 1) {
    throw new Error(`expected exactly one command, got ${commands.length}`);
  }
  return command;
}

describe("UiPageBroker", () => {
  it("delivers a dispatched command on the held poll and resolves with the page's answer", async () => {
    const broker = new UiPageBroker();
    register(broker);
    const poll = broker.poll("u1", "p1", 1_000);
    const answer = broker.dispatch("u1", { name: "state" });
    const command = only(await poll);
    expect(command.name).toBe("state");
    expect(broker.answer("u1", "p1", command.id, { ok: true, value: { route: "/chat" } })).toBe(
      true,
    );
    await expect(answer).resolves.toEqual({ ok: true, value: { route: "/chat" } });
  });

  it("queues a command when no poll is held and hands it to the next one", async () => {
    const broker = new UiPageBroker();
    register(broker);
    const answer = broker.dispatch("u1", { name: "screenshot" });
    const command = only(await broker.poll("u1", "p1", 1_000));
    expect(command.name).toBe("screenshot");
    broker.answer("u1", "p1", command.id, { ok: false, error: "nope" });
    await expect(answer).resolves.toEqual({ ok: false, error: "nope" });
  });

  it("answers no_page instead of waiting when nothing is connected", async () => {
    const broker = new UiPageBroker();
    const answer = await broker.dispatch("u1", { name: "state" });
    expect(answer.ok).toBe(false);
    expect(answer.error).toContain("no_page");
  });

  it("answers page_gone when the page is pruned while a command waits", async () => {
    const broker = new UiPageBroker({ pageTtlMs: 5 });
    register(broker);
    const answer = broker.dispatch("u1", { name: "state" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The next dispatch prunes the stale page, which answers the waiting command.
    await broker.dispatch("u1", { name: "state" });
    await expect(answer).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("page_gone") as unknown as string,
    });
  });

  it("times a command out when the page never answers", async () => {
    const broker = new UiPageBroker();
    register(broker);
    const answer = await broker.dispatch("u1", { name: "state", timeoutMs: 1_000 });
    expect(answer.ok).toBe(false);
    expect(answer.error).toContain("timeout");
  });

  it("routes to the most recently seen page of the caller, never another user's", async () => {
    const broker = new UiPageBroker();
    register(broker, "u1", "first");
    register(broker, "u2", "theirs");
    await new Promise((resolve) => setTimeout(resolve, 5));
    register(broker, "u1", "second");
    const poll = broker.poll("u1", "second", 1_000);
    const answer = broker.dispatch("u1", { name: "state" });
    const command = only(await poll);
    broker.answer("u1", "second", command.id, { ok: true });
    await expect(answer).resolves.toEqual({ ok: true });

    const stranger = await broker.dispatch("u3", { name: "state" });
    expect(stranger.error).toContain("no_page");
  });

  it("refuses an answer from a page the command was not sent to", async () => {
    const broker = new UiPageBroker();
    register(broker, "u1", "p1");
    register(broker, "u1", "p2");
    const poll = broker.poll("u1", "p1", 1_000);
    const answer = broker.dispatch("u1", { name: "state", pageId: "p1" });
    const command = only(await poll);
    expect(broker.answer("u1", "p2", command.id, { ok: true })).toBe(false);
    expect(broker.answer("u1", "p1", command.id, { ok: true })).toBe(true);
    await expect(answer).resolves.toEqual({ ok: true });
  });
});

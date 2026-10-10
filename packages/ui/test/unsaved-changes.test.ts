/**
 * The unsaved-changes registry (src/components/forms/unsaved-changes/unsaved-changes.ts): which
 * forms a leave finds dirty, what a leave does when it finds one, and the unload guard.
 *
 * - A dirty form is found by its own scope and by an unscoped question, never by another scope;
 *   cleared, it is gone.
 * - A leave with nothing dirty in its scope goes at once, without asking — a dirty form in
 *   another scope does not hold it.
 * - A leave that finds a dirty form asks; on "discard" every form in the scope is reset and
 *   forgotten before the leave runs, and the forms of another scope keep their edits.
 * - On "keep editing" nothing runs and the form stays dirty.
 * - Two leaves asking at once share one prompt and one answer.
 * - With no host mounted there is nobody to ask, and the leave goes; a host that unmounts while
 *   asking answers "keep editing".
 * - `beforeunload` is held only while some form is dirty.
 * - A draft typed back to its stored value compares equal to it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  answerDiscard,
  clearUnsaved,
  confirmDiscard,
  discardUnsaved,
  guardLeave,
  hasUnsaved,
  markUnsaved,
  registerUnsavedHost,
  sameDraft,
  unsavedStore,
  watchUnload,
} from "../src/components/forms/unsaved-changes/unsaved-changes";

/** Hosts registered by a test, unregistered after it. */
const hosts: Array<() => void> = [];
const mountHost = (): void => {
  hosts.push(registerUnsavedHost());
};

/** Lets the awaited prompt answer reach `guardLeave`'s continuation. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  answerDiscard(false);
  for (const unregister of hosts.splice(0)) unregister();
  discardUnsaved();
});

describe("which forms are dirty", () => {
  it("finds a dirty form by its scope and by an unscoped question, never by another scope", () => {
    markUnsaved("settings", null);
    expect(hasUnsaved("settings")).toBe(true);
    expect(hasUnsaved()).toBe(true);
    expect(hasUnsaved("form-1")).toBe(false);
  });

  it("forgets a cleared form, and clearing it twice is harmless", () => {
    const id = markUnsaved(null, null);
    clearUnsaved(id);
    clearUnsaved(id);
    expect(hasUnsaved()).toBe(false);
  });
});

describe("a guarded leave", () => {
  it("goes at once when nothing in its scope is dirty, a dirty form elsewhere notwithstanding", async () => {
    mountHost();
    markUnsaved("page", null);
    const action = vi.fn();
    const left = guardLeave(action, "settings");
    // Synchronously: a clean leave must not wait a tick behind a prompt that is never shown.
    expect(action).toHaveBeenCalledTimes(1);
    expect(unsavedStore.getState().asking).toBe(false);
    await expect(left).resolves.toBe(true);
  });

  it("asks, and on discard resets the scope's forms before it leaves; another scope keeps its edits", async () => {
    mountHost();
    const order: string[] = [];
    markUnsaved("settings", () => order.push("reset proxy"));
    markUnsaved("settings", () => order.push("reset uploads"));
    markUnsaved("page", () => order.push("reset page"));
    const left = guardLeave(() => {
      // The navigation a leave starts must find nothing dirty, or a blocker would ask again.
      order.push(hasUnsaved("settings") ? "leave (still dirty)" : "leave");
    }, "settings");
    expect(unsavedStore.getState().asking).toBe(true);
    expect(order).toEqual([]);
    answerDiscard(true);
    await expect(left).resolves.toBe(true);
    expect(order).toEqual(["reset proxy", "reset uploads", "leave"]);
    expect(hasUnsaved("page")).toBe(true);
    expect(unsavedStore.getState().asking).toBe(false);
  });

  it("runs nothing on keep editing, and the form stays dirty", async () => {
    mountHost();
    const reset = vi.fn();
    markUnsaved("settings", reset);
    const action = vi.fn();
    const left = guardLeave(action, "settings");
    answerDiscard(false);
    await expect(left).resolves.toBe(false);
    await settle();
    expect(action).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(hasUnsaved("settings")).toBe(true);
  });

  it("shares one prompt and one answer between two leaves asking at once", async () => {
    mountHost();
    markUnsaved(null, null);
    const first = confirmDiscard();
    const second = confirmDiscard();
    expect(second).toBe(first);
    answerDiscard(true);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });

  it("goes without asking when no host is mounted to draw the prompt", async () => {
    const reset = vi.fn();
    markUnsaved(null, reset);
    const action = vi.fn();
    await expect(guardLeave(action)).resolves.toBe(true);
    expect(unsavedStore.getState().asking).toBe(false);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("is answered keep editing when the last host unmounts while it asks", async () => {
    const unregister = registerUnsavedHost();
    markUnsaved(null, null);
    const action = vi.fn();
    const left = guardLeave(action);
    unregister();
    await expect(left).resolves.toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect(unsavedStore.getState().asking).toBe(false);
  });
});

describe("the unload guard", () => {
  const unload = (target: EventTarget): boolean => {
    const event = new Event("beforeunload", { cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it("holds beforeunload only while some form is dirty", () => {
    const target = new EventTarget();
    const stop = watchUnload(target);
    expect(unload(target)).toBe(false);
    const id = markUnsaved("settings", null);
    expect(unload(target)).toBe(true);
    clearUnsaved(id);
    expect(unload(target)).toBe(false);
    markUnsaved(null, null);
    stop();
    expect(unload(target)).toBe(false);
  });
});

describe("comparing a draft with its baseline", () => {
  it("is equal once the stored value is typed back, structure for structure", () => {
    expect(sameDraft({ url: "http://a", n: ["1", "2"] }, { url: "http://a", n: ["1", "2"] })).toBe(
      true,
    );
    expect(sameDraft({ url: "http://a" }, { url: "http://b" })).toBe(false);
    expect(sameDraft({ a: undefined }, {})).toBe(true);
    expect(sameDraft(["1"], ["1", "2"])).toBe(false);
    expect(sameDraft(new Set(["x"]), new Set(["x"]))).toBe(true);
    expect(sameDraft(Number.NaN, Number.NaN)).toBe(true);
  });
});

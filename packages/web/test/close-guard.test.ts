/**
 * The dock's close guards (features/dock/close-guard.ts): a tab body holding unsaved work
 * registers a veto under its tab key, and a close of several tabs stops at the first veto —
 * a user who keeps one panel open is not asked about the next.
 */
import { describe, expect, it, vi } from "vitest";
import { confirmClose, setCloseGuard } from "../src/features/dock/close-guard";

describe("confirmClose", () => {
  it("closes unguarded tabs at once", async () => {
    await expect(confirmClose(["memory", "trace"])).resolves.toBe(true);
    await expect(confirmClose([])).resolves.toBe(true);
  });

  it("asks a registered guard and stops at the first veto", async () => {
    const veto = vi.fn(async () => false);
    const allow = vi.fn(async () => true);
    setCloseGuard("guard-a", veto);
    setCloseGuard("guard-b", allow);
    await expect(confirmClose(["guard-a", "guard-b"])).resolves.toBe(false);
    expect(veto).toHaveBeenCalledTimes(1);
    expect(allow).not.toHaveBeenCalled();
    await expect(confirmClose(["guard-b", "guard-a"])).resolves.toBe(false);
    expect(allow).toHaveBeenCalledTimes(1);
    setCloseGuard("guard-a", null);
    setCloseGuard("guard-b", null);
  });

  it("forgets a withdrawn guard", async () => {
    const veto = vi.fn(async () => false);
    setCloseGuard("guard-c", veto);
    setCloseGuard("guard-c", null);
    await expect(confirmClose(["guard-c"])).resolves.toBe(true);
    expect(veto).not.toHaveBeenCalled();
  });
});

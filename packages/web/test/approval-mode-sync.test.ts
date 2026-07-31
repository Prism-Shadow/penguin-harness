import { describe, expect, it } from "vitest";
import { ApprovalModeSyncGuard } from "../src/state/approval-mode-sync";

describe("ApprovalModeSyncGuard", () => {
  it("invalidates an older read when an SSE update arrives", () => {
    const guard = new ApprovalModeSyncGuard();
    const read = guard.beginRead();
    guard.noteServerEvent();
    expect(guard.isCurrent(read)).toBe(false);
  });

  it("only accepts the latest read while refreshes overlap", () => {
    const guard = new ApprovalModeSyncGuard();
    const initial = guard.beginRead();
    const reconnect = guard.beginRead();
    expect(guard.isCurrent(initial)).toBe(false);
    expect(guard.isCurrent(reconnect)).toBe(true);
  });

  it("only accepts the latest write while requests overlap", () => {
    const guard = new ApprovalModeSyncGuard();
    const first = guard.beginWrite();
    const second = guard.beginWrite();
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it("accepts a resync read unless a newer server event arrives", () => {
    const guard = new ApprovalModeSyncGuard();
    guard.noteServerEvent();
    const refresh = guard.beginRead();
    expect(guard.isCurrent(refresh)).toBe(true);
    guard.noteServerEvent();
    expect(guard.isCurrent(refresh)).toBe(false);
  });
});

/**
 * Given a cancelled child awaiting cleanup, reading the live list, looking it up, or
 * updating approval forwarding must hide it without releasing cleanup ownership.
 * Repeated cancellation and disposal still wait for its final writes and release once.
 * The same guarantee holds before and after background registration.
 */
import { describe, expect, it } from "vitest";
import { userText } from "@prismshadow/amsp/records";
import {
  ManagedSubagentSession,
  SubagentSessionManager,
} from "../src/environment/tools/subagent/index.js";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("cancelled child cleanup ownership", () => {
  it.each(["list", "lookup", "approval", "registered"] as const)(
    "disposal waits after %s access hides a cancelled child",
    async (access) => {
      const cleanup = gate();
      const interrupted = gate();
      let releases = 0;
      const child = new ManagedSubagentSession({
        sessionId: "session-cleanup-child",
        // eslint-disable-next-line require-yield
        async *run({ signal }) {
          await new Promise<void>((resolve) => {
            if (signal?.aborted) resolve();
            else signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          interrupted.resolve();
          await cleanup.promise;
          return null;
        },
        dispose() {
          releases += 1;
        },
      });
      const manager = new SubagentSessionManager();
      manager.track(child);
      child.startRun([userText("work")]);
      if (access === "registered") manager.register(child);
      child.kill();
      await interrupted.promise;
      if (access === "lookup") expect(manager.bySessionId(child.sessionId)).toBeUndefined();
      if (access === "approval") manager.setApprovalFallback(async () => "deny");
      expect(manager.listLive()).toEqual([]);
      child.kill();
      let settled = false;
      const disposal = Promise.resolve(manager.dispose()).then(() => {
        settled = true;
      });
      const repeated = manager.dispose();
      try {
        // Flush promise reactions without advancing the child cleanup gate.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(child.running).toBe(true);
        expect(settled).toBe(false);
        expect(releases).toBe(0);
      } finally {
        cleanup.resolve();
        await Promise.all([disposal, repeated, child.whenSettled()]);
      }
      expect(child.running).toBe(false);
      expect(releases).toBe(1);
    },
  );
});

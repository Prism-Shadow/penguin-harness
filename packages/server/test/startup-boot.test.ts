/**
 * The platform's startup step (src/platform.ts `Startup`) and the schedulers' first passes.
 *
 * A first pass can fire a missed slot, and a fire can reach the network before it is queued (a
 * model's credential refresh): the boot must not wait on it, so the port is announced and local
 * pages are served first.
 *
 * - Given both schedulers' first passes held, the startup step completes, and both passes have
 *   been started.
 * - Given a first pass that fails, the failure is recorded and the boot is untouched.
 */
import { describe, expect, it, vi } from "vitest";
import { wire } from "@prismshadow/penguin-core/kernel";
import { Startup } from "../src/platform.js";
import type { ErrorRecordArgs } from "../src/runtime/error-recorder.js";

/** The startup step over doubles: each scheduler's first pass is what `pass` returns. */
function startup(pass: () => Promise<void>) {
  const errors: ErrorRecordArgs[] = [];
  const scheduler = { start: vi.fn(pass) };
  const orgScheduler = { start: vi.fn(pass) };
  const step = wire(Startup, {
    scheduler,
    orgScheduler,
    sessionService: { adoptUnmanagedTraceSessions: async () => {} },
    machines: { start: async () => {} },
    errors: { record: (args: ErrorRecordArgs) => void errors.push(args) },
    projectConfig: { migrateStoredConfigs: async () => {} },
    agents: { resumeDeletions: async () => {} },
  });
  return { step, scheduler, orgScheduler, errors };
}

describe("the startup step", () => {
  it("completes while the schedulers' first passes are still running", async () => {
    const { step, scheduler, orgScheduler } = startup(() => new Promise<void>(() => {}));
    await step.setup();
    expect(scheduler.start).toHaveBeenCalledOnce();
    expect(orgScheduler.start).toHaveBeenCalledOnce();
  });

  it("records a first pass that fails", async () => {
    const { step, errors } = startup(async () => {
      throw new Error("credential refresh failed");
    });
    await step.setup();
    await vi.waitFor(() =>
      expect(errors.map((e) => e.code).sort()).toEqual([
        "org_scheduler_start_failed",
        "scheduler_start_failed",
      ]),
    );
  });
});

/**
 * Process-lifecycle behavior tests for WakeSignal.
 */
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("WakeSignal", () => {
  it("keeps a standalone process alive while wait() is pending without leaving timers behind", () => {
    const moduleUrl = new URL("../src/environment/tools/background/wake-signal.ts", import.meta.url)
      .href;
    const script = `
      const { WakeSignal } = await import(${JSON.stringify(moduleUrl)});

      await new WakeSignal().wait(50);
      process.stdout.write("timeout\\n");

      const signal = new WakeSignal();
      setTimeout(() => signal.notify(), 10);
      await signal.wait(60_000);
      process.stdout.write("notified\\n");
    `;

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      { encoding: "utf8", timeout: 3_000 },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("timeout\nnotified\n");
  });
});

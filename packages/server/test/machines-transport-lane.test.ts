/**
 * One thing at a time per machine, by structure: two commands to the same machine run one
 * after the other, two to different machines together. Measured with a child that only
 * sleeps: the lane never looks at what it runs, so the child is Node itself rather than a
 * stub `ssh` — a shell-script stub cannot be executed without a shell on Windows, and the
 * lane is the same code there.
 */
import { describe, expect, it } from "vitest";
import { run } from "../src/machines/transport/exec.js";
import { inLane } from "../src/machines/transport/lane.js";

describe("the per-machine lane", () => {
  it("serialises commands to one machine and lets different machines proceed together", async () => {
    const sleep = (address: string) =>
      inLane(address, () => run(process.execPath, ["-e", "setTimeout(() => {}, 200)"]));
    // Warm the child's start-up, so the bounds below measure the lane rather than a cold
    // Node on a slow runner.
    await sleep("ssh:warm-up");

    let started = Date.now();
    await Promise.all([sleep("ssh:nas"), sleep("ssh:nas")]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(380);

    started = Date.now();
    await Promise.all([sleep("ssh:nas"), sleep("ssh:build-box")]);
    const together = Date.now() - started;
    started = Date.now();
    await sleep("ssh:nas");
    const alone = Date.now() - started;
    // Together means one child's time plus scheduling noise, not two children's time.
    expect(together).toBeLessThan(alone + 180);
  });

  it("a failure does not stall the lane behind it", async () => {
    await expect(
      inLane("ssh:nas", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await inLane("ssh:nas", async () => "next")).toBe("next");
  });
});

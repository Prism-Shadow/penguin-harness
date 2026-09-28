/**
 * One thing at a time per machine, by structure: two pieces of work for the same machine run
 * one after the other, two for different machines together.
 */
import { describe, expect, it } from "vitest";
import { inLane } from "../src/machines/transport/lane.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("the per-machine lane", () => {
  it("serialises work for one machine and lets different machines proceed together", async () => {
    const work = (address: string) => inLane(address, () => sleep(200));
    let started = Date.now();
    await Promise.all([work("ssh:nas"), work("ssh:nas")]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(380);

    started = Date.now();
    await Promise.all([work("ssh:nas"), work("ssh:build-box")]);
    expect(Date.now() - started).toBeLessThan(380);
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

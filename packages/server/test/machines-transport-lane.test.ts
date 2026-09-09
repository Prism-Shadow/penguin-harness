/**
 * One thing at a time per machine, by structure: two commands to the same machine run one
 * after the other, two to different machines together. Measured against a stub `ssh` on
 * PATH that only sleeps.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/machines/transport/exec.js";
import { inLane } from "../src/machines/transport/lane.js";

const posixOnly = process.platform === "win32" ? describe.skip : describe;

posixOnly("the per-machine lane", () => {
  let stubBin: string;
  let originalPath: string | undefined;
  beforeEach(() => {
    stubBin = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-lane-"));
    fs.writeFileSync(path.join(stubBin, "ssh"), "#!/bin/sh\nsleep 0.2\n");
    fs.chmodSync(path.join(stubBin, "ssh"), 0o755);
    originalPath = process.env.PATH;
    process.env.PATH = `${stubBin}:${process.env.PATH ?? ""}`;
  });
  afterEach(() => {
    process.env.PATH = originalPath;
    fs.rmSync(stubBin, { recursive: true, force: true });
  });

  it("serialises commands to one machine and lets different machines proceed together", async () => {
    const ssh = (address: string) => inLane(address, () => run("ssh", ["host", "true"]));
    let started = Date.now();
    await Promise.all([ssh("ssh:nas"), ssh("ssh:nas")]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(380);

    started = Date.now();
    await Promise.all([ssh("ssh:nas"), ssh("ssh:build-box")]);
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

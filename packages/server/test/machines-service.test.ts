/**
 * The machines list as a picker feed: nothing but the ssh config's text and the state
 * file — no `ssh -G`, no processes (a config can declare hundreds of hosts; resolution
 * happens per-connect, not per-list) — ordered live-first, then by connect recency, then
 * config order.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MachinesService } from "../src/machines/service.js";
import { withMachineState } from "../src/machines/state.js";

describe("MachinesService.list", () => {
  let work: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-machines-service-"));
    originalHome = process.env.HOME;
    process.env.HOME = path.join(work, "home");
    fs.mkdirSync(path.join(process.env.HOME, ".ssh"), { recursive: true });
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(work, { recursive: true, force: true });
  });

  it("orders recently connected machines first, the rest in config order", async () => {
    fs.writeFileSync(
      path.join(process.env.HOME!, ".ssh", "config"),
      ["Host alpha", "Host beta", "Host gamma", "Host delta"].join("\n"),
    );
    // beta connected long ago, gamma recently; neither has a live tunnel pid, so no
    // process or HTTP probe happens — dead entries answer instantly.
    let state = withMachineState(null, "beta", {
      port: 7381,
      lastConnectedAt: "2026-08-01T00:00:00.000Z",
    });
    state = withMachineState(state, "gamma", {
      port: 7382,
      lastConnectedAt: "2026-08-16T00:00:00.000Z",
    });
    fs.writeFileSync(path.join(work, "machines-state.json"), state);

    const list = await new MachinesService(work).list();
    expect(list.map((m) => m.alias)).toEqual(["gamma", "beta", "alpha", "delta"]);
    expect(list[0]).toEqual({ id: "ssh:gamma", alias: "gamma", origin: null });
  });

  it("an edited config shows up on the next list — no restart, no cache", async () => {
    const config = path.join(process.env.HOME!, ".ssh", "config");
    fs.writeFileSync(config, "Host one\n");
    const service = new MachinesService(work);
    expect((await service.list()).map((m) => m.alias)).toEqual(["one"]);
    fs.writeFileSync(config, "Host one\nHost two\n");
    expect((await service.list()).map((m) => m.alias)).toEqual(["one", "two"]);
  });
});

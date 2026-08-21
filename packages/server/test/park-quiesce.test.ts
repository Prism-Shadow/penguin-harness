/**
 * The park contract across a hot swap (hmr/platform.ts's inventory): DELIVERED resources
 * reach the successor intact, SUSPENDED work actually stops, and the process is clean in
 * between — the successor's create() awaits the predecessor's registered drain before it
 * builds anything. Driven over a bare-kernel registry (the packaged platform boots
 * terminals-only there), with fake ptys standing in for delivered resources.
 */
import { describe, expect, it, vi } from "vitest";
import { boot, initialDoc, upgrade } from "@prismshadow/penguin-core/kernel";
import { HotResources } from "../src/hmr/resources.js";
import { packagedPlatform } from "../src/hmr/platform.js";
import type { PlatformApi } from "../src/hmr/platform.js";
import type { Instance } from "@prismshadow/penguin-core/kernel";
import { BARE_KERNEL_RESOURCE_ID, PLATFORM_DRAIN_RESOURCE_ID } from "../src/hmr/capabilities.js";
import { TerminalManager } from "../src/terminal/manager.js";
import type { TerminalSession } from "../src/terminal/session.js";
import { waitFor } from "./helpers.js";

/** A pty stand-in carrying exactly what the manager touches: id, alive, onExit, dispose. */
function fakePty(id: string) {
  const listeners = new Set<(info: unknown) => void>();
  return {
    id,
    ownerUserId: "u",
    alive: true,
    disposed: 0,
    onExit(listener: (info: unknown) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      this.alive = false;
      this.disposed++;
    },
    exit() {
      this.alive = false;
      for (const listener of [...listeners]) listener({ exitCode: 0 });
    },
    listenerCount: () => listeners.size,
  };
}

const asSession = (fake: ReturnType<typeof fakePty>): TerminalSession =>
  fake as unknown as TerminalSession;

function bareKernel(): HotResources {
  const r = new HotResources();
  r.register(BARE_KERNEL_RESOURCE_ID, true);
  return r;
}

async function quietBoot(r: HotResources, doc = packagedPlatform.context) {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    return (await boot(
      packagedPlatform.impl,
      packagedPlatform.iface,
      initialDoc(packagedPlatform.iface, doc),
      r,
    )) as Instance<PlatformApi>;
  } finally {
    warn.mockRestore();
  }
}

describe("the drain handshake", () => {
  it("a successor's boot waits for the predecessor's drain before building", async () => {
    const r = bareKernel();
    let resolveDrain!: () => void;
    r.register(
      PLATFORM_DRAIN_RESOURCE_ID,
      new Promise<void>((resolve) => (resolveDrain = resolve)),
    );
    let booted = false;
    const bootP = quietBoot(r).then((inst) => {
      booted = true;
      return inst;
    });
    // Give create() every chance to run ahead: it must be parked on the drain.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(booted).toBe(false);
    // Still registered while unsettled: released only after it resolves, so a boot
    // that fails past this point leaves the settled drain claimable by the host's
    // recovery boot of the previous version.
    expect(r.claim(PLATFORM_DRAIN_RESOURCE_ID)).toBeDefined();
    resolveDrain();
    const inst = await bootP;
    expect(booted).toBe(true);
    // Consumed now that the successor is up.
    expect(r.claim(PLATFORM_DRAIN_RESOURCE_ID)).toBeUndefined();
    inst.dispose();
  });

  it("a real swap: the drain is consumed, and only the successor listens to a delivered pty", async () => {
    const r = bareKernel();
    const instA = await quietBoot(r);
    const pty = fakePty("t1");
    r.register("terminal:t1", asSession(pty));
    instA.api.terminals().adopt(["t1"]);
    expect(pty.listenerCount()).toBe(1);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await upgrade({
      current: instA,
      impl: packagedPlatform.impl,
      iface: packagedPlatform.iface,
      resources: r,
    });
    warn.mockRestore();
    expect(result.status).toBe("ok");
    // A registered its drain on dispose; B consumed it during create.
    expect(r.claim(PLATFORM_DRAIN_RESOURCE_ID)).toBeUndefined();
    // A detached (quiesce), B adopted and re-listened: exactly one listener, B's.
    expect(pty.listenerCount()).toBe(1);
    if (result.status === "ok") result.instance.dispose();
  });
});

describe("upgrade boot failure", () => {
  it("returns status failed with the parked doc instead of throwing", async () => {
    const r = bareKernel();
    const instA = await quietBoot(r);
    const boom = {
      create() {
        throw new Error("boom: create failed");
      },
    };
    const result = await upgrade({
      current: instA,
      impl: boom as never,
      iface: packagedPlatform.iface,
      resources: r,
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(String(result.error)).toMatch(/boom/);
      // The parked doc is intact — the caller re-boots the previous impl from it.
      const rebooted = (await boot(
        packagedPlatform.impl,
        packagedPlatform.iface,
        result.doc as never,
        r,
      )) as Instance<PlatformApi>;
      expect(rebooted.api.info()).toMatchObject({ impl: "packaged" });
      rebooted.dispose();
    }
  });
});

describe("TerminalManager quiesce", () => {
  it("runs pending reaps now instead of leaving timers to fire from a dead generation", () => {
    const r = new HotResources();
    const manager = new TerminalManager(r, 10_000);
    const pty = fakePty("t1");
    r.register("terminal:t1", asSession(pty));
    manager.adopt(["t1"]);
    pty.exit(); // schedules a reap 10s out
    manager.quiesce();
    expect(pty.disposed).toBeGreaterThan(0); // reaped immediately…
    expect(r.claim("terminal:t1")).toBeUndefined(); // …and released from the registry
    expect(pty.listenerCount()).toBe(0); // detached from everything still alive
  });

  it("adopt reaps a pty that died during the swap freeze (its exit fired into the old generation)", async () => {
    const r = new HotResources();
    const manager = new TerminalManager(r, 5);
    const pty = fakePty("t1");
    pty.alive = false; // died before this manager ever listened
    r.register("terminal:t1", asSession(pty));
    manager.adopt(["t1"]);
    await waitFor(() => r.claim("terminal:t1") === undefined);
    expect(pty.disposed).toBeGreaterThan(0);
  });
});

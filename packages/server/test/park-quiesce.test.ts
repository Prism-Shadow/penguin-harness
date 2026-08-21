/**
 * The park contract across a hot swap (hmr/platform.ts's inventory): DELIVERED resources
 * reach the successor intact, SUSPENDED work actually stops, and the process is clean in
 * between — the successor's create() awaits the drain the predecessor left on the
 * current-App pointer before it
 * builds anything. Driven over a bare-kernel registry (the packaged platform boots
 * terminals-only there), with fake ptys standing in for delivered resources.
 */
import { describe, expect, it, vi } from "vitest";
import { boot, initialDoc, upgrade } from "@prismshadow/penguin-core/kernel";
import { HotResources } from "../src/hmr/resources.js";
import { packagedPlatform } from "../src/hmr/platform.js";
import type { PlatformApi } from "../src/hmr/platform.js";
import type { Instance } from "@prismshadow/penguin-core/kernel";
import { BARE_KERNEL_RESOURCE_ID, PLATFORM_CURRENT_RESOURCE_ID } from "../src/hmr/capabilities.js";
import type { PlatformCurrent } from "../src/hmr/capabilities.js";
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
  it("a successor's boot waits for the drain on the predecessor's pointer before building", async () => {
    const r = bareKernel();
    let resolveDrain!: () => void;
    // What a disposing predecessor leaves behind: its pointer, drain attached.
    const stale = {
      deps: null,
      app: { fetch: () => new Response(null) },
      drained: new Promise<void>((resolve) => (resolveDrain = resolve)),
    } satisfies PlatformCurrent;
    r.register(PLATFORM_CURRENT_RESOURCE_ID, stale);
    let booted = false;
    const bootP = quietBoot(r).then((inst) => {
      booted = true;
      return inst;
    });
    // Give create() every chance to run ahead: it must be parked on the drain.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(booted).toBe(false);
    // Still the stale pointer while draining: takeover happens by overwrite, never
    // by a release the dead generation could mis-aim.
    expect(r.claim(PLATFORM_CURRENT_RESOURCE_ID)).toBe(stale);
    resolveDrain();
    const inst = await bootP;
    expect(booted).toBe(true);
    // Overwritten by the successor's own registration.
    const current = r.claim<PlatformCurrent>(PLATFORM_CURRENT_RESOURCE_ID);
    expect(current).not.toBe(stale);
    expect(current?.drained).toBeUndefined();
    inst.dispose();
  });

  it("a real swap: the pointer is taken over, and only the successor listens to a delivered pty", async () => {
    const r = bareKernel();
    const instA = await quietBoot(r);
    const before = r.claim<PlatformCurrent>(PLATFORM_CURRENT_RESOURCE_ID);
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
    // A's dispose left its drain on its own pointer; B awaited it and overwrote.
    expect(before?.drained).toBeDefined();
    const after = r.claim<PlatformCurrent>(PLATFORM_CURRENT_RESOURCE_ID);
    expect(after).not.toBe(before);
    expect(after?.drained).toBeUndefined();
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

describe("the current-App pointer is never touched by a dead generation", () => {
  it("a stale generation's dispose leaves the successor's pointer in place", async () => {
    // Two live Apps over one registry — the shape where any release() in dispose would
    // be a dead generation deleting the successor's registration. There is no release
    // any more: dispose only annotates its OWN object (drained); takeover is by claim +
    // overwrite, so the elder's dispose cannot affect the younger's slot at all.
    const r = bareKernel();
    const instA = await quietBoot(r);
    const instB = await quietBoot(r); // overwrites A's pointer with B's
    const current = r.claim<PlatformCurrent>(PLATFORM_CURRENT_RESOURCE_ID);
    expect(current).toBeDefined();

    instA.dispose();
    expect(r.claim(PLATFORM_CURRENT_RESOURCE_ID)).toBe(current);
    expect(current?.drained).toBeUndefined(); // A annotated its own object, not B's

    instB.dispose(); // the last generation leaves its pointer, drain attached, for
    // whoever comes next — process exit sweeps the registry regardless
    expect(r.claim(PLATFORM_CURRENT_RESOURCE_ID)).toBe(current);
    expect(current?.drained).toBeDefined();
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

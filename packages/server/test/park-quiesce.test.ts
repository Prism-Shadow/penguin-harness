/**
 * The park contract across a hot swap (hmr/platform.ts's inventory): DELIVERED resources
 * reach the successor intact, SUSPENDED work actually stops, and the process is clean in
 * between — the KERNEL awaits the disposed App's `drained` tail before booting the
 * successor, so a new App never races the old one's aborted work — and it
 * builds anything. Driven over a bare-kernel registry (the packaged platform boots
 * terminals-only there), with fake ptys standing in for delivered resources.
 */
import { describe, expect, it, vi } from "vitest";
import { boot, initialDoc, upgrade } from "@prismshadow/penguin-core/kernel";
import { HotResources } from "../src/hmr/resources.js";
import { packagedPlatform } from "../src/hmr/platform.js";
import type { PlatformApi } from "../src/hmr/platform.js";
import type { Instance } from "@prismshadow/penguin-core/kernel";
import { PENGUIN_FAMILY, RUNTIME_INTERFACES_RESOURCE_ID } from "../src/hmr/capabilities.js";
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
  // The bare-kernel declaration IS an interface descriptor: right family, no
  // capabilities offered — "there is no business runtime behind me".
  r.register(RUNTIME_INTERFACES_RESOURCE_ID, { family: PENGUIN_FAMILY });
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
  it("upgrade() awaits the disposed App's drained tail before booting the successor", async () => {
    // Kernel-level: a toy impl whose dispose effect leaves a controllable drain. The
    // successor's create must not run until it settles — that IS the handover, with no
    // registry id involved.
    const anySchema = {
      strictParse: (doc: unknown) => ({ ok: true, value: doc ?? {} }),
      describe: () => ({ kind: "any" }),
    };
    const iface = {
      kind: "iface",
      name: "t",
      version: 1,
      context: anySchema,
      methods: ["park"],
      children: {},
      migrations: {},
    };
    let resolveDrain!: () => void;
    const implA = {
      create(ctx: { effect: (d: () => void) => void }) {
        let drained: Promise<void> | undefined;
        ctx.effect(() => {
          drained = new Promise<void>((resolve) => (resolveDrain = resolve));
        });
        return { park: () => ({}), drained: () => drained };
      },
    };
    let successorBooted = false;
    const implB = {
      create() {
        successorBooted = true;
        return { park: () => ({}) };
      },
    };
    const r = new HotResources();
    const instA = await boot(implA as never, iface as never, initialDoc(iface as never, {}), r);
    const upgradeP = upgrade({
      current: instA,
      impl: implB as never,
      iface: iface as never,
      resources: r,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(successorBooted).toBe(false); // parked on the drain, after dispose
    resolveDrain();
    const result = await upgradeP;
    expect(result.status).toBe("ok");
    expect(successorBooted).toBe(true);
    if (result.status === "ok") result.instance.dispose();
  });

  it("a real swap: only the successor listens to a delivered pty", async () => {
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
    const manager = new TerminalManager(r, { graceMs: 10_000 });
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
    const manager = new TerminalManager(r, { graceMs: 5 });
    const pty = fakePty("t1");
    pty.alive = false; // died before this manager ever listened
    r.register("terminal:t1", asSession(pty));
    manager.adopt(["t1"]);
    await waitFor(() => r.claim("terminal:t1") === undefined);
    expect(pty.disposed).toBeGreaterThan(0);
  });
});

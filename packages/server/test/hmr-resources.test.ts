/**
 * Resource-interface reconciliation across a swap — a registry convention, not a kernel
 * mechanism: each App's create() leaves its declaration (RESOURCE_IFACES_RESOURCE_ID)
 * for its successor, which integrates a group only at the same version and hard-stops
 * the rest, in reverse registration order, before adopting anything. Plus the registry's
 * ordering contract and the runtime-capability version handshake (hmr/capabilities.ts).
 */
import { describe, expect, it, vi } from "vitest";
import { boot, initialDoc, upgrade } from "@prismshadow/penguin-core/kernel";
import { HotResources } from "../src/hmr/resources.js";
import { TerminalManager } from "../src/terminal/manager.js";
import type { TerminalSession } from "../src/terminal/session.js";
import { DECLARED_RESOURCES as PARKED, packagedPlatform } from "../src/hmr/platform.js";
import {
  BARE_KERNEL_RESOURCE_ID,
  RESOURCE_IFACES_RESOURCE_ID,
  RUNTIME_AUTH_RESOURCE_ID,
  PENGUIN_FAMILY,
  RUNTIME_INTERFACES,
  RUNTIME_INTERFACES_RESOURCE_ID,
  RUNTIME_CHANNELS_RESOURCE_ID,
  RUNTIME_CONFIG_RESOURCE_ID,
  RUNTIME_DB_RESOURCE_ID,
  RUNTIME_HMR_RESOURCE_ID,
  RUNTIME_PROXY_RESOURCE_ID,
  claimRuntimeCapabilities,
} from "../src/hmr/capabilities.js";

/**
 * Boots the packaged platform against `r` as a BARE KERNEL: capability-less, terminals-only,
 * quiet. The marker is what makes that legal — without it the boot is refused, which is the
 * rule the last test in this file drives.
 */
async function bootPlatform(r: HotResources) {
  r.register(BARE_KERNEL_RESOURCE_ID, true);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    return await boot(
      packagedPlatform.impl,
      packagedPlatform.iface,
      initialDoc(packagedPlatform.iface, packagedPlatform.context),
      r,
    );
  } finally {
    warn.mockRestore();
  }
}

describe("HotResources ordering", () => {
  it("disposeGroup kills only the group, newest first", () => {
    const r = new HotResources();
    const order: string[] = [];
    r.register("spawn:a", 1, () => order.push("a"));
    r.register("other:x", 2, () => order.push("x"));
    r.register("spawn:b", 3, () => order.push("b"));
    r.disposeGroup("spawn");
    expect(order).toEqual(["b", "a"]);
    expect(r.claim("spawn:a")).toBeUndefined();
    expect(r.claim("other:x")).toBe(2);
    // A throwing disposer must not strand the rest of the group.
    r.register("spawn:c", 4, () => {
      throw new Error("boom");
    });
    r.register("spawn:d", 5, () => order.push("d"));
    r.disposeGroup("spawn");
    expect(order).toEqual(["b", "a", "d"]);
    expect(r.claim("spawn:c")).toBeUndefined();
  });

  it("disposeAll runs newest first", () => {
    const r = new HotResources();
    const order: string[] = [];
    r.register("a", 1, () => order.push("a"));
    r.register("b", 2, () => order.push("b"));
    r.disposeAll();
    expect(order).toEqual(["b", "a"]);
  });

  it("a re-registered id counts as the NEWEST, not as its first registration", () => {
    // Map.set on an existing key keeps its original insertion position, so without a
    // delete-before-set the sweeps would dispose a re-registered entry (a successor
    // adopting a pty, say) in its previous owner's slot — while both sweeps promise
    // reverse REGISTRATION order, which later-depends-on-earlier relies on.
    const r = new HotResources();
    const order: string[] = [];
    r.register("a", 1, () => order.push("a-old"));
    r.register("b", 2, () => order.push("b"));
    r.register("a", 3, () => order.push("a-new"));
    r.disposeAll();
    expect(order).toEqual(["a-new", "b"]);
  });

  it("the same holds inside a group", () => {
    const r = new HotResources();
    const order: string[] = [];
    r.register("terminal:1", 1, () => order.push("1-old"));
    r.register("terminal:2", 2, () => order.push("2"));
    r.register("terminal:1", 3, () => order.push("1-new"));
    r.disposeGroup("terminal");
    expect(order).toEqual(["1-new", "2"]);
  });
});

describe("resource-interface reconciliation at create()", () => {
  it("a group whose declaration offers every member this build names rides across", async () => {
    const r = new HotResources();
    const dispose = vi.fn();
    r.register(RESOURCE_IFACES_RESOURCE_ID, PARKED);
    r.register("terminal:pty1", "live", dispose);
    const inst = await bootPlatform(r);
    try {
      expect(dispose).not.toHaveBeenCalled();
      expect(r.claim("terminal:pty1")).toBe("live");
    } finally {
      inst.dispose();
    }
  });

  it("a predecessor missing a member this build names hard-stops the group", async () => {
    const r = new HotResources();
    const dispose = vi.fn();
    r.register(RESOURCE_IFACES_RESOURCE_ID, {
      family: PENGUIN_FAMILY,
      terminal: ["id"],
      platform: PARKED.platform,
    });
    r.register("terminal:pty1", "live", dispose);
    const inst = await bootPlatform(r);
    try {
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(r.claim("terminal:pty1")).toBeUndefined();
      // …and the declaration is overwritten with this build's, for the NEXT App.
      expect(r.claim(RESOURCE_IFACES_RESOURCE_ID)).toEqual(PARKED);
    } finally {
      inst.dispose();
    }
  });

  it("a group this build stops declaring is disposed — unused resources must not leak", async () => {
    const r = new HotResources();
    const dispose = vi.fn();
    // Everything this build still declares is offered in full; only `sandbox` is extra.
    r.register(RESOURCE_IFACES_RESOURCE_ID, { ...PARKED, sandbox: ["start"] });
    const keep = vi.fn();
    r.register("terminal:pty1", "live", keep);
    r.register("sandbox:provider", "live", dispose);
    const inst = await bootPlatform(r);
    try {
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(r.claim("sandbox:provider")).toBeUndefined();
      // …and the groups this build DOES declare are untouched.
      expect(keep).not.toHaveBeenCalled();
      expect(r.claim("terminal:pty1")).toBe("live");
    } finally {
      inst.dispose();
    }
  });

  it("a predecessor of a different family is not inherited from at all — nothing rides across", async () => {
    const r = new HotResources();
    const dispose = vi.fn();
    // Same group name, same version, different vocabulary: `terminal` means something
    // else over there, so this build must not adopt those handles.
    r.register(RESOURCE_IFACES_RESOURCE_ID, { ...PARKED, family: "acme" });
    r.register("terminal:pty1", "live", dispose);
    const inst = await bootPlatform(r);
    try {
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(r.claim("terminal:pty1")).toBeUndefined();
    } finally {
      inst.dispose();
    }
  });

  it("a predecessor from before the declaration existed disposes nothing (pre-declaration behavior)", async () => {
    const r = new HotResources();
    const dispose = vi.fn();
    r.register("terminal:pty1", "live", dispose);
    const inst = await bootPlatform(r);
    try {
      expect(dispose).not.toHaveBeenCalled();
      expect(r.claim("terminal:pty1")).toBe("live");
    } finally {
      inst.dispose();
    }
  });

  it("the declaration outlives its App to inform the successor", async () => {
    const r = new HotResources();
    const inst = await bootPlatform(r);
    inst.dispose();
    expect(r.claim(RESOURCE_IFACES_RESOURCE_ID)).toEqual(PARKED);
  });

  it("rides a real kernel swap: same declaration on both sides keeps the group", async () => {
    const r = new HotResources();
    const inst = await bootPlatform(r);
    const dispose = vi.fn();
    r.register("terminal:pty1", "live", dispose);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await upgrade({
      current: inst,
      impl: packagedPlatform.impl,
      iface: packagedPlatform.iface,
      resources: r,
    });
    warn.mockRestore();
    expect(result.status).toBe("ok");
    expect(dispose).not.toHaveBeenCalled();
    expect(r.claim("terminal:pty1")).toBe("live");
    if (result.status === "ok") result.instance.dispose();
  });
});

describe("the parked-pty declaration", () => {
  it("covers every member adoption reaches — a shorter list would TypeError after a swap", () => {
    // The descriptor is the PROOF that adopting a predecessor's pty is safe, so it has to
    // name everything the adopters touch. This drives the real adoption path against a
    // session that answers ONLY the declared members and throws on anything else: shorten
    // DECLARED_RESOURCES.terminal and this test names the member that would have blown up
    // on the first keystroke after a push.
    const declared = new Set<string>(PARKED.terminal);
    const stub: Record<string, unknown> = {
      id: "t1",
      seq: 1,
      ownerUserId: "u1",
      alive: true,
      exit: null,
      info: () => ({ id: "t1", name: "sh" }),
      rename: () => undefined,
      capture: () => ({ lines: [] }),
      write: () => undefined,
      resize: () => undefined,
      releaseSize: () => undefined,
      restoreStream: () => "",
      onOutput: () => () => undefined,
      onExit: () => () => undefined,
      kill: () => undefined,
      dispose: () => undefined,
    };
    const strict = new Proxy(stub, {
      get(target, prop, receiver) {
        // Symbols and promise-probing are the runtime's own business, not the contract's.
        if (typeof prop === "string" && prop !== "then" && !declared.has(prop)) {
          throw new Error(`adoption reached an undeclared member: ${prop}`);
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    }) as unknown as TerminalSession;

    const r = new HotResources();
    r.register("terminal:t1", strict);
    const manager = new TerminalManager(r);
    manager.adopt(["t1"]);
    // What a fresh App does with an adopted pty right away.
    expect(manager.handleIds()).toEqual(["t1"]);
    expect(manager.list("u1").map((s) => s.id)).toEqual(["t1"]);
    expect(manager.require("t1", "u1")).toBe(strict);
  });
});

describe("runtime capability handshake", () => {
  /** Live objects that actually carry the members RUNTIME_INTERFACES names. */
  function stubCaps(r: HotResources): void {
    const carrying = (name: string): Record<string, unknown> => {
      const need = RUNTIME_INTERFACES[name];
      const obj: Record<string, unknown> = {};
      if (Array.isArray(need)) for (const m of need) obj[m] = () => undefined;
      return obj;
    };
    r.register(RUNTIME_CONFIG_RESOURCE_ID, carrying("config"));
    r.register(RUNTIME_DB_RESOURCE_ID, carrying("db"));
    r.register(RUNTIME_AUTH_RESOURCE_ID, carrying("auth"));
    r.register(RUNTIME_CHANNELS_RESOURCE_ID, carrying("channels"));
    r.register(RUNTIME_PROXY_RESOURCE_ID, () => {});
    r.register(RUNTIME_HMR_RESOURCE_ID, carrying("hmr"));
  }

  it("declines when the runtime publishes no descriptor (a runtime older than the handshake)", () => {
    const r = new HotResources();
    stubCaps(r);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(claimRuntimeCapabilities(r)).toBeNull();
    warn.mockRestore();
  });

  it("declines when one interface is missing a member the claimer names", () => {
    const r = new HotResources();
    stubCaps(r);
    r.register(RUNTIME_INTERFACES_RESOURCE_ID, { ...RUNTIME_INTERFACES, auth: ["login"] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(claimRuntimeCapabilities(r)).toBeNull();
    warn.mockRestore();
  });

  it("claims on a matching descriptor", () => {
    const r = new HotResources();
    stubCaps(r);
    r.register(RUNTIME_INTERFACES_RESOURCE_ID, RUNTIME_INTERFACES);
    expect(claimRuntimeCapabilities(r)).not.toBeNull();
  });

  it("declines when the descriptor is honest but the live object is not", () => {
    // What a member set buys over a number: the declaration is verified, not trusted.
    const r = new HotResources();
    stubCaps(r);
    r.register(RUNTIME_AUTH_RESOURCE_ID, { login: () => undefined }); // missing the rest
    r.register(RUNTIME_INTERFACES_RESOURCE_ID, RUNTIME_INTERFACES);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(claimRuntimeCapabilities(r)).toBeNull();
    warn.mockRestore();
  });

  it("declines a different family outright — the names are not comparable", () => {
    const r = new HotResources();
    stubCaps(r);
    r.register(RUNTIME_INTERFACES_RESOURCE_ID, { ...RUNTIME_INTERFACES, family: "acme" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(claimRuntimeCapabilities(r)).toBeNull();
    warn.mockRestore();
  });

  it("an interface the claimer never names may differ freely", () => {
    // The whole point of per-interface versions: a bump the claimer never touches must
    // not decline the claim. `extra` is not in RUNTIME_INTERFACES, so it is not required.
    const r = new HotResources();
    stubCaps(r);
    r.register(RUNTIME_INTERFACES_RESOURCE_ID, { ...RUNTIME_INTERFACES, extra: ["x"] });
    expect(claimRuntimeCapabilities(r)).not.toBeNull();
  });
});

describe("a runtime too old to publish capabilities", () => {
  it("is refused, not degraded to terminals-only", async () => {
    // The shape this rule exists for. A runtime that publishes nothing is NOT a bare
    // kernel: it still answers the business API out of its own older routes, so a
    // terminals-only App would leave the frontend this same push just shipped talking to
    // the previous version's API — which is how `/api/me` came back without the fields the
    // new frontend reads off it.
    const r = new HotResources();
    await expect(
      boot(
        packagedPlatform.impl,
        packagedPlatform.iface,
        initialDoc(packagedPlatform.iface, packagedPlatform.context),
        r,
      ),
    ).rejects.toThrow(/no business capabilities/);
    // Refused before the registry was touched at all: the running App's declaration and
    // its parked groups are exactly as they were, so a rejected push costs it nothing.
    expect(r.claim(RESOURCE_IFACES_RESOURCE_ID)).toBeUndefined();
  });

  it("boots terminals-only when the host declares itself a bare kernel", async () => {
    const r = new HotResources();
    const inst = await bootPlatform(r);
    try {
      expect(inst.api.info()).toMatchObject({ impl: "packaged" });
    } finally {
      inst.dispose();
    }
  });
});

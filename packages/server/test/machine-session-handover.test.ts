/**
 * The delivered machine sessions across a swap, judged by structure: the leaving build's
 * closed shape of MachineSession beside them, compared with the booting build's — a
 * different shape dooms the group (its sessions closed at the commit, re-held by the new
 * build), the same shape adopts it, and the transport honours the verdict.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closedShape } from "@prismshadow/penguin-core/kernel";
import type { IfaceTable } from "@prismshadow/penguin-core/kernel";
import type { Reassembly } from "../src/hmr/capabilities.js";
import ifaceTable from "../src/ifaces.json" with { type: "json" };
import {
  MACHINE_SESSION_IFACE,
  SESSION_GROUP,
  SESSION_SHAPE_ID,
} from "../src/machines/transport/index.js";
import { createTestApp } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** Re-assembles whichever App is current — the fixture's tree is the first generation's only. */
async function reassemble(t: TestApp): Promise<boolean> {
  const instance = await t.deps.hmr.ensure();
  return instance.api.business()!.api<Reassembly>("RuntimeModule", "Reassembly").reassemble();
}

describe("the machine sessions across a swap", () => {
  let t: TestApp;
  afterEach(async () => {
    await t.cleanup();
  });

  it("registers this build's closed shape of MachineSession, printed from the interface table", async () => {
    t = await createTestApp();
    const shape = t.deps.hmr.resources.claim<string | null>(SESSION_SHAPE_ID);
    expect(shape).toBe(closedShape(ifaceTable as unknown as IfaceTable, MACHINE_SESSION_IFACE));
    expect(shape).not.toBeNull();
    expect(shape).toContain("setForwards");
  });

  it("adopts a predecessor's sessions when the shape is the same, and closes them when it is not", async () => {
    t = await createTestApp();
    const resources = t.deps.hmr.resources;
    // A session the "previous build" delivered, in the group, with a disposer that closes it.
    let closed = 0;
    const session = { held: () => true };
    resources.register(`${SESSION_GROUP}:ssh:nas`, session, () => closed++);

    // Same shape: the swap keeps it.
    expect(await reassemble(t)).toBe(true);
    expect(closed).toBe(0);
    expect(resources.claim(`${SESSION_GROUP}:ssh:nas`)).toBe(session);

    // "Another build's" MachineSession: the group is doomed — closed at the commit — and the
    // booting build publishes its own shape again.
    resources.register(SESSION_SHAPE_ID, "another build's MachineSession");
    expect(await reassemble(t)).toBe(true);
    expect(closed).toBe(1);
    expect(resources.claim(`${SESSION_GROUP}:ssh:nas`)).toBeUndefined();
    expect(resources.claim<string | null>(SESSION_SHAPE_ID)).toBe(
      closedShape(ifaceTable as unknown as IfaceTable, MACHINE_SESSION_IFACE),
    );
  });
});

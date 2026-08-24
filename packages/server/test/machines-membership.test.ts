/**
 * A machine belongs to a Project (machines/membership.ts, and the service's view of it).
 *
 * The Machines page sits under the Project switcher beside Agents, Skills and Models, so the
 * set of machines has to change when the Project does. What must NOT change with it is what
 * is true of the host — its identity, and the version installed on it — because one machine
 * runs one program and two Projects cannot be allowed to disagree about which.
 *
 * That split is the whole subject here: membership per Project, facts shared. Get it wrong in
 * one direction and a second Project re-sends 30 MB to learn what is already known; wrong in
 * the other and every Project silently borrows machines it was never given.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseMembers, withMember } from "../src/machines/membership.js";
import {
  fingerprintLocal,
  parseModelSyncState,
  withModelSyncState,
} from "../src/machines/models-sync-state.js";
import { MachinesService } from "../src/machines/service.js";
import type { MachinesEffects } from "../src/machines/service.js";

describe("parseMembers", () => {
  it("reads the addresses, dropping repeats and anything that is not one", () => {
    const raw = JSON.stringify({ machines: ["ssh:a", "ssh:a", "", 7, null, "ssh:b"] });
    expect(parseMembers(raw)).toEqual(["ssh:a", "ssh:b"]);
  });

  it("reads damage as no machines rather than refusing to answer", () => {
    // The list is rebuildable by adopting; a corrupt file must not lock someone out of the
    // page that would let them fix it.
    expect(parseMembers("{ not json")).toEqual([]);
    expect(parseMembers(null)).toEqual([]);
    expect(parseMembers(JSON.stringify(["ssh:a"]))).toEqual([]);
  });

  it("adds and removes idempotently", () => {
    const once = withMember(null, "ssh:a", true);
    expect(parseMembers(withMember(once, "ssh:a", true))).toEqual(["ssh:a"]);
    expect(parseMembers(withMember(once, "ssh:a", false))).toEqual([]);
    expect(parseMembers(withMember(once, "ssh:gone", false))).toEqual(["ssh:a"]);
  });
});

describe("machines belong to a Project", () => {
  let root: string;

  /** Two hosts in the ssh config; nothing reaches out, since none of this needs to. */
  const effects = (): Partial<MachinesEffects> => ({
    listAliases: () => ["nas", "build-box"],
    now: () => new Date("2026-08-24T00:00:00.000Z"),
  });

  const installed = (version: string) => ({ version, at: "2026-08-20T00:00:00.000Z" });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-membership-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** What the shared record already holds — what THIS server installed, on which host. */
  const seedRecords = (records: Record<string, unknown>) =>
    fs.writeFileSync(path.join(root, "machines-installs.json"), JSON.stringify(records));

  it("adopts the server's existing machines into the default Project, once", () => {
    // Machines were a property of the server before they were a property of a Project. The
    // ones already installed have to keep working, in the Project the admin already uses.
    seedRecords({ "ssh:nas": installed("9.9.9") });
    const service = new MachinesService(root, effects());
    expect(service.list("default_project").find((m) => m.id === "ssh:nas")?.installed).toEqual(
      installed("9.9.9"),
    );

    // ...and emptying the list is a decision, not a state to undo on the next read.
    service.release("default_project", "ssh:nas");
    expect(service.list("default_project").find((m) => m.id === "ssh:nas")?.installed).toBeNull();
  });

  it("does not hand the machine to every other Project", () => {
    seedRecords({ "ssh:nas": installed("9.9.9") });
    const service = new MachinesService(root, effects());
    const elsewhere = service.list("other").find((m) => m.id === "ssh:nas");
    expect(elsewhere?.installed).toBeNull();
    // Not a blank row either: this is a machine to adopt, and the page has to be able to
    // say so rather than offering a transfer that would change nothing.
    expect(elsewhere?.elsewhere).toEqual(installed("9.9.9"));
  });

  it("still reports the host's identity to a Project that does not use it", () => {
    // An id is a fact about the machine, not about who is asking.
    seedRecords({ "ssh:nas": { ...installed("9.9.9"), machineId: "QS7J4YVgSovi-Z2c" } });
    const service = new MachinesService(root, effects());
    expect(service.list("other").find((m) => m.id === "ssh:nas")?.machineId).toBe(
      "QS7J4YVgSovi-Z2c",
    );
  });

  it("adopts without touching the install record, and refuses what is not installed", () => {
    seedRecords({ "ssh:nas": installed("9.9.9") });
    const service = new MachinesService(root, effects());
    expect(service.adopt("other", "ssh:nas")).toBe(true);
    expect(service.list("other").find((m) => m.id === "ssh:nas")?.installed).toEqual(
      installed("9.9.9"),
    );
    // Nothing installed there: that case is an install, and saying so is the point.
    expect(service.adopt("other", "ssh:build-box")).toBe(false);
  });

  it("releases from one Project without disturbing the other", () => {
    seedRecords({ "ssh:nas": installed("9.9.9") });
    const service = new MachinesService(root, effects());
    service.adopt("other", "ssh:nas");
    service.release("other", "ssh:nas");
    expect(service.list("other").find((m) => m.id === "ssh:nas")?.installed).toBeNull();
    // The install stays: another Project may be using it, and "stop listing this here" is
    // not "go wipe that machine".
    expect(service.list("default_project").find((m) => m.id === "ssh:nas")?.installed).toEqual(
      installed("9.9.9"),
    );
  });

  it("names every Project entitled to a machine's credentials", () => {
    seedRecords({ "ssh:nas": installed("9.9.9") });
    const service = new MachinesService(root, effects());
    service.adopt("other", "ssh:nas");
    // This is what decides whose Model keys may be written to that host.
    expect(service.projectsUsing("ssh:nas").sort()).toEqual(["default_project", "other"]);
    expect(service.projectsUsing("ssh:build-box")).toEqual([]);
  });
});

describe("what a machine was last sent", () => {
  it("fingerprints this side's half, so the check needs no ssh", () => {
    const base = { models: [{ provider: "deepseek", model_id: "x", api_key: "k1" }] };
    // Every field that would reach the machine moves it...
    expect(fingerprintLocal(base)).not.toBe(
      fingerprintLocal({ models: [{ provider: "deepseek", model_id: "x", api_key: "k2" }] }),
    );
    expect(fingerprintLocal(base)).not.toBe(
      fingerprintLocal({ ...base, defaultModel: { provider: "deepseek", model_id: "x" } }),
    );
    // ...and an identical half does not, which is what makes a boot cost nothing.
    expect(fingerprintLocal(base)).toBe(
      fingerprintLocal({ models: [{ provider: "deepseek", model_id: "x", api_key: "k1" }] }),
    );
  });

  it("remembers per machine and per Project, and survives damage", () => {
    const once = withModelSyncState(null, "ssh:nas", { default_project: "aaa" });
    const twice = withModelSyncState(once, "ssh:other", { default_project: "bbb" });
    expect(parseModelSyncState(twice)).toEqual({
      "ssh:nas": { default_project: "aaa" },
      "ssh:other": { default_project: "bbb" },
    });
    // Merged, not replaced: a second Project on the same machine must not erase the first.
    const third = withModelSyncState(twice, "ssh:nas", { field_work: "ccc" });
    expect(parseModelSyncState(third)["ssh:nas"]).toEqual({
      default_project: "aaa",
      field_work: "ccc",
    });
    // Damage reads as "nothing sent yet" — one wasted sync, never a wrong skip.
    expect(parseModelSyncState("{ not json")).toEqual({});
  });
});

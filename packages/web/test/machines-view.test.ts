/**
 * machines-view unit tests: what one Machines row shows, given the server's single install
 * job. The server keeps ONE job at a time, so the coupling under test is that a job on any
 * row disables the buttons on all of them — and that the log, the verdict and the running
 * mark appear only on the row the job actually belongs to.
 */
import { describe, expect, it } from "vitest";
import type { MachineInstallJob, MachinesResponse } from "@prismshadow/penguin-server/api";
import { machineRowState, verdictOf } from "../src/features/machines/machines-view";

function response(
  job: MachineInstallJob | null,
  imageVersion: string | null = "9.9.9",
): MachinesResponse {
  return {
    machines: [
      { id: "ssh:build-box", alias: "build-box" },
      { id: "ssh:nas", alias: "nas" },
    ],
    imageVersion,
    job,
  };
}

function job(over: Partial<MachineInstallJob> = {}): MachineInstallJob {
  return {
    machineId: "ssh:nas",
    alias: "nas",
    running: true,
    log: ["Installing 9.9.9 on deploy@nas…"],
    result: null,
    ...over,
  };
}

describe("verdictOf", () => {
  it("is null while the job runs", () => {
    expect(verdictOf(job())).toBeNull();
  });

  it("carries the version on both kinds of success", () => {
    expect(
      verdictOf(job({ running: false, result: { ok: true, kind: "installed", version: "9.9.9" } })),
    ).toEqual({
      kind: "installed",
      version: "9.9.9",
    });
    expect(
      verdictOf(
        job({ running: false, result: { ok: true, kind: "already-installed", version: "9.9.9" } }),
      ),
    ).toEqual({ kind: "already-installed", version: "9.9.9" });
  });

  it("keeps the failing step and the far side's own message", () => {
    expect(
      verdictOf(
        job({
          running: false,
          result: { ok: false, step: "connect", message: "Permission denied (publickey)." },
        }),
      ),
    ).toEqual({ kind: "failed", step: "connect", message: "Permission denied (publickey)." });
  });
});

describe("machineRowState", () => {
  it("with no job at all, every row offers a plain install", () => {
    const state = response(null);
    for (const id of ["ssh:nas", "ssh:build-box"]) {
      expect(machineRowState(id, state, null)).toEqual({
        action: "install",
        disabled: false,
        running: false,
        verdict: null,
        log: [],
      });
    }
  });

  it("a running job marks its own row and disables every other one", () => {
    const state = response(job());
    const mine = machineRowState("ssh:nas", state, null);
    expect(mine).toMatchObject({ action: "installing", running: true, disabled: true });
    expect(mine.log).toEqual(["Installing 9.9.9 on deploy@nas…"]);

    const other = machineRowState("ssh:build-box", state, null);
    // Disabled, but NOT marked as installing — the job is not this row's.
    expect(other).toMatchObject({ action: "install", running: false, disabled: true });
    expect(other.log).toEqual([]);
  });

  it("a POST still in flight reads as installing before the server reports a job", () => {
    const state = response(null);
    expect(machineRowState("ssh:nas", state, "ssh:nas")).toMatchObject({
      action: "installing",
      running: false,
      disabled: true,
    });
    expect(machineRowState("ssh:build-box", state, "ssh:nas")).toMatchObject({
      action: "install",
      disabled: true,
    });
  });

  it("a finished job leaves its row on reinstall, with the verdict and the log", () => {
    const done = job({
      running: false,
      log: ["Installing…", "Unpacking…"],
      result: { ok: true, kind: "installed", version: "9.9.9" },
    });
    const row = machineRowState("ssh:nas", response(done), null);
    expect(row).toMatchObject({ action: "reinstall", running: false, disabled: false });
    expect(row.verdict).toEqual({ kind: "installed", version: "9.9.9" });
    expect(row.log).toEqual(["Installing…", "Unpacking…"]);
    // The other row is free again, and shows nothing of the finished job.
    expect(machineRowState("ssh:build-box", response(done), null)).toMatchObject({
      action: "install",
      disabled: false,
      verdict: null,
    });
  });

  it("a failed job is still a reinstall offer, carrying the failure", () => {
    const failed = job({
      running: false,
      result: { ok: false, step: "connect", message: "Permission denied (publickey)." },
    });
    const row = machineRowState("ssh:nas", response(failed), null);
    expect(row.action).toBe("reinstall");
    expect(row.disabled).toBe(false);
    expect(row.verdict).toEqual({
      kind: "failed",
      step: "connect",
      message: "Permission denied (publickey).",
    });
  });

  it("no install image disables every row, whatever the job says", () => {
    const state = response(null, null);
    expect(machineRowState("ssh:nas", state, null).disabled).toBe(true);
    expect(machineRowState("ssh:build-box", state, null).disabled).toBe(true);
  });
});

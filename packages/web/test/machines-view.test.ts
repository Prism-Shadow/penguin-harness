/**
 * machines-view unit tests: what the Machines page's install control offers, given the
 * server's single install job and whatever is selected in the picker.
 *
 * The case worth pinning is that the two come apart: the server runs one job at a time, so
 * selecting a second host while the first installs must refuse — without pretending the
 * selection is the thing installing, and without losing the running job.
 */
import { describe, expect, it } from "vitest";
import type { MachineInstallJob, MachinesResponse } from "@prismshadow/penguin-server/api";
import { installButtonState, verdictOf } from "../src/features/machines/machines-view";

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

const done = job({ running: false, result: { ok: true, kind: "installed", version: "9.9.9" } });

describe("verdictOf", () => {
  it("is null while the job runs", () => {
    expect(verdictOf(job())).toBeNull();
  });

  it("carries the version on both kinds of success", () => {
    expect(verdictOf(done)).toEqual({ kind: "installed", version: "9.9.9" });
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

describe("installButtonState", () => {
  it("nothing selected: the button offers an install it cannot start", () => {
    expect(installButtonState(null, response(null), false)).toEqual({
      action: "install",
      disabled: true,
    });
  });

  it("a selection with no job running is ready to go", () => {
    expect(installButtonState("ssh:nas", response(null), false)).toEqual({
      action: "install",
      disabled: false,
    });
  });

  it("the selected machine's own running job reads as installing", () => {
    expect(installButtonState("ssh:nas", response(job()), false)).toEqual({
      action: "installing",
      disabled: true,
    });
  });

  it("picking ANOTHER host mid-install refuses without claiming that host is installing", () => {
    // The job belongs to ssh:nas; the picker moved to ssh:build-box. One job at a time, so
    // the button is disabled — but it must not say "installing" about a host that is not.
    expect(installButtonState("ssh:build-box", response(job()), false)).toEqual({
      action: "install",
      disabled: true,
    });
  });

  it("a POST still in flight reads as installing before the server reports a job", () => {
    expect(installButtonState("ssh:nas", response(null), true)).toEqual({
      action: "installing",
      disabled: true,
    });
  });

  it("a finished job leaves ITS machine on reinstall, and every other one on install", () => {
    expect(installButtonState("ssh:nas", response(done), false)).toEqual({
      action: "reinstall",
      disabled: false,
    });
    expect(installButtonState("ssh:build-box", response(done), false)).toEqual({
      action: "install",
      disabled: false,
    });
  });

  it("a failed job is still a reinstall offer", () => {
    const failed = job({
      running: false,
      result: { ok: false, step: "connect", message: "Permission denied (publickey)." },
    });
    expect(installButtonState("ssh:nas", response(failed), false)).toEqual({
      action: "reinstall",
      disabled: false,
    });
  });

  it("no install image disables the button whatever is selected", () => {
    expect(installButtonState("ssh:nas", response(null, null), false).disabled).toBe(true);
    expect(installButtonState("ssh:build-box", response(done, null), false).disabled).toBe(true);
  });
});

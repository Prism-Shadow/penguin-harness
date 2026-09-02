/**
 * machines-view unit tests: what the Machines page's install control offers, given the
 * server's single install job and whatever is selected in the picker.
 *
 * Two cases worth pinning. The server runs one job at a time, so selecting a second host
 * while the first installs must refuse — without pretending the selection is the thing
 * installing. And "already installed" comes from the machine's own persisted record, never
 * from the job: reading it off the one job slot is what used to make an installed machine
 * stop looking installed as soon as anything else was installed.
 */
import { describe, expect, it } from "vitest";
import type {
  MachineInfo,
  MachineInstallJob,
  MachinesResponse,
} from "@prismshadow/penguin-server/api";
import {
  installButtonState,
  installedMachines,
  verdictOf,
} from "../src/features/machines/machines-view";

const INSTALLED = { version: "9.9.9", at: "2026-08-24T12:00:00.000Z" };

/** A remote row as the list answers it: no probe taken, no id heard yet. */
const remote = (alias: string, installed: MachineInfo["installed"]): MachineInfo => ({
  id: `ssh:${alias}`,
  alias,
  machineId: null,
  installed,
  local: false,
  status: null,
});

const fresh = (alias: string): MachineInfo => remote(alias, null);
const carrying = (alias: string): MachineInfo => remote(alias, INSTALLED);

function response(
  job: MachineInstallJob | null,
  opts: { imageVersion?: string | null; machines?: MachineInfo[] } = {},
): MachinesResponse {
  return {
    machines: opts.machines ?? [fresh("build-box"), fresh("nas")],
    imageVersion: opts.imageVersion === undefined ? "9.9.9" : opts.imageVersion,
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

  it("a never-installed selection with no job running is ready to go", () => {
    expect(installButtonState(fresh("nas"), response(null), false)).toEqual({
      action: "install",
      disabled: false,
    });
  });

  it("the selected machine's own running job reads as installing", () => {
    expect(installButtonState(fresh("nas"), response(job()), false)).toEqual({
      action: "installing",
      disabled: true,
    });
  });

  it("picking ANOTHER host mid-install refuses without claiming that host is installing", () => {
    // The job belongs to ssh:nas; the picker moved to ssh:build-box. One job at a time, so
    // the button is disabled — but it must not say "installing" about a host that is not.
    expect(installButtonState(fresh("build-box"), response(job()), false)).toEqual({
      action: "install",
      disabled: true,
    });
  });

  it("a POST still in flight reads as installing before the server reports a job", () => {
    expect(installButtonState(fresh("nas"), response(null), true)).toEqual({
      action: "installing",
      disabled: true,
    });
  });

  it("a machine carrying the program offers a reinstall — from its record, not the job", () => {
    // No job at all: this is the page after a restart, which is exactly the case that used
    // to read as "never installed".
    expect(installButtonState(carrying("nas"), response(null), false)).toEqual({
      action: "reinstall",
      disabled: false,
    });
  });

  it("installing elsewhere leaves an installed machine still reading as installed", () => {
    const elsewhere = job({
      machineId: "ssh:build-box",
      alias: "build-box",
      running: false,
      result: { ok: true, kind: "installed", version: "9.9.9" },
    });
    expect(installButtonState(carrying("nas"), response(elsewhere), false)).toEqual({
      action: "reinstall",
      disabled: false,
    });
    // ...and the machine that job belongs to reads as installed off its own record too.
    expect(installButtonState(carrying("build-box"), response(elsewhere), false).action).toBe(
      "reinstall",
    );
  });

  it("a failed install leaves the selection on plain install: nothing was recorded", () => {
    const failed = job({
      running: false,
      result: { ok: false, step: "connect", message: "Permission denied (publickey)." },
    });
    expect(installButtonState(fresh("nas"), response(failed), false)).toEqual({
      action: "install",
      disabled: false,
    });
  });

  it("no install image disables the button whatever is selected", () => {
    expect(
      installButtonState(fresh("nas"), response(null, { imageVersion: null }), false).disabled,
    ).toBe(true);
    expect(
      installButtonState(carrying("nas"), response(null, { imageVersion: null }), false).disabled,
    ).toBe(true);
  });
});

describe("installedMachines", () => {
  const at = (iso: string) => ({ version: "9.9.9", at: iso });

  it("is empty when nothing has been installed", () => {
    expect(installedMachines(response(null))).toEqual([]);
  });

  it("keeps only the installed ones, most recent first", () => {
    const machines: MachineInfo[] = [
      remote("a", at("2026-08-20T00:00:00.000Z")),
      remote("b", null),
      remote("c", at("2026-08-24T00:00:00.000Z")),
      remote("d", at("2026-08-22T00:00:00.000Z")),
    ];
    expect(installedMachines(response(null, { machines })).map((m) => m.alias)).toEqual([
      "c",
      "d",
      "a",
    ]);
  });

  it("keeps the config's order among installs sharing a timestamp, so the list does not shuffle between polls", () => {
    const same = at("2026-08-24T00:00:00.000Z");
    const machines: MachineInfo[] = [remote("x", same), remote("y", same), remote("z", same)];
    const order = () => installedMachines(response(null, { machines })).map((m) => m.alias);
    expect(order()).toEqual(["x", "y", "z"]);
    expect(order()).toEqual(order());
  });

  it("does not mutate the response's own machine order (the picker reads it too)", () => {
    const machines: MachineInfo[] = [
      remote("a", at("2026-08-20T00:00:00.000Z")),
      remote("c", at("2026-08-24T00:00:00.000Z")),
    ];
    const state = response(null, { machines });
    installedMachines(state);
    expect(state.machines.map((m) => m.alias)).toEqual(["a", "c"]);
  });
});

describe("this machine in the list", () => {
  /** The entry the server puts first: the host serving this page. */
  const here = (): MachineInfo => ({
    id: "local",
    alias: "workstation",
    machineId: "LNrJdHAZJ91G58i0",
    installed: INSTALLED,
    local: true,
    status: { state: "running", checkedAt: INSTALLED.at, port: 7364 },
  });

  it("is never one of the installed remotes: there is nothing to reinstall from here", () => {
    const listed = installedMachines(response(null, { machines: [here(), carrying("nas")] }));
    expect(listed.map((m) => m.id)).toEqual(["ssh:nas"]);
  });
});

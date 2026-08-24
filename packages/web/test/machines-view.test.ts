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
  MachineConnectJob,
  MachineInfo,
  MachineInstallJob,
  MachinesResponse,
} from "@prismshadow/penguin-server/api";
import {
  activeMachine,
  connectAction,
  installButtonState,
  installedMachines,
  localMachine,
  outOfDate,
  statusTone,
  verdictOf,
} from "../src/features/machines/machines-view";

const INSTALLED = { version: "9.9.9", at: "2026-08-24T12:00:00.000Z" };

const fresh = (alias: string): MachineInfo => ({
  id: `ssh:${alias}`,
  alias,
  machineId: null,
  installed: null,
  local: false,
  origin: null,
  status: null,
});
const carrying = (alias: string): MachineInfo => ({ ...fresh(alias), installed: INSTALLED });
/** The entry the server puts first: this very machine. */
const here = (): MachineInfo => ({
  id: "local",
  alias: "workstation",
  machineId: "LNrJdHAZJ91G58i0",
  installed: INSTALLED,
  local: true,
  origin: null,
  status: { state: "running", checkedAt: INSTALLED.at, port: 7364 },
});

function response(
  job: MachineInstallJob | null,
  opts: { imageVersion?: string | null; machines?: MachineInfo[] } = {},
): MachinesResponse {
  return {
    machines: opts.machines ?? [fresh("build-box"), fresh("nas")],
    imageVersion: opts.imageVersion === undefined ? "9.9.9" : opts.imageVersion,
    job,
    connect: null,
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
      { ...fresh("a"), installed: at("2026-08-20T00:00:00.000Z") },
      fresh("b"),
      { ...fresh("c"), installed: at("2026-08-24T00:00:00.000Z") },
      { ...fresh("d"), installed: at("2026-08-22T00:00:00.000Z") },
    ];
    expect(installedMachines(response(null, { machines })).map((m) => m.alias)).toEqual([
      "c",
      "d",
      "a",
    ]);
  });

  it("keeps the config's order among installs sharing a timestamp, so the list does not shuffle between polls", () => {
    const same = at("2026-08-24T00:00:00.000Z");
    const machines: MachineInfo[] = [
      { ...fresh("x"), installed: same },
      { ...fresh("y"), installed: same },
      { ...fresh("z"), installed: same },
    ];
    const order = () => installedMachines(response(null, { machines })).map((m) => m.alias);
    expect(order()).toEqual(["x", "y", "z"]);
    expect(order()).toEqual(order());
  });

  it("does not mutate the response's own machine order (the picker reads it too)", () => {
    const machines: MachineInfo[] = [
      { ...fresh("a"), installed: at("2026-08-20T00:00:00.000Z") },
      { ...fresh("c"), installed: at("2026-08-24T00:00:00.000Z") },
    ];
    const state = response(null, { machines });
    installedMachines(state);
    expect(state.machines.map((m) => m.alias)).toEqual(["a", "c"]);
  });
});

describe("the local machine", () => {
  it("is found by its flag, not by its id or position", () => {
    const state = response(null, { machines: [fresh("a"), here(), fresh("b")] });
    expect(localMachine(state)?.local).toBe(true);
    expect(localMachine(response(null))).toBeNull();
  });

  it("is kept out of the installed list, which is about work done elsewhere", () => {
    const state = response(null, { machines: [here(), carrying("nas")] });
    expect(installedMachines(state).map((m) => m.id)).toEqual(["ssh:nas"]);
  });

  it("can never be an install target, however healthy it looks", () => {
    expect(installButtonState(here(), response(null), false).disabled).toBe(true);
  });
});

describe("statusTone", () => {
  it("colours only a machine that cannot be reached as a problem", () => {
    expect(statusTone("unreachable")).toBe("danger");
  });

  it("treats running as good and stopped as settled — a stopped server is not a fault", () => {
    expect(statusTone("running")).toBe("success");
    expect(statusTone("stopped")).toBe("muted");
  });

  it("recedes for a machine nothing is known about yet", () => {
    expect(statusTone(undefined)).toBe("muted");
  });
});

describe("connectAction", () => {
  const connected = (alias: string): MachineInfo => ({
    ...carrying(alias),
    machineId: "noeSE0FFHhNXl2J5",
    origin: "http://localhost:7364",
  });
  const job = (over: Partial<MachineConnectJob> = {}): MachineConnectJob => ({
    machineId: "ssh:nas",
    alias: "nas",
    running: true,
    log: [],
    result: null,
    ...over,
  });

  it("offers nothing for this machine — you are already on it", () => {
    expect(connectAction(here(), null, null)).toBe("unavailable");
  });

  it("offers nothing for a machine with no install: there is no server to start", () => {
    expect(connectAction(fresh("nas"), null, null)).toBe("unavailable");
  });

  it("offers a connect for an installed machine with no tunnel", () => {
    expect(connectAction(carrying("nas"), null, null)).toBe("connect");
  });

  it("reads as connected once there is an origin", () => {
    expect(connectAction(connected("nas"), null, null)).toBe("connected");
  });

  it("shows the running connect on ITS machine only", () => {
    expect(connectAction(carrying("nas"), job(), null)).toBe("connecting");
    // A connect elsewhere must not make this row claim to be connecting.
    expect(connectAction(carrying("build-box"), job(), null)).toBe("connect");
  });

  it("reads as connecting while this row's POST is still in flight", () => {
    expect(connectAction(carrying("nas"), null, "ssh:nas")).toBe("connecting");
    expect(connectAction(carrying("build-box"), null, "ssh:nas")).toBe("connect");
  });
});

describe("activeMachine", () => {
  const ID = "noeSE0FFHhNXl2J5";
  const remote = (): MachineInfo => ({ ...carrying("nas"), machineId: ID });

  it("is null when this window is on the local server", () => {
    expect(activeMachine(response(null, { machines: [here(), remote()] }), null)).toBeNull();
  });

  it("finds the machine by its own id, not by its address", () => {
    const state = response(null, { machines: [here(), remote()] });
    expect(activeMachine(state, ID)?.alias).toBe("nas");
    expect(activeMachine(state, "ssh:nas")).toBeNull();
  });

  it("is null for an id nothing in the list claims, rather than guessing", () => {
    // The window is pointed somewhere this server no longer lists; the banner falls back to
    // the raw id rather than naming the wrong machine.
    expect(activeMachine(response(null, { machines: [here()] }), ID)).toBeNull();
  });
});

describe("outOfDate", () => {
  const carrying9 = carrying("nas"); // installed 9.9.9, which is the fixture imageVersion

  it("is false when the machine carries what this server would install", () => {
    expect(outOfDate(carrying9, "9.9.9")).toBe(false);
  });

  it("is true for ANY difference — hmr versions are content hashes and do not order", () => {
    // `0.0.0-hmr.<cli>.<web>`: there is no newer/older to compare, only same or not.
    expect(outOfDate(carrying9, "10.0.0")).toBe(true);
    expect(outOfDate(carrying9, "0.0.0-hmr.abc.def")).toBe(true);
  });

  it("never claims a machine is behind when the local image is unknown", () => {
    // A development checkout with nothing pushed has no image; saying "out of sync" there
    // would be a guess dressed as a fact.
    expect(outOfDate(carrying9, null)).toBe(false);
  });

  it("says nothing about this machine, or one with nothing installed", () => {
    expect(outOfDate(here(), "10.0.0")).toBe(false);
    expect(outOfDate(fresh("nas"), "10.0.0")).toBe(false);
  });
});

describe("installButtonState, once a machine is behind", () => {
  it("offers an update rather than a reinstall", () => {
    const behind = { ...carrying("nas"), installed: { version: "old", at: INSTALLED.at } };
    expect(installButtonState(behind, response(null), false).action).toBe("update");
  });

  it("still says reinstall when the two ends agree", () => {
    expect(installButtonState(carrying("nas"), response(null), false).action).toBe("reinstall");
  });
});

/**
 * machines-view unit tests: the one sentence a Machines row says, and what the batch selects
 * by default.
 *
 * The reading's precedence is the point. The server's job for a machine is the freshest
 * word; a held connection settles "ready" over an older failed job, since a re-hold that
 * brought the machine back must not leave the row saying it failed; and "in use" comes from
 * the machine's own persisted record, never from the job slot.
 */
import { describe, expect, it } from "vitest";
import type { MachineInfo, MachineJob, MachinesResponse } from "@prismshadow/penguin-server/api";
import {
  anyJobPending,
  defaultSelection,
  installedMachines,
  jobFor,
  localMachine,
  outOfDate,
  readMachine,
  readingTone,
  wantsUse,
} from "../src/features/machines/machines-view";

const INSTALLED = { version: "9.9.9", at: "2026-08-24T12:00:00.000Z" };

const fresh = (alias: string): MachineInfo => ({
  id: `ssh:${alias}`,
  alias,
  machineId: null,
  installed: null,
  local: false,
  connection: null,
  api: null,
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
  connection: null,
  api: null,
  status: { state: "running", checkedAt: INSTALLED.at, port: 7364 },
});

function response(
  jobs: MachineJob[],
  opts: { imageVersion?: string | null; machines?: MachineInfo[] } = {},
): MachinesResponse {
  return {
    machines: opts.machines ?? [fresh("build-box"), fresh("nas")],
    imageVersion: opts.imageVersion === undefined ? "9.9.9" : opts.imageVersion,
    job: jobs.find((job) => job.running) ?? jobs.at(-1) ?? null,
    jobs,
  };
}

function job(over: Partial<MachineJob> = {}): MachineJob {
  return {
    kind: "use",
    machineId: "ssh:nas",
    alias: "nas",
    queued: false,
    running: true,
    log: ["Installing 9.9.9 on deploy@nas…"],
    result: null,
    ...over,
  };
}

const failed = job({
  running: false,
  result: { ok: false, step: "connect", message: "Permission denied.", canReplaceProgram: true },
});

describe("readMachine", () => {
  it("a queued job reads as waiting, before anything the machine's own record says", () => {
    const nas = { ...carrying("nas"), connection: { pid: 1 } };
    expect(readMachine(nas, job({ queued: true, running: false }), "9.9.9")).toEqual({
      kind: "queued",
    });
  });

  it("a running job reads as working, with its latest line", () => {
    expect(readMachine(carrying("nas"), job(), "9.9.9")).toEqual({
      kind: "working",
      step: "Installing 9.9.9 on deploy@nas…",
    });
    expect(readMachine(carrying("nas"), job({ log: [] }), "9.9.9")).toEqual({
      kind: "working",
      step: null,
    });
  });

  it("a held connection is ready, even over an older failed job", () => {
    const nas: MachineInfo = {
      ...carrying("nas"),
      connection: { pid: 1 },
      status: { state: "running", checkedAt: INSTALLED.at, port: 7364 },
    };
    expect(readMachine(nas, failed, "9.9.9")).toEqual({ kind: "ready", port: 7364 });
  });

  it("a failed job keeps the failing step, the far side's words and the forced-install offer", () => {
    expect(readMachine(carrying("nas"), failed, "9.9.9")).toEqual({
      kind: "failed",
      step: "connect",
      message: "Permission denied.",
      canReplaceProgram: true,
    });
  });

  it("a machine on another build is behind, whatever its server is doing", () => {
    const nas: MachineInfo = {
      ...carrying("nas"),
      status: { state: "running", checkedAt: INSTALLED.at, port: 7364 },
    };
    expect(readMachine(nas, null, "9.9.10")).toEqual({ kind: "behind", version: "9.9.9" });
  });

  it("the last probe speaks when no job and no connection do", () => {
    const at = INSTALLED.at;
    expect(readMachine(carrying("nas"), null, "9.9.9")).toEqual({ kind: "unknown" });
    expect(
      readMachine(
        {
          ...carrying("nas"),
          status: { state: "unreachable", checkedAt: at, detail: "timed out" },
        },
        null,
        "9.9.9",
      ),
    ).toEqual({ kind: "unreachable", detail: "timed out" });
    expect(
      readMachine(
        { ...carrying("nas"), status: { state: "stopped", checkedAt: at } },
        null,
        "9.9.9",
      ),
    ).toEqual({ kind: "stopped" });
    expect(
      readMachine(
        { ...carrying("nas"), status: { state: "running", checkedAt: at, port: 7364 } },
        null,
        "9.9.9",
      ),
    ).toEqual({ kind: "notConnected" });
  });

  it("a use that ended at installed, with nothing held, is as far as it goes", () => {
    const installedOnly = job({
      running: false,
      result: { ok: true, installed: "installed", version: "9.9.9" },
    });
    expect(readMachine(carrying("nas"), installedOnly, "9.9.9")).toEqual({ kind: "installedOnly" });
  });

  it("tones follow meaning: moving is busy, ready is success, broken is danger, the rest want attention", () => {
    expect(readingTone({ kind: "working", step: null })).toBe("busy");
    expect(readingTone({ kind: "ready", port: 7364 })).toBe("success");
    expect(readingTone({ kind: "unreachable", detail: null })).toBe("danger");
    expect(readingTone({ kind: "stopped" })).toBe("attention");
    expect(readingTone({ kind: "unknown" })).toBe("muted");
  });

  it("use changes nothing for a ready or busy row, and fixes every other one", () => {
    expect(wantsUse({ kind: "ready", port: null })).toBe(false);
    expect(wantsUse({ kind: "queued" })).toBe(false);
    expect(wantsUse({ kind: "stopped" })).toBe(true);
    expect(wantsUse({ kind: "behind", version: "1" })).toBe(true);
  });
});

describe("jobs and polling", () => {
  it("finds a machine's job by id", () => {
    expect(jobFor([failed], "ssh:nas")).toBe(failed);
    expect(jobFor([failed], "ssh:build-box")).toBeNull();
  });

  it("keeps polling while anything is queued or running, and stops once all have finished", () => {
    expect(anyJobPending(response([job({ queued: true, running: false })]))).toBe(true);
    expect(anyJobPending(response([job()]))).toBe(true);
    expect(anyJobPending(response([failed]))).toBe(false);
    expect(anyJobPending(response([]))).toBe(false);
  });
});

describe("installedMachines", () => {
  const older = { version: "9.9.8", at: "2026-08-20T00:00:00.000Z" };

  it("is empty when nothing has been installed", () => {
    expect(installedMachines(response([]))).toEqual([]);
  });

  it("keeps only the installed ones, most recent first", () => {
    const nas = { ...carrying("nas"), installed: older };
    const box = carrying("build-box");
    expect(
      installedMachines(response([], { machines: [here(), fresh("spare"), nas, box] })),
    ).toEqual([box, nas]);
  });

  it("keeps the config's order among installs sharing a timestamp, so the list does not shuffle between polls", () => {
    const a = carrying("a");
    const b = carrying("b");
    const c = carrying("c");
    expect(installedMachines(response([], { machines: [here(), a, b, c] }))).toEqual([a, b, c]);
  });

  it("does not mutate the response's own machine order (the picker reads it too)", () => {
    const nas = { ...carrying("nas"), installed: older };
    const box = carrying("build-box");
    const state = response([], { machines: [nas, box] });
    installedMachines(state);
    expect(state.machines).toEqual([nas, box]);
  });
});

describe("the batch's default selection", () => {
  it("ticks every machine in use and nothing else", () => {
    const state = response([], {
      machines: [here(), fresh("spare"), carrying("nas"), carrying("build-box")],
    });
    expect([...defaultSelection(state)].sort()).toEqual(["ssh:build-box", "ssh:nas"]);
  });
});

describe("the local machine", () => {
  it("is the entry flagged local, wherever the server put it", () => {
    expect(localMachine(response([], { machines: [fresh("nas"), here()] }))?.id).toBe("local");
    expect(localMachine(response([]))).toBeNull();
  });
});

describe("outOfDate", () => {
  it("compares the record's build against what this server would install", () => {
    expect(outOfDate(carrying("nas"), "9.9.9")).toBe(false);
    expect(outOfDate(carrying("nas"), "9.9.10")).toBe(true);
  });

  it("is never true without an image, for a fresh machine, or for this machine", () => {
    expect(outOfDate(carrying("nas"), null)).toBe(false);
    expect(outOfDate(fresh("nas"), "9.9.10")).toBe(false);
    expect(outOfDate(here(), "9.9.10")).toBe(false);
  });
});

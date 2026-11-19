/**
 * What a machine's failure puts in its problem report (features/machines/machine-failure-report.ts).
 *
 * - Given a job that failed because ssh refused the sign-in, its report names the job, the step
 *   and the reason ssh's words were read as, and holds no host, account or key path from ssh's
 *   words — it says they were left out.
 * - Given a job that is still running, or one that finished well, there is no failure to report.
 */
import { describe, expect, it } from "vitest";
import { UNKNOWN_ENVIRONMENT, buildReport, toldReport } from "@prismshadow/penguin-ui";
import type { MachineJob } from "@prismshadow/penguin-server/api";
import { machineJobFailure } from "../src/features/machines/machine-failure-report";

const SSH_WORDS =
  "ssh refused the sign-in (ssh: alice@10.20.30.40: Permission denied (publickey). Loaded key /home/alice/.ssh/id_ed25519 from gpu-box.lab.example)";

const job = (over: Partial<MachineJob> = {}): MachineJob =>
  ({
    kind: "use",
    machineId: "m1",
    alias: "gpu-box",
    queued: false,
    running: false,
    steps: ["check", "install", "connect"],
    phase: "connect",
    log: [],
    result: { ok: false, step: "connect", message: SSH_WORDS, sshReason: "auth" },
    ...over,
  }) as MachineJob;

describe("a machine job's failure report", () => {
  it("names the job, the step and ssh's reason, and holds none of ssh's words", () => {
    const told = machineJobFailure(job());
    expect(told).not.toBeNull();
    const built = buildReport(toldReport(told!)(), UNKNOWN_ENVIRONMENT);
    expect(built.markdown).toContain("- What happened: a machine job failed");
    expect(built.markdown).toContain("- Error code: auth");
    expect(built.markdown).toContain("- Job: use");
    expect(built.markdown).toContain("- Step: connect");
    expect(built.markdown).toContain("(left out:");
    for (const shared of [built.markdown, decodeURIComponent(built.issueUrl)]) {
      for (const leak of ["alice", "10.20.30.40", "id_ed25519", "gpu-box"]) {
        expect(shared).not.toContain(leak);
      }
    }
  });

  it("has nothing to report for a job still running or one that went through", () => {
    expect(machineJobFailure(job({ running: true }))).toBeNull();
    expect(machineJobFailure(job({ result: { ok: true, connected: true } }))).toBeNull();
  });
});

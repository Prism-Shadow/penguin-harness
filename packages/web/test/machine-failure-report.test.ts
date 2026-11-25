/**
 * What a machine's failure puts in its problem report (library/machine/src/web/machine-failure-report.ts).
 *
 * - Given a job that failed because ssh refused the sign-in, its report names the job, the step and
 *   the reason ssh's words were read as, and carries ssh's words and the log's last lines masked:
 *   no host name, address, account or the machine's own alias, host name or key file.
 * - Given a job that is still running, or one that finished well, there is no failure to report.
 */
import { describe, expect, it } from "vitest";
import { UNKNOWN_ENVIRONMENT, buildReport, toldReport } from "@prismshadow/penguin-ui";
import type { MachineJob, SshHostResponse } from "@prismshadow/penguin-server/api";
import { machineJobFailure } from "@prismshadow/penguin-library-machine/web/machine-failure-report";

const SSH_WORDS =
  "ssh refused the sign-in (ssh: deploy@10.20.30.40: Permission denied (publickey). Loaded key /home/alice/.ssh/lab-key from gpu-box.lab.example.com)";

const HOST: SshHostResponse = {
  alias: "gpu-box",
  hostName: "10.20.30.40",
  user: "deploy",
  identityFile: "/srv/keys/lab-key.pem",
  editable: true,
};

const job = (over: Partial<MachineJob> = {}): MachineJob =>
  ({
    kind: "use",
    machineId: "m1",
    alias: "gpu-box",
    queued: false,
    running: false,
    steps: ["check", "install", "connect"],
    phase: "connect",
    log: [
      "$ ssh gpu-box true",
      "using identity /srv/keys/lab-key.pem",
      "Permission denied (publickey).",
    ],
    result: { ok: false, step: "connect", message: SSH_WORDS, sshReason: "auth" },
    ...over,
  }) as MachineJob;

describe("a machine job's failure report", () => {
  it("carries the step, ssh's reason and ssh's words, masked", () => {
    const told = machineJobFailure(job(), HOST);
    expect(told).not.toBeNull();
    const built = buildReport(toldReport(told!)(), UNKNOWN_ENVIRONMENT);
    expect(built.markdown).toContain("- What happened: a machine job failed");
    expect(built.markdown).toContain("- Error code: auth");
    expect(built.markdown).toContain("- Job: use");
    expect(built.markdown).toContain("- Step: connect");
    expect(built.markdown).toContain("Permission denied (publickey).");
    expect(built.markdown).toContain("<user>@<host>");
    expect(built.markdown).toContain("Job log (last lines):");
    for (const shared of [built.markdown, decodeURIComponent(built.issueUrl)]) {
      for (const leak of [
        "alice",
        "deploy",
        "10.20.30.40",
        "gpu-box",
        "lab.example",
        "lab-key.pem",
      ]) {
        expect(shared).not.toContain(leak);
      }
    }
  });

  it("has nothing to report for a job still running or one that went through", () => {
    expect(machineJobFailure(job({ running: true }))).toBeNull();
    expect(machineJobFailure(job({ result: { ok: true, connected: true } }))).toBeNull();
  });
});

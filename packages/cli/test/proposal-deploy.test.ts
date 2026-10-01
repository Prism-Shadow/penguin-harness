/**
 * The deploy commands over a stub transport: what each one sends (the script id, the
 * proposal, the arguments after `--` untouched, the caller's identity), how `deploy` follows a
 * run to its end and what it exits with, and the dry run and `--json` answers.
 */
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import type { ProposalDeployRun, ProposalDeployRunResponse } from "@prismshadow/penguin-server/api";
import { getMessages } from "../src/i18n.js";
import {
  argvLine,
  registerProposalDeploy,
  type DeployKit,
  type ProposalRequester,
} from "../src/commands/proposal-deploy.js";

const t = getMessages("en");
const HEAD = "c".repeat(40);

const run = (over: Partial<ProposalDeployRun> = {}): ProposalDeployRun => ({
  id: "r1",
  script: "staging",
  repo: "acme/site",
  pr: 11,
  prUrl: "https://github.com/acme/site/pull/11",
  branch: "feat/x",
  head: HEAD,
  proposal: 4,
  argv: ["bash", "deploy.sh"],
  status: "running",
  by: "agent:dev1",
  startedAt: "2026-10-01T00:00:00.000Z",
  finishedAt: null,
  exitCode: null,
  error: null,
  ...over,
});

interface Harness {
  calls: Array<{ method: string; suffix: string; body?: unknown }>;
  out: string[];
  errors: string[];
  sleeps: number;
  exec(argv: string[]): Promise<void>;
}

/** A program with only the deploy commands, answering each request from `answer`. */
function harness(answer: (method: string, suffix: string, body?: unknown) => unknown): Harness {
  const h: Harness = {
    calls: [],
    out: [],
    errors: [],
    sleeps: 0,
    exec: async (argv) => {
      const program = new Command().exitOverride();
      const proposal = program.command("proposal");
      registerProposalDeploy(proposal, t, kit);
      await program.parseAsync(argv, { from: "user" });
    },
  };
  const request: ProposalRequester = async <T>(method: string, suffix: string, body?: unknown) => {
    h.calls.push({ method, suffix, ...(body !== undefined ? { body } : {}) });
    return answer(method, suffix, body) as T;
  };
  const kit: DeployKit = {
    scoped: (cmd) => cmd.option("--org-id <id>").option("--json"),
    open: async () => request,
    actorFields: () => ({ agentId: "dev1" }),
    actorQuery: () => "?agentId=dev1",
    fail: (m) => h.errors.push(m),
    print: (text) => h.out.push(`${text}\n`),
    printJson: (v) => h.out.push(`${JSON.stringify(v)}\n`),
    write: (text) => h.out.push(text),
    sleep: async () => {
      h.sleeps += 1;
    },
  };
  return h;
}

describe("penguin org proposal deploy", () => {
  it("sends the script, the proposal and the arguments after -- as they are, then follows the run to its end", async () => {
    const pages: ProposalDeployRunResponse[] = [
      { run: run(), output: "building\n", from: 0, next: 9 },
      { run: run(), output: "", from: 9, next: 9 },
      {
        run: run({ status: "succeeded", exitCode: 0 }),
        output: "pushed\n",
        from: 9,
        next: 16,
      },
    ];
    const h = harness((method) => (method === "POST" ? { run: run() } : pages.shift()));
    await h.exec([
      "proposal",
      "deploy",
      "#4",
      "--to",
      "staging",
      "--",
      "--extra-args",
      "two words",
    ]);
    expect(h.calls[0]).toEqual({
      method: "POST",
      suffix: "/deploys",
      body: {
        script: "staging",
        proposal: 4,
        args: ["--extra-args", "two words"],
        agentId: "dev1",
      },
    });
    expect(h.calls.slice(1).map((c) => c.suffix)).toEqual([
      "/deploys/r1?agentId=dev1&from=0",
      "/deploys/r1?agentId=dev1&from=9",
      "/deploys/r1?agentId=dev1&from=9",
    ]);
    expect(h.sleeps).toBe(2);
    expect(h.out.join("")).toBe(
      `${t.org.proposalDeployStarted("r1", "staging", "acme/site#11", HEAD.slice(0, 12))}\nbuilding\npushed\n${t.org.proposalDeploySucceeded("r1", HEAD.slice(0, 12))}\n`,
    );
    expect(h.errors).toEqual([]);
  });

  it("fails with the run's status, exit code and reason when the script did not succeed", async () => {
    const h = harness((method) =>
      method === "POST"
        ? { run: run() }
        : { run: run({ status: "failed", exitCode: 2 }), output: "boom\n", from: 0, next: 5 },
    );
    await h.exec(["proposal", "deploy", "4", "--to", "staging"]);
    expect((h.calls[0]!.body as { args: string[] }).args).toEqual([]);
    expect(h.errors).toEqual([t.org.proposalDeployFailed("r1", "failed", 2, null)]);
    expect(t.org.proposalDeployFailed("r1", "timed_out", null, "stopped")).toBe(
      "Deploy r1 timed out: stopped.",
    );
  });

  it("a dry run prints the plan; --json prints the answer and does not follow", async () => {
    const plan = {
      script: "staging",
      repo: "acme/site",
      pr: 11,
      prUrl: "u",
      branch: "b",
      head: HEAD,
      proposal: 4,
      argv: ["bash", "deploy.sh", "a b"],
    };
    const dry = harness(() => ({ plan }));
    await dry.exec(["proposal", "deploy", "4", "--to", "staging", "--dry-run"]);
    expect((dry.calls[0]!.body as { dryRun?: boolean }).dryRun).toBe(true);
    expect(dry.out.join("")).toBe(
      `${t.org.proposalDeployPlanned("staging", "acme/site#11", HEAD.slice(0, 12), 'bash deploy.sh "a b"')}\n`,
    );
    const json = harness(() => ({ run: run() }));
    await json.exec(["proposal", "deploy", "4", "--to", "staging", "--json"]);
    expect(json.calls).toHaveLength(1);
    expect(JSON.parse(json.out.join(""))).toEqual({ run: run() });
  });

  it("refuses a proposal number that is not one, sending nothing", async () => {
    const h = harness(() => ({}));
    await h.exec(["proposal", "deploy", "x", "--to", "staging"]);
    expect(h.calls).toEqual([]);
    expect(h.errors).toEqual([t.org.proposalNumberInvalid("x")]);
  });
});

describe("penguin org proposal deploy-script", () => {
  it("add sends the id, the command after -- and the description; ls and rm read and remove", async () => {
    const script = {
      id: "staging",
      command: ["bash", "scripts/deploy.sh", "--fast"],
      description: "the staging box",
      by: "user:boss",
      at: "2026-10-01T00:00:00.000Z",
    };
    const h = harness((method) =>
      method === "POST" ? script : method === "GET" ? { scripts: [script] } : undefined,
    );
    await h.exec([
      "proposal",
      "deploy-script",
      "add",
      "staging",
      "--description",
      "the staging box",
      "--",
      "bash",
      "scripts/deploy.sh",
      "--fast",
    ]);
    expect(h.calls[0]).toEqual({
      method: "POST",
      suffix: "/deploy-scripts",
      body: {
        id: "staging",
        command: ["bash", "scripts/deploy.sh", "--fast"],
        description: "the staging box",
        agentId: "dev1",
      },
    });
    expect(h.out[0]).toBe(
      `${t.org.deployScriptAdded("staging", "bash scripts/deploy.sh --fast")}\n`,
    );
    await h.exec(["proposal", "deploy-script", "ls"]);
    expect(h.calls[1]!.suffix).toBe("/deploy-scripts?agentId=dev1");
    expect(h.out[1]).toContain("bash scripts/deploy.sh --fast");
    await h.exec(["proposal", "deploy-script", "rm", "staging"]);
    expect(h.calls[2]).toEqual({
      method: "DELETE",
      suffix: "/deploy-scripts/staging?agentId=dev1",
    });
    expect(h.out[2]).toBe(`${t.org.deployScriptRemoved("staging")}\n`);
  });

  it("ls says how to register one when there is none", async () => {
    const h = harness(() => ({ scripts: [] }));
    await h.exec(["proposal", "deploy-script", "ls"]);
    expect(h.out).toEqual([`${t.org.deployScriptNone}\n`]);
  });
});

describe("argvLine", () => {
  it("quotes only what a reader would misread", () => {
    expect(argvLine(["bash", "a b", "", "$X", "plain"])).toBe('bash "a b" "" "$X" plain');
  });
});

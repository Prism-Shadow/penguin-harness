/**
 * A stub {@link DeployKit} for the commands over the organization's `…/actions` and
 * `…/proposals` routes: every request is recorded and answered by `answer`, and what the
 * commands print, fail with and exit with is collected.
 */
import { Command } from "commander";
import type { DeployKit, ProposalRequester } from "../src/commands/proposal-deploy.js";

export interface Harness {
  calls: Array<{ method: string; suffix: string; body?: unknown }>;
  out: string[];
  errors: string[];
  exits: number[];
  sleeps: number;
  exec(argv: string[]): Promise<void>;
}

/** A program the `register` commands are mounted on, answering each request from `answer`. */
export function harness(
  register: (program: Command, kit: DeployKit) => void,
  answer: (method: string, suffix: string, body?: unknown) => unknown,
): Harness {
  const h: Harness = {
    calls: [],
    out: [],
    errors: [],
    exits: [],
    sleeps: 0,
    exec: async (argv) => {
      const program = new Command().exitOverride();
      register(program, kit);
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
    openActions: async () => request,
    openWorkflows: async () => request,
    actorFields: () => ({ agentId: "dev1" }),
    actorQuery: () => "?agentId=dev1",
    fail: (m) => h.errors.push(m),
    exit: (code) => h.exits.push(code),
    print: (text) => h.out.push(`${text}\n`),
    printJson: (v) => h.out.push(`${JSON.stringify(v)}\n`),
    write: (text) => h.out.push(text),
    sleep: async () => {
      h.sleeps += 1;
    },
  };
  return h;
}

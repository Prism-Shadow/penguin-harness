/**
 * `penguin org proposal deploy`: the core sequence with the process runner and the version
 * read replaced by recorders — which programs run, in which directory, in which order, what
 * stops the run, and what counts as the target running the head.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deployProposal,
  parseImplPr,
  plaintextProblem,
  revisionNames,
  targetUrl,
  type DeployOptions,
  type Run,
} from "../src/commands/proposal-deploy.js";

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const CHECKOUT = "/work/penguin-harness";
const TREE = path.join(CHECKOUT, ".worktrees", `deploy-${HEAD.slice(0, 12)}`);
const PR = "https://github.com/acme/penguin-harness/pull/42";

interface Call {
  command: string;
  args: string[];
  cwd: string;
}

/** A runner that records every call and answers git's questions; `failOn` makes the matching call exit 1. */
function recorder(failOn?: (c: Call) => boolean): { run: Run; calls: Call[] } {
  const calls: Call[] = [];
  const run: Run = async (command, args, opts) => {
    const call = { command, args, cwd: opts.cwd };
    calls.push(call);
    if (failOn?.(call) === true) return { code: 1, stdout: "" };
    if (args.includes("--show-toplevel")) return { code: 0, stdout: `${CHECKOUT}\n` };
    if (args.includes("rev-parse")) return { code: 0, stdout: `${HEAD}\n` };
    return { code: 0, stdout: "" };
  };
  return { run, calls };
}

function options(over: Partial<DeployOptions> & { run: Run }): DeployOptions {
  return {
    proposal: { number: 7, implPrUrl: PR },
    to: "53531",
    cwd: path.join(CHECKOUT, "packages", "cli"),
    dryRun: false,
    env: { PENGUIN_ADMIN_PASSWORD: "secret-value" },
    readRevision: async () => `v0.2.13-500-g${HEAD.slice(0, 9)}`,
    node: "/opt/node24/bin/node",
    log: () => {},
    ...over,
  };
}

/** One call as a readable line, for order assertions. */
const line = (c: Call): string => `${c.command} ${c.args.join(" ")}`;

describe("resolves a proposal to its impl PR head and plans the push", () => {
  it("parses the impl PR, the target and the plaintext rule", () => {
    expect(parseImplPr(PR)).toEqual({
      repoUrl: "https://github.com/acme/penguin-harness.git",
      pull: 42,
    });
    expect(parseImplPr("https://gitlab.com/acme/x/-/merge_requests/1")).toBeNull();
    expect(targetUrl("53531")).toBe("http://127.0.0.1:53531");
    expect(targetUrl("https://box.example.com/")).toBe("https://box.example.com");
    expect(plaintextProblem("http://127.0.0.1:53531")).toBeNull();
    expect(plaintextProblem("https://box.example.com")).toBeNull();
    expect(plaintextProblem("http://box.example.com")).toMatch(/plaintext/);
  });

  it.each([
    ["no impl PR", { proposal: { number: 7, implPrUrl: null } }, /no impl PR/],
    [
      "an impl PR that is not a GitHub PR",
      { proposal: { number: 7, implPrUrl: "https://x.test/1" } },
      /not a GitHub/,
    ],
    ["a plaintext remote target", { to: "http://box.example.com" }, /plaintext/],
    ["no credential", { env: {} }, /PENGUIN_ADMIN_PASSWORD or PENGUIN_API_TOKEN/],
  ])("refuses %s before running anything", async (_name, over, reason) => {
    const { run, calls } = recorder();
    const outcome = await deployProposal(options({ run, ...over }));
    expect(outcome).toMatchObject({ ok: false });
    expect(outcome.ok ? "" : outcome.reason).toMatch(reason);
    expect(calls).toEqual([]);
  });

  it("a dry run fetches and names the head, and builds and pushes nothing", async () => {
    const { run, calls } = recorder();
    let read = 0;
    const outcome = await deployProposal(
      options({ run, dryRun: true, env: {}, readRevision: async () => (read++, null) }),
    );
    expect(outcome).toEqual({ ok: true, head: HEAD, revision: null, dryRun: true });
    expect(calls.map(line)).toEqual([
      `git -C ${path.join(CHECKOUT, "packages", "cli")} rev-parse --show-toplevel`,
      `git -C ${CHECKOUT} fetch --no-tags https://github.com/acme/penguin-harness.git refs/pull/42/head`,
      `git -C ${CHECKOUT} rev-parse --verify FETCH_HEAD^{commit}`,
    ]);
    expect(read).toBe(0);
  });
});

describe("builds the head in a throwaway worktree and runs that generation's deploy", () => {
  it("runs fetch, worktree, install, build and the worktree's deploy.mjs in order, then removes the worktree", async () => {
    const { run, calls } = recorder();
    const outcome = await deployProposal(options({ run }));
    expect(outcome).toMatchObject({ ok: true, head: HEAD, dryRun: false });
    expect(calls.slice(1).map((c) => [line(c), c.cwd])).toEqual([
      [
        `git -C ${CHECKOUT} fetch --no-tags https://github.com/acme/penguin-harness.git refs/pull/42/head`,
        CHECKOUT,
      ],
      [`git -C ${CHECKOUT} rev-parse --verify FETCH_HEAD^{commit}`, CHECKOUT],
      [`git -C ${CHECKOUT} worktree add --detach ${TREE} ${HEAD}`, CHECKOUT],
      ["pnpm install --frozen-lockfile", TREE],
      ["pnpm -r build", TREE],
      ["/opt/node24/bin/node scripts/deploy.mjs 53531", TREE],
      [`git -C ${CHECKOUT} worktree remove --force ${TREE}`, CHECKOUT],
    ]);
    // The credential reaches deploy.mjs through the environment only.
    expect(calls.flatMap((c) => c.args).join(" ")).not.toContain("secret-value");
  });

  it.each([
    ["pnpm install", (c: Call) => c.args[0] === "install", /pnpm install/],
    ["the build", (c: Call) => c.args[0] === "-r", /pnpm -r build/],
    ["deploy.mjs", (c: Call) => c.args[0] === "scripts/deploy.mjs", /deploy\.mjs failed/],
  ])("stops when %s fails and still removes the worktree", async (_name, failOn, reason) => {
    const { run, calls } = recorder(failOn);
    let read = 0;
    const outcome = await deployProposal(
      options({ run, readRevision: async () => (read++, null) }),
    );
    expect(outcome.ok ? "" : outcome.reason).toMatch(reason);
    expect(line(calls[calls.length - 1]!)).toBe(
      `git -C ${CHECKOUT} worktree remove --force ${TREE}`,
    );
    const failedAt = calls.findIndex(failOn);
    expect(calls.slice(failedAt + 1, -1)).toEqual([]);
    expect(read).toBe(0);
  });

  it("stops before building when the fetch fails", async () => {
    const { run, calls } = recorder((c) => c.args.includes("fetch"));
    const outcome = await deployProposal(options({ run }));
    expect(outcome.ok ? "" : outcome.reason).toMatch(/could not fetch refs\/pull\/42\/head/);
    expect(calls.map(line).some((l) => l.includes("worktree"))).toBe(false);
  });
});

describe("confirms the target now runs the head", () => {
  it("accepts a describe-form or bare-sha revision naming the head, never a dirty one", () => {
    expect(revisionNames(`v0.2.13-500-g${HEAD.slice(0, 9)}`, HEAD)).toBe(true);
    expect(revisionNames(HEAD, HEAD)).toBe(true);
    expect(revisionNames(`v0.2.13-500-g${HEAD.slice(0, 9)}-dirty`, HEAD)).toBe(false);
    expect(revisionNames("v0.2.13-500-gfedcba987", HEAD)).toBe(false);
  });

  it("fails and prints both revisions when the target still reports another one", async () => {
    const { run } = recorder();
    const outcome = await deployProposal(
      options({ run, readRevision: async () => "v0.2.13-466-ge5fb8f261" }),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? "" : outcome.reason).toContain("v0.2.13-466-ge5fb8f261");
    expect(outcome.ok ? "" : outcome.reason).toContain(HEAD);
  });

  it("fails when the target records no revision", async () => {
    const { run } = recorder();
    const outcome = await deployProposal(options({ run, readRevision: async () => null }));
    expect(outcome.ok ? "" : outcome.reason).toMatch(/no revision/);
  });
});

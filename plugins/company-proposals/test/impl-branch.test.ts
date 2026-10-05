/**
 * The impl branch without a server: a `<remote, branch>` side is checked, a declared remote
 * resolves through the repository's GitHub remotes or as `owner/repo` written out, a PR's head
 * and base are read off GitHub, and GitHub's comparison becomes the patch — with a stand-in `gh`.
 */
import { describe, expect, it } from "vitest";
import {
  COMPARE_FILE_LIMIT,
  ImplBranchError,
  branchLinkOf,
  branchRefOf,
  branchTip,
  compareBranches,
  readPullBranches,
  remoteFor,
  resolveRef,
  sameRef,
} from "../src/impl-branch.js";
import type { RunGh } from "../src/pr-status.js";
import { remotesOf } from "../src/config.js";

const REMOTES = [
  { name: "origin", repo: "acme/site" },
  { name: "fork", repo: "me/site" },
];

function refusal(run: () => unknown): { status: number; code: string } {
  try {
    run();
  } catch (err) {
    if (err instanceof ImplBranchError) return { status: err.status, code: err.code };
    throw err;
  }
  throw new Error("expected a refusal");
}

async function refusalAsync(
  run: () => Promise<unknown>,
): Promise<{ status: number; code: string }> {
  try {
    await run();
  } catch (err) {
    if (err instanceof ImplBranchError) return { status: err.status, code: err.code };
    throw err;
  }
  throw new Error("expected a refusal");
}

/** A `gh` that answers by API path, recording each path asked. */
function fakeGh(answers: Record<string, unknown>): { gh: RunGh; asked: string[] } {
  const asked: string[] = [];
  const gh: RunGh = async (args) => {
    const p = args[1]!;
    asked.push(p);
    if (!(p in answers)) throw new Error(`HTTP 404: ${p}`);
    return JSON.stringify(answers[p]);
  };
  return { gh, asked };
}

describe("branchRefOf", () => {
  it("takes a remote name or owner/repo and a branch name, trimmed", () => {
    expect(branchRefOf({ remote: " origin ", branch: "feat/x " }, "head")).toEqual({
      remote: "origin",
      branch: "feat/x",
    });
    expect(branchRefOf({ remote: "acme/site", branch: "main" }, "base")).toEqual({
      remote: "acme/site",
      branch: "main",
    });
  });

  it("refuses an empty, dotted, spaced, leading-dash or over-long name with a 400 naming the field", () => {
    const bad: Array<[unknown, string]> = [
      [{ remote: "", branch: "x" }, "head.remote"],
      [{ remote: "origin", branch: "" }, "head.branch"],
      [{ remote: "origin", branch: "a..b" }, "head.branch"],
      [{ remote: "origin", branch: "a b" }, "head.branch"],
      [{ remote: "origin", branch: "-x" }, "head.branch"],
      [{ remote: "origin", branch: "x/" }, "head.branch"],
      [{ remote: "origin", branch: "x".repeat(201) }, "head.branch"],
      [{ remote: "a b", branch: "x" }, "head.remote"],
      [{ remote: "../x", branch: "x" }, "head.remote"],
      [null, "head.remote"],
    ];
    for (const [raw, field] of bad) {
      expect(refusal(() => branchRefOf(raw, "head"))).toEqual({ status: 400, code: "bad_request" });
      try {
        branchRefOf(raw, "head");
      } catch (err) {
        expect((err as Error).message).toContain(field);
      }
    }
  });
});

describe("resolving a side", () => {
  it("resolves a declared remote through git remote -v, owner/repo as written, and refuses an unknown one", () => {
    expect(resolveRef({ remote: "fork", branch: "feat/x" }, REMOTES, "head")).toEqual({
      remote: "fork",
      repo: "me/site",
      branch: "feat/x",
    });
    expect(resolveRef({ remote: "up/site", branch: "main" }, REMOTES, "base")).toEqual({
      remote: "up/site",
      repo: "up/site",
      branch: "main",
    });
    expect(refusal(() => resolveRef({ remote: "nowhere", branch: "x" }, REMOTES, "head"))).toEqual({
      status: 400,
      code: "impl_remote_unknown",
    });
    expect(refusal(() => resolveRef({ remote: "origin", branch: "x" }, [], "head"))).toEqual({
      status: 400,
      code: "impl_remote_unknown",
    });
  });

  it("names a PR's side by a remote pointing at its repository, preferring the one asked for", () => {
    expect(remoteFor("acme/site", REMOTES)).toBe("origin");
    expect(remoteFor("ACME/Site", [...REMOTES, { name: "up", repo: "acme/site" }], "up")).toBe(
      "up",
    );
    expect(remoteFor("other/site", REMOTES)).toBe("other/site");
  });

  it("compares repositories written out case-insensitively, remote names as written", () => {
    expect(
      sameRef({ remote: "Acme/Site", branch: "x" }, { remote: "acme/site", branch: "x" }),
    ).toBe(true);
    expect(sameRef({ remote: "origin", branch: "x" }, { remote: "Origin", branch: "x" })).toBe(
      false,
    );
    expect(sameRef({ remote: "origin", branch: "x" }, { remote: "origin", branch: "y" })).toBe(
      false,
    );
  });
});

describe("reading GitHub", () => {
  it("reads a PR's head and base, refusing a URL that is not a PR and answering 502 when GitHub does not", async () => {
    const { gh } = fakeGh({
      "repos/acme/site/pulls/9": {
        head_repo: "me/site",
        head: "feat/x",
        sha: "A".repeat(40),
        base_repo: "acme/site",
        base: "main",
      },
      "repos/acme/site/pulls/10": {
        head_repo: null,
        head: "gone",
        sha: "a",
        base_repo: "acme/site",
        base: "main",
      },
    });
    expect(await readPullBranches(gh, "https://github.com/acme/site/pull/9")).toEqual({
      head: { repo: "me/site", branch: "feat/x", sha: "a".repeat(40) },
      base: { repo: "acme/site", branch: "main" },
    });
    expect(await refusalAsync(() => readPullBranches(gh, "https://example.com/x"))).toEqual({
      status: 400,
      code: "bad_request",
    });
    expect(
      await refusalAsync(() => readPullBranches(gh, "https://github.com/acme/site/pull/10")),
    ).toEqual({ status: 502, code: "pr_unreadable" });
    expect(
      await refusalAsync(() => readPullBranches(gh, "https://github.com/acme/site/pull/11")),
    ).toEqual({ status: 502, code: "pr_unreadable" });
  });

  it("reads a branch tip, the branch's slashes kept as path segments", async () => {
    const { gh, asked } = fakeGh({ "repos/acme/site/branches/feat/x": "B".repeat(40) });
    expect(await branchTip(gh, "acme/site", "feat/x")).toBe("b".repeat(40));
    expect(asked).toEqual(["repos/acme/site/branches/feat/x"]);
    expect(await refusalAsync(() => branchTip(gh, "acme/site", "nope"))).toEqual({
      status: 502,
      code: "branch_unreadable",
    });
  });

  it("turns GitHub's comparison into the patch — on a fork the head is owner:branch", async () => {
    const head = { remote: "fork", repo: "me/site", branch: "feat/x" };
    const base = { remote: "origin", repo: "acme/site", branch: "main" };
    const { gh, asked } = fakeGh({
      "repos/me/site/branches/feat/x": "c".repeat(40),
      "repos/acme/site/compare/main...me:feat/x": {
        merge_base: "d".repeat(40),
        ahead: 2,
        behind: 1,
        url: "https://github.com/acme/site/compare/main...me:feat/x",
        files: [
          {
            filename: "a.ts",
            status: "modified",
            additions: 3,
            deletions: 1,
            patch: "@@ -1 +1 @@",
          },
          {
            filename: "b.ts",
            status: "renamed",
            additions: 0,
            deletions: 0,
            previous_filename: "old.ts",
          },
        ],
      },
    });
    const diff = await compareBranches(gh, base, head, "https://github.com/acme/site/pull/9");
    expect(asked).toContain("repos/acme/site/compare/main...me:feat/x");
    expect(diff).toEqual({
      head,
      base,
      headSha: "c".repeat(40),
      mergeBase: "d".repeat(40),
      ahead: 2,
      behind: 1,
      files: [
        {
          path: "a.ts",
          status: "modified",
          from: null,
          additions: 3,
          deletions: 1,
          patch: "@@ -1 +1 @@",
        },
        {
          path: "b.ts",
          status: "renamed",
          from: "old.ts",
          additions: 0,
          deletions: 0,
          patch: null,
        },
      ],
      truncated: false,
      compareUrl: "https://github.com/acme/site/compare/main...me:feat/x",
      pr: "https://github.com/acme/site/pull/9",
    });
  });

  it("marks a comparison at GitHub's file limit as truncated, and answers 502 when it cannot compare", async () => {
    const side = { remote: "origin", repo: "acme/site", branch: "main" };
    const head = { ...side, branch: "feat/y" };
    const files = Array.from({ length: COMPARE_FILE_LIMIT }, (_, i) => ({
      filename: `f${i}.ts`,
      status: "added",
      additions: 1,
      deletions: 0,
    }));
    const { gh } = fakeGh({
      "repos/acme/site/branches/feat/y": "e".repeat(40),
      "repos/acme/site/compare/main...feat/y": {
        merge_base: "f".repeat(40),
        ahead: 1,
        behind: 0,
        files,
      },
    });
    const diff = await compareBranches(gh, side, head, null);
    expect(diff.truncated).toBe(true);
    expect(diff.compareUrl).toBe("https://github.com/acme/site/compare/main...feat/y");
    const broken = fakeGh({ "repos/acme/site/branches/feat/y": "e".repeat(40) });
    expect(await refusalAsync(() => compareBranches(broken.gh, side, head, null))).toEqual({
      status: 502,
      code: "compare_unreadable",
    });
  });
});

describe("a side's branch page", () => {
  const ORIGINS = [{ name: "origin", repo: "acme/site-mirror" }];

  it("links owner/repo as written, with each branch segment encoded", () => {
    expect(branchLinkOf({ remote: "me/site", branch: "feat/a#b" }, [], [])).toEqual({
      url: "https://github.com/me/site/tree/feat/a%23b",
      unresolved: null,
    });
  });

  it("resolves a remote name through the workspace's GitHub remotes, https or ssh", () => {
    const remotes = remotesOf(
      [
        "origin\thttps://github.com/acme/site.git (fetch)",
        "fork\tgit@github.com:me/site.git (fetch)",
      ].join("\n"),
    );
    expect(branchLinkOf({ remote: "origin", branch: "main" }, [], remotes).url).toBe(
      "https://github.com/acme/site/tree/main",
    );
    expect(branchLinkOf({ remote: "fork", branch: "feat/x" }, [], remotes).url).toBe(
      "https://github.com/me/site/tree/feat/x",
    );
  });

  it("takes the recorded repository first, the origins setting only when none was recorded", () => {
    // Recorded at registration: the link names the repository the patch view reads.
    expect(branchLinkOf({ remote: "origin", branch: "main" }, ORIGINS, REMOTES).url).toBe(
      "https://github.com/acme/site/tree/main",
    );
    // Nothing recorded: the origins setting answers.
    expect(branchLinkOf({ remote: "origin", branch: "main" }, ORIGINS, []).url).toBe(
      "https://github.com/acme/site-mirror/tree/main",
    );
    // owner/repo written out is never looked up.
    expect(branchLinkOf({ remote: "acme/site", branch: "main" }, ORIGINS, []).url).toBe(
      "https://github.com/acme/site/tree/main",
    );
  });

  it("gives a reason, not a link, for an unknown remote or one off GitHub", () => {
    const unknown = branchLinkOf({ remote: "upstream", branch: "main" }, ORIGINS, REMOTES);
    expect(unknown.url).toBeNull();
    expect(unknown.unresolved).toContain("upstream");
    const offGithub = remotesOf("gl\thttps://gitlab.com/acme/site.git (fetch)");
    const gitlab = branchLinkOf({ remote: "gl", branch: "main" }, [], offGithub);
    expect(gitlab).toEqual({ url: null, unresolved: expect.stringContaining("GitHub") });
  });
});

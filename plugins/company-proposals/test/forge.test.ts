/**
 * The Forge adapters. `github` turns a change request URL into its repository and number and
 * back, reads change requests through `gh api graphql` in batches — the open list page by page,
 * the merged or closed ones on several branches in one query, several numbers in one query —
 * and answers whether one landed on its default branch. `none` has no change requests and does
 * not know whether anything is merged.
 */
import { describe, expect, it } from "vitest";
import { GithubForge, NoForge } from "../src/index.js";
import type { RunGh } from "../src/pr-status.js";

const node = (number: number, fields: Record<string, unknown> = {}) => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/acme/site/pull/${number}`,
  isDraft: false,
  state: "OPEN",
  headRefName: `feat/${number}`,
  headRefOid: "A".repeat(40),
  baseRefName: "dev",
  closedAt: null,
  baseRepository: { defaultBranchRef: { name: "main" } },
  ...fields,
});

function fakeGh(answer: (query: string) => unknown): { gh: RunGh; queries: string[] } {
  const queries: string[] = [];
  const gh: RunGh = async (args) => {
    expect(args.slice(0, 3)).toEqual(["api", "graphql", "-f"]);
    const query = args[3]!.replace(/^query=/, "");
    queries.push(query);
    return JSON.stringify(answer(query));
  };
  return { gh, queries };
}

describe("GithubForge", () => {
  it("parses a pull request URL and builds it back", () => {
    const forge = new GithubForge(async () => "{}");
    const parsed = forge.parseUrl("https://github.com/Acme/site/pull/12#issuecomment-1");
    expect(parsed).toEqual({ repo: "Acme/site", number: 12 });
    expect(forge.parseUrl(forge.webUrl(parsed!.repo, parsed!.number))).toEqual(parsed);
    expect(forge.parseUrl("https://gitlab.com/a/b/-/merge_requests/1")).toBeNull();
  });

  it("reads the open list page by page, and orders each answer as a change request", async () => {
    let page = 0;
    const { gh, queries } = fakeGh(() => {
      page++;
      return {
        data: {
          repository: {
            pullRequests: {
              nodes: page === 1 ? [node(1), node(2, { isDraft: true })] : [node(3)],
              pageInfo: { hasNextPage: page === 1, endCursor: "c1" },
            },
          },
        },
      };
    });
    const out = await new GithubForge(gh).listChangeRequests({ repo: "acme/site", open: true });
    expect(out.map((c) => [c.number, c.state, c.draft, c.branch, c.base])).toEqual([
      [1, "open", false, "feat/1", "dev"],
      [2, "open", true, "feat/2", "dev"],
      [3, "open", false, "feat/3", "dev"],
    ]);
    expect(out[0]).toMatchObject({ repo: "acme/site", head: "a".repeat(40), defaultBranch: "main" });
    expect(queries).toHaveLength(2);
    expect(queries[1]).toContain('after: "c1"');
  });

  it("asks several branches, or several numbers, in one query", async () => {
    const { gh, queries } = fakeGh((q) =>
      q.includes("headRefName:")
        ? {
            data: {
              repository: {
                b0: { nodes: [node(21, { state: "CLOSED", headRefName: "feat/old" })] },
                b1: { nodes: [node(22, { state: "MERGED", headRefName: "feat/done" })] },
              },
            },
          }
        : { data: { repository: { n5: node(5, { state: "MERGED" }), n6: null } } },
    );
    const forge = new GithubForge(gh);
    const shut = await forge.listChangeRequests({ repo: "acme/site", shutOn: ["feat/old", "feat/done"] });
    expect(shut.map((c) => [c.number, c.state, c.branch])).toEqual([
      [21, "closed", "feat/old"],
      [22, "merged", "feat/done"],
    ]);
    const byNumber = await forge.listChangeRequests({ repo: "acme/site", numbers: [5, 6] });
    expect(byNumber.map((c) => [c.number, c.state])).toEqual([[5, "merged"]]);
    expect(queries).toHaveLength(2);
    expect(queries[1]).toContain("n5: pullRequest(number: 5)");
  });

  it("refuses a repository name GitHub would not accept, without running gh", async () => {
    const { gh, queries } = fakeGh(() => ({}));
    await expect(
      new GithubForge(gh).listChangeRequests({ repo: "acme/site; rm", open: true }),
    ).rejects.toThrow("not a GitHub repository name");
    expect(queries).toEqual([]);
  });

  it("answers whether a change request landed on its default branch, and null when it cannot say", async () => {
    let base = "dev";
    const { gh } = fakeGh(() => ({
      data: { repository: { n9: node(9, { state: "MERGED", baseRefName: base }) } },
    }));
    const forge = new GithubForge(gh);
    const url = "https://github.com/acme/site/pull/9";
    expect(await forge.isMerged(url)).toEqual({
      status: "merged",
      base: "dev",
      defaultBranch: "main",
      landed: false,
    });
    base = "main";
    expect(await forge.isMerged(url)).toMatchObject({ landed: true });
    expect(await forge.isMerged("https://example.com/x")).toBeNull();
    const failing = new GithubForge(async () => {
      throw new Error("HTTP 502");
    });
    expect(await failing.isMerged(url)).toBeNull();
  });
});

describe("NoForge", () => {
  it("has no change requests and does not know whether anything is merged", async () => {
    const forge = new NoForge();
    expect(await forge.listChangeRequests()).toEqual([]);
    expect(forge.parseUrl()).toBeNull();
    expect(await forge.isMerged()).toBeNull();
  });
});

/**
 * dirToCommit: what the workspace picker's "Use this dir" button commits.
 *
 * The case this file exists for is the first one: a path typed into the box and never
 * committed with Enter. Clicking the button blurs the box, whose commit is still in flight
 * when the click lands, and the button used to read the directory already LISTED — the
 * server's home directory on a fresh picker — so the chip and the Session built from it
 * named a directory the person had just typed over, with nothing on screen saying so.
 */
import { describe, expect, it } from "vitest";
import { dirToCommit } from "../src/features/chat/workspace-pick";

const HOME = "/home/qa";

describe("dirToCommit — the path box wins over the listing", () => {
  it("resolves a typed path that was never committed, instead of the listed directory", () => {
    expect(dirToCommit("/home/qa/work/demo", HOME)).toEqual({
      kind: "typed",
      path: "/home/qa/work/demo",
    });
  });

  it("trims the typed path before comparing and resolving it", () => {
    expect(dirToCommit("  /srv/data \n", HOME)).toEqual({ kind: "typed", path: "/srv/data" });
  });

  it("takes a typed path even before anything is listed (the first load failed)", () => {
    expect(dirToCommit("/srv/data", undefined)).toEqual({ kind: "typed", path: "/srv/data" });
  });
});

describe("dirToCommit — nothing typed over the listing", () => {
  it("uses the listed directory as is when the box still shows it", () => {
    expect(dirToCommit(HOME, HOME)).toEqual({ kind: "listed", path: HOME });
  });

  it("uses the listed directory when the box was cleared", () => {
    expect(dirToCommit("   ", HOME)).toEqual({ kind: "listed", path: HOME });
  });

  it("has nothing to commit with no listing and an empty box", () => {
    expect(dirToCommit("", undefined)).toBeNull();
  });
});

/**
 * The company app draft's job list, where one conversation is one job.
 *
 * - Given a job that is not waiting itself but has a sub-session waiting for an approval, the
 *   job is listed under Waiting on you; a job with a running sub-session and nothing waiting is
 *   In progress; a job with nothing running or waiting is Done. Every job is listed exactly once.
 * - Given a running job with running sub-sessions, when the user stops it, then it and its
 *   sub-sessions settle and move to Done; no other job changes.
 * - Given a sub-session waiting for an approval, when the user stops only that sub-session, then
 *   its parent leaves Waiting on you but keeps running.
 * - The app's location: an unknown path opens the job list, and the new-organization page
 *   round-trips.
 */
import { describe, expect, it } from "vitest";
import { demoOrgs } from "../src/company/fixtures";
import { routeOf } from "../src/company/frame";
import { GROUPS, groupOf, jobsIn, stop } from "../src/company/model";
import type { Job, Org } from "../src/company/model";

const org = (): Org => demoOrgs("en")[0]!;

const job = (overrides: Partial<Job>): Job => ({
  session: "s",
  title: "t",
  member: "lead",
  running: false,
  approvals: 0,
  time: "now",
  ...overrides,
});

const sessions = (o: Org, group: (typeof GROUPS)[number]) => jobsIn(o, group).map((j) => j.session);

describe("the company app's job list", () => {
  it("files a job by what it and its sub-sessions are doing, each job once", () => {
    const parent = job({
      session: "p",
      children: [
        job({ session: "a", running: true }),
        job({ session: "b", children: [job({ session: "c", running: true, approvals: 1 })] }),
      ],
    });
    expect(groupOf(parent)).toBe("waiting");
    expect(groupOf(job({ children: [job({ running: true })] }))).toBe("running");
    expect(groupOf(job({}))).toBe("done");
    const o = org();
    const listed = GROUPS.flatMap((g) => sessions(o, g));
    expect([...listed].sort()).toEqual(o.jobs.map((j) => j.session).sort());
  });

  it("settles a stopped job with its sub-sessions and leaves the others alone", () => {
    const before = org();
    const waiting = jobsIn(before, "waiting")[0]!;
    const after = stop(before, waiting.session);
    const stopped = after.jobs.find((j) => j.session === waiting.session)!;
    expect(groupOf(stopped)).toBe("done");
    expect(stopped.children?.every((c) => !c.running && c.approvals === 0)).toBe(true);
    expect(after.jobs.filter((j) => j.session !== waiting.session)).toEqual(
      before.jobs.filter((j) => j.session !== waiting.session),
    );
  });

  it("moves a job out of Waiting on you when its waiting sub-session is stopped", () => {
    const before = org();
    const parent = jobsIn(before, "waiting")[0]!;
    const asking = parent.children!.find((c) => c.approvals > 0)!;
    const after = stop(before, asking.session);
    const moved = after.jobs.find((j) => j.session === parent.session)!;
    expect(groupOf(moved)).toBe("running");
    expect(sessions(after, "waiting")).not.toContain(parent.session);
  });
});

describe("the company app's location", () => {
  it("opens the job list for an unknown path and round-trips the new-organization page", () => {
    expect(routeOf("/nowhere")).toBe("/");
    expect(routeOf("/new")).toBe("/new");
  });
});

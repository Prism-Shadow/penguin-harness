export interface Member {
  id: string;
  name: string;
  agent: string;
  lead?: true;
}

export type JobSource = "you" | "schedule";

export interface Job {
  session: string;
  title: string;
  member: string;
  running: boolean;
  approvals: number;
  time: string;
  source?: JobSource;
  children?: readonly Job[];
}

export interface Org {
  id: string;
  name: string;
  goal: string;
  members: readonly Member[];
  jobs: readonly Job[];
}

export type Group = "waiting" | "running" | "done";

export const GROUPS: readonly Group[] = ["waiting", "running", "done"];

function family(job: Job): readonly Job[] {
  return [job, ...(job.children ?? []).flatMap(family)];
}

export function groupOf(job: Job): Group {
  const all = family(job);
  if (all.some((one) => one.approvals > 0)) return "waiting";
  if (all.some((one) => one.running)) return "running";
  return "done";
}

export function jobsIn(org: Org, group: Group): readonly Job[] {
  return org.jobs.filter((job) => groupOf(job) === group);
}

export function memberById(org: Org, id: string): Member | undefined {
  return org.members.find((member) => member.id === id);
}

function settled(job: Job): Job {
  return {
    ...job,
    running: false,
    approvals: 0,
    ...(job.children === undefined ? {} : { children: job.children.map(settled) }),
  };
}

function stopIn(jobs: readonly Job[], session: string): readonly Job[] {
  return jobs.map((job) => {
    if (job.session === session) return settled(job);
    if (job.children === undefined) return job;
    return { ...job, children: stopIn(job.children, session) };
  });
}

export function stop(org: Org, session: string): Org {
  return { ...org, jobs: stopIn(org.jobs, session) };
}

import { useState } from "react";
import { FolderSection, ICONS, Pill, SessionRow, toastSuccess } from "@prismshadow/penguin-ui";
import type { RowActionItem } from "@prismshadow/penguin-ui";
import { useCompanyApp } from "./context";
import { sessionPath } from "./fixtures";
import { navigateHost } from "./frame";
import { GROUPS, jobsIn, memberById } from "./model";
import type { Group, Job } from "./model";

function JobRow({ job, nested = false }: { job: Job; nested?: boolean }) {
  const { w, org, stop } = useCompanyApp();
  const member = memberById(org, job.member);
  const waiting = job.approvals > 0;
  const actions: RowActionItem[] = [
    {
      id: "copy",
      label: w.jobs.copyId,
      glyph: ICONS.copy,
      onSelect: () => {
        void navigator.clipboard?.writeText(job.session).then(
          () => toastSuccess(w.jobs.copied),
          () => undefined,
        );
      },
    },
    ...(job.running
      ? [
          {
            id: "stop",
            label: w.jobs.stop,
            glyph: ICONS.stopCircle,
            danger: true,
            separated: true,
            onSelect: () => {
              stop(job.session);
              toastSuccess(w.jobs.stopped(job.title));
            },
          },
        ]
      : []),
  ];
  return (
    <>
      <SessionRow
        sessionId={job.session}
        renderTitle={(className) => (
          <span className={`${className} flex items-center gap-2`}>
            <span className="min-w-0 truncate">{job.title}</span>
            {member !== undefined && (
              <span className="shrink-0 text-xs text-fg-subtle">{member.name}</span>
            )}
            {waiting && (
              <Pill tone="attention" tooltip={w.jobs.approvalHint(job.approvals)}>
                {w.jobs.waitingApproval}
              </Pill>
            )}
          </span>
        )}
        {...(member !== undefined ? { agent: { id: member.agent, name: member.name } } : {})}
        {...(job.source === "schedule"
          ? { sourceGlyph: ICONS.calendar, sourceLabel: w.jobs.scheduled }
          : {})}
        activity={job.running && !waiting ? { state: "running", label: w.jobs.running } : null}
        time={job.time}
        hoverActions={[]}
        menuActions={actions}
        moreLabel={w.jobs.more}
        onOpen={() => navigateHost(sessionPath(job.session))}
      />
      {job.children !== undefined && job.children.length > 0 && (
        <li>
          <ul className={`space-y-px border-l border-line-muted ${nested ? "ml-3" : "ml-4"} pl-2`}>
            {job.children.map((child) => (
              <JobRow key={child.session} job={child} nested />
            ))}
          </ul>
        </li>
      )}
    </>
  );
}

function JobGroup({ group }: { group: Group }) {
  const { w, org } = useCompanyApp();
  const [open, setOpen] = useState(true);
  const list = jobsIn(org, group);
  if (list.length === 0) return null;
  return (
    <FolderSection
      label={w.jobs.groups[group](list.length)}
      open={open}
      onToggle={() => setOpen(!open)}
    >
      <ul className="space-y-px">
        {list.map((job) => (
          <JobRow key={job.session} job={job} />
        ))}
      </ul>
    </FolderSection>
  );
}

export function JobsPage() {
  const { w, org } = useCompanyApp();
  if (org.jobs.length === 0)
    return <p className="px-2.5 py-6 text-center text-sm text-fg-muted">{w.jobs.empty}</p>;
  return (
    <div className="space-y-2">
      {GROUPS.map((group) => (
        <JobGroup key={group} group={group} />
      ))}
    </div>
  );
}

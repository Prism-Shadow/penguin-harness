import { useState } from "react";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { AgentAvatar, GlyphIcon, ICON_SIZE, ICONS, Input, Modal } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { agentDisplayName } from "../../state/project";
import { pillClass } from "../chat/workspace-select";
import { employeesLast } from "./agent-employment";

/** A searchable Agent chooser; the dialog owns its background, scroll and focus. */
export function AgentSelect({
  agents,
  selected,
  onSelect,
  empty,
}: {
  agents: AgentSummary[];
  selected: AgentSummary | null;
  onSelect: (agent: AgentSummary) => void;
  empty: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const visible = employeesLast(agents).filter((agent) =>
    [agentDisplayName(agent), agent.agentId, agent.description ?? ""].some((text) =>
      text.toLocaleLowerCase().includes(needle),
    ),
  );
  return (
    <>
      <button
        type="button"
        aria-label={S.chat.chooseAgent}
        data-tooltip={S.chat.chooseAgent}
        aria-haspopup="dialog"
        className={pillClass}
        onClick={() => {
          setQuery("");
          setOpen(true);
        }}
      >
        {selected && (
          <AgentAvatar
            id={selected.agentId}
            name={agentDisplayName(selected)}
            size={16}
            className="shrink-0 rounded"
          />
        )}
        <span className="min-w-0 truncate">
          {selected ? agentDisplayName(selected) : S.common.loading}
        </span>
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={S.chat.chooseAgent}
        widthClass="sm:max-w-xl"
      >
        <Input
          type="search"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={S.workbenches.searchAgents}
          placeholder={S.workbenches.searchAgents}
        />
        <ul className="mt-3 space-y-1">
          {visible.map((agent) => (
            <li key={agent.agentId}>
              <button
                type="button"
                aria-pressed={agent.agentId === selected?.agentId}
                className="flex w-full items-start gap-3 rounded-md px-3 py-3 text-left hover:bg-surface-muted aria-pressed:bg-surface-muted"
                onClick={() => {
                  onSelect(agent);
                  setOpen(false);
                }}
              >
                <AgentAvatar
                  id={agent.agentId}
                  name={agentDisplayName(agent)}
                  size={32}
                  className="shrink-0 rounded"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{agentDisplayName(agent)}</span>
                  {agent.description && (
                    <span className="mt-1 block text-sm text-fg-muted">{agent.description}</span>
                  )}
                  <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-fg-subtle">
                    <span>{S.skills.skillCount(agent.skillCount)}</span>
                    <span>{S.workbenches.count(agent.workbenchCount ?? 0)}</span>
                    {agent.employments?.map((job) => (
                      <span key={job.orgId}>{S.agent.employmentLine(job.orgName, job.title)}</span>
                    ))}
                  </span>
                </span>
                {agent.agentId === selected?.agentId && (
                  <GlyphIcon d={ICONS.check} size={ICON_SIZE.rowLead} className="shrink-0" />
                )}
              </button>
            </li>
          ))}
        </ul>
        {visible.length === 0 && (
          <p className="py-6 text-center text-sm text-fg-muted">
            {agents.length === 0 ? empty : S.workbenches.noMatches}
          </p>
        )}
      </Modal>
    </>
  );
}

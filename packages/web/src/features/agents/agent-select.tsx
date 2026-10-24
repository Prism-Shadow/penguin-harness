import { useState } from "react";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { AgentAvatar, GlyphIcon, ICON_SIZE, ICONS, PickerDialog } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { agentDisplayName } from "../../state/project";
import { pillClass } from "../chat";
import { employeesLast, isEmployee } from "./agent-employment";

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
      <PickerDialog
        open={open}
        onClose={() => setOpen(false)}
        title={S.chat.chooseAgent}
        items={visible}
        itemKey={(agent) => agent.agentId}
        isCurrent={(agent) => agent.agentId === selected?.agentId}
        query={query}
        onQueryChange={setQuery}
        searchPlaceholder={S.workbenches.searchAgents}
        emptyText={agents.length === 0 ? empty : S.workbenches.noMatches}
        groupLabel={(agent) => (isEmployee(agent) ? S.agent.employeesSection : null)}
        onPick={(agent) => {
          onSelect(agent);
          setOpen(false);
        }}
        renderRow={(agent) => (
          <>
            <AgentAvatar
              id={agent.agentId}
              name={agentDisplayName(agent)}
              size={20}
              className="shrink-0 rounded"
            />
            <span
              className="min-w-0 flex-1 truncate"
              data-tooltip={[
                agentDisplayName(agent),
                agent.description,
                ...(agent.employments ?? []).map((job) =>
                  S.agent.employmentLine(job.orgName, job.title),
                ),
              ]
                .filter(Boolean)
                .join("\n")}
              data-tooltip-content="text"
              data-tooltip-extra={Boolean(agent.description || agent.employments?.length)}
            >
              {agentDisplayName(agent)}
            </span>
            <span
              className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-fg-subtle"
              aria-label={S.skills.skillCount(agent.skillCount)}
              data-tooltip={S.skills.skillCount(agent.skillCount)}
              data-tooltip-extra
            >
              <GlyphIcon d={ICONS.bookOpen} size={ICON_SIZE.inlineGlyph} />
              <span aria-hidden>{agent.skillCount}</span>
            </span>
            <span
              className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-fg-subtle"
              aria-label={S.workbenches.count(agent.workbenchCount ?? 0)}
              data-tooltip={S.workbenches.count(agent.workbenchCount ?? 0)}
              data-tooltip-extra
            >
              <GlyphIcon d={ICONS.anvil} size={ICON_SIZE.inlineGlyph} />
              <span aria-hidden>{agent.workbenchCount ?? 0}</span>
            </span>
          </>
        )}
      />
    </>
  );
}

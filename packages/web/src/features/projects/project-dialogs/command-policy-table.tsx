/**
 * The security page's rule table: one page of the rule list at a time, in one column grid the
 * header and every row share — the name, the regular expression, what a hit does, whether the
 * rule is on, and the owner's edit and delete — one line per rule. The pattern truncates to its
 * column with the whole of it in the tooltip, and the name's tooltip adds the description. At
 * phone width a row becomes a two-line card (the name and its controls, then the pattern) and
 * the header steps aside, so nothing scrolls sideways.
 *
 * A rule whose pattern the server cannot compile carries an amber sign after its name and a
 * line under the row giving the engine's reason: a stored one the server's read reports (the
 * matcher skips it, so it guards nothing), or a draft one the last save was refused over.
 *
 * What is shown is a slice of the draft the section holds: turning a page changes what is on
 * screen and nothing else, so an unsaved edit on one page is still there after visiting
 * another. Every column is a fixed width or a share of the row, never sized by its content, so a
 * page turn moves no column.
 */
import type { ReactNode } from "react";
import type { CommandPolicyRuleDto } from "@prismshadow/penguin-server/api";
import {
  Badge,
  GlyphIcon,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  IconButton,
  Switch,
} from "@prismshadow/penguin-ui";
import { S } from "../../../lib/strings";
import { toneInk } from "../../../lib/tone";

/** Rules on one page of the table. */
export const RULES_PER_PAGE = 10;

/** How many pages `count` rules take; an empty list is one (empty) page. */
export function pageCountOf(count: number): number {
  return Math.max(1, Math.ceil(count / RULES_PER_PAGE));
}

/** The page the rule at `index` is on. */
export function pageOf(index: number): number {
  return Math.floor(index / RULES_PER_PAGE);
}

/** A rule the server refused to store, by identity in the draft, with the engine's reason. */
export interface RejectedRule {
  rule: CommandPolicyRuleDto;
  reason: string;
}

/**
 * The column tracks above phone width. The two text columns share what the fixed ones leave,
 * most of it to the name: the factory patterns open alike (the same command-word prefix), so a
 * wider pattern column would show more of the same; the full pattern is its tooltip. The fixed
 * ones fit their header and their widest value in either language ("Asks first", "Disabled",
 * two icon buttons).
 */
const COLUMNS = {
  owner: "sm:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_4.75rem_3.25rem_3.25rem]",
  member: "sm:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_4.75rem_3.25rem]",
} as const;

export function RuleTable({
  rules,
  page,
  isOwner,
  locked,
  editing,
  editor,
  rejected,
  onToggle,
  onEdit,
  onDelete,
}: {
  /** The whole draft list; the table shows `page` of it. */
  rules: CommandPolicyRuleDto[];
  page: number;
  isOwner: boolean;
  /** Every control off: a save in flight, or the policy switched off. */
  locked: boolean;
  /** The row being edited, "new" while the add form is open, null when idle. */
  editing: number | "new" | null;
  /** The editor that takes the place of the row at `index` while it is edited. */
  editor: (index: number) => ReactNode;
  rejected: RejectedRule | null;
  onToggle: (index: number, enabled: boolean) => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
}) {
  const columns = isOwner ? COLUMNS.owner : COLUMNS.member;
  const start = page * RULES_PER_PAGE;
  const shown = rules.slice(start, start + RULES_PER_PAGE);
  return (
    <div>
      {/* The column titles are for the eye: each control names its rule and column itself. */}
      <div
        aria-hidden="true"
        className={`hidden gap-x-3 border-b border-line-muted py-1.5 text-xs font-medium text-fg-muted sm:grid ${columns}`}
      >
        <span className="truncate">{S.project.commandPolicyRuleName}</span>
        <span className="truncate">{S.project.commandPolicyColPattern}</span>
        <span className="truncate">{S.project.commandPolicyRuleAction}</span>
        <span className="truncate">{S.project.commandPolicyColEnabled}</span>
      </div>
      <div className="divide-y divide-line-muted">
        {shown.map((r, k) => {
          const i = start + k;
          if (editing === i) return <div key={`edit-${i}`}>{editor(i)}</div>;
          // What is wrong with the row's pattern, if anything: the reason the last save was
          // refused over this draft rule, or the server's own read of a stored one it cannot
          // compile (which matching skips). Either way the row says so in a line of its own.
          const problem =
            rejected?.rule === r
              ? S.project.commandPolicyPatternRejectedHint(rejected.reason)
              : r.patternError !== undefined
                ? S.project.commandPolicyRuleSkipped(r.patternError)
                : null;
          return (
            <div
              key={`${r.name}-${i}`}
              className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2 ${columns} ${r.enabled ? "" : "opacity-60"}`}
            >
              <div className={`flex min-w-0 items-center ${ICON_GAP.row}`}>
                {/* The tooltip leads with the name, which a narrow column may cut short. */}
                <span
                  className="truncate text-sm font-medium"
                  data-tooltip={
                    r.description !== undefined ? `${r.name} — ${r.description}` : r.name
                  }
                >
                  {r.name}
                </span>
                {problem !== null && (
                  <span
                    role="img"
                    className={`shrink-0 ${toneInk.attention}`}
                    aria-label={S.project.commandPolicyPatternMark}
                  >
                    <GlyphIcon d={ICONS.triangleAlert} size={ICON_SIZE.rowLead} />
                  </span>
                )}
              </div>
              <p
                className="col-span-2 row-start-2 truncate font-mono text-xs text-fg-muted sm:col-span-1 sm:row-start-auto"
                data-tooltip={r.pattern}
                data-tooltip-content="code"
              >
                {r.pattern}
              </p>
              {/* One cluster on a phone's first line; above it, `contents` lets each of these
                  take its own column of the row's grid. */}
              <div className="col-start-2 row-start-1 flex items-center justify-end gap-2 sm:contents">
                <span className="flex">
                  {r.action === "ask" ? (
                    // A labelled pill says the rule asks; its meaning is on hover.
                    <Badge tone="attention" size="sm" tooltip={S.project.commandPolicyAskPillHint}>
                      {S.project.commandPolicyAskPill}
                    </Badge>
                  ) : (
                    <span className="text-xs text-fg-muted">
                      {S.project.commandPolicyActionDeny}
                    </span>
                  )}
                </span>
                {isOwner ? (
                  <span className="flex">
                    <Switch
                      checked={r.enabled}
                      aria-label={S.project.commandPolicyRuleSwitch(r.name)}
                      disabled={locked}
                      onChange={(v) => onToggle(i, v)}
                    />
                  </span>
                ) : (
                  <span className="text-xs text-fg-muted">
                    {r.enabled ? S.project.commandPolicyOn : S.project.commandPolicyOff}
                  </span>
                )}
                {isOwner && (
                  <span className="flex items-center justify-end gap-1">
                    <IconButton
                      variant="ghost"
                      size="sm"
                      label={S.project.commandPolicyEditRuleNamed(r.name)}
                      title={S.project.commandPolicyEditRule}
                      disabled={locked || editing !== null}
                      onClick={() => onEdit(i)}
                    >
                      <GlyphIcon d={ICONS.pencil} size={ICON_SIZE.iconButton} />
                    </IconButton>
                    <IconButton
                      variant="ghost"
                      size="sm"
                      label={S.project.commandPolicyDeleteRuleNamed(r.name)}
                      title={S.common.delete}
                      disabled={locked || editing !== null}
                      onClick={() => onDelete(i)}
                    >
                      <GlyphIcon d={ICONS.trash} size={ICON_SIZE.iconButton} />
                    </IconButton>
                  </span>
                )}
              </div>
              {problem !== null && (
                <p
                  className={`col-span-2 row-start-3 text-xs ${toneInk.attention} sm:col-span-full sm:row-start-2`}
                >
                  {problem}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

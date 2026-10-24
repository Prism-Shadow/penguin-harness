/**
 * The round navigator: the toolbar's rounds button, naming the round in view, and the list of
 * every round of the file it opens, so a reader of a long Trace can reach any round from anywhere
 * in it without paging through the rows. It is the toolbar's dropdown (trace-picker.tsx), the
 * same one the file picker is. A list row is the round's number, its compaction badge, the first
 * line of the prompt that started it and its four readings in short form; a pick closes the
 * list, then draws, opens and scrolls to that round. The number box in the list's title row
 * jumps by number. The list opens toward the panel's start, no wider than the room there.
 *
 * It lists all rounds (the rows below are drawn a page at a time, this list is not), so a row
 * is kept cheap: plain text, no per-row chips.
 */
import { useState } from "react";
import type { KeyboardEvent } from "react";
import type { TraceTaskStats } from "@prismshadow/penguin-server/api";
import { ICONS, Input, Pill } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import type { Currency } from "../../state/theme";
import { roundFactsOf, roundFactsShort, roundFactsText } from "./round-facts";
import { TracePicker } from "./trace-picker";
import type { PickerRow } from "./trace-picker";

/** A file needs a navigator once it has this many rounds; below it every round is in reach. */
export const ROUND_NAV_MIN_ROUNDS = 2;

/** The title row's number box: a round's number and Enter jump to it; other numbers do nothing. */
function RoundNumberBox({
  tasks,
  onPick,
}: {
  tasks: readonly TraceTaskStats[];
  onPick: (taskIndex: number) => void;
}) {
  const [draft, setDraft] = useState("");
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const n = Number(draft);
    const target = Number.isInteger(n) ? tasks.find((t) => t.taskIndex === n - 1) : undefined;
    if (target === undefined) return;
    setDraft("");
    onPick(target.taskIndex);
  };
  return (
    // A width given to the field itself loses to its own w-full: the box holds it.
    <span className="w-20 shrink-0">
      <Input
        size="sm"
        type="number"
        inputMode="numeric"
        min={1}
        max={tasks.length}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        aria-label={S.traces.jumpToRound}
        placeholder={S.traces.jumpToRoundPlaceholder}
      />
    </span>
  );
}

export function RoundNavButton({
  tasks,
  toolCalls,
  badgeOf,
  currency,
  current,
  onJump,
}: {
  /** Every round of the file, in taskIndex order. */
  tasks: readonly TraceTaskStats[];
  /** Tool calls per round, by taskIndex (rounds with none are absent). */
  toolCalls: ReadonlyMap<number, number>;
  /** A compaction round's badge text, null for any other round. */
  badgeOf: (st: TraceTaskStats) => string | null;
  currency: Currency;
  /** The round in view: the button's label, and the list's current row. */
  current: number;
  onJump: (taskIndex: number) => void;
}) {
  const rows: PickerRow<number>[] = tasks.map((st) => {
    const k = st.taskIndex;
    const facts = roundFactsOf(st, toolCalls.get(k) ?? 0);
    const badge = badgeOf(st);
    return {
      key: k,
      lead: (
        <span className="flex items-center gap-2">
          <span className="w-8 shrink-0 text-right text-fg-subtle tabular-nums">{k + 1}</span>
          {badge !== null && <Pill>{badge}</Pill>}
        </span>
      ),
      label: st.prompt ?? "",
      // The digits alone do not say which reading each is: the hint names them.
      trailing: (
        <span
          data-tooltip={roundFactsText(facts, currency)}
          data-tooltip-extra
          className="shrink-0 font-mono text-fg-muted tabular-nums"
        >
          {roundFactsShort(facts, currency)}
        </span>
      ),
    };
  });
  return (
    <TracePicker
      slot="nav-button"
      glyph={ICONS.menu}
      label={S.traces.task(current + 1)}
      title={S.traces.roundNav}
      count={S.traces.roundCount(tasks.length)}
      headerEnd={(pick) => <RoundNumberBox tasks={tasks} onPick={pick} />}
      align="right"
      width="30rem"
      rows={rows}
      current={current}
      onPick={onJump}
    />
  );
}

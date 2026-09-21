/**
 * Review of specification edits before they are saved. The raw JSON box stays the thing
 * an author types into; this is the reading of it, against the specification currently
 * saved. A draft has no version history, so that is the only base there is, and it is
 * the one the save decision is actually about.
 */
import { useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { InfoPopover } from "../../components/ui/info-popover";
import { Segmented } from "../../components/ui/segmented";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import {
  DIFF_CELL_LIMIT,
  changedScenes,
  diffLines,
  diffRegions,
  diffStats,
  sceneRowIndex,
  stepRegion,
  visibleRows,
  type DiffRow,
} from "./spec-diff";

/**
 * A diff's two colours are a categorical palette, not a status tone: "added" and
 * "removed" are identities of a line, not judgements about the system, so they sit
 * outside `tone.ts` alongside the app's other categorical palettes. Colour is never the
 * only carrier here — every row also shows its mark and which side's line number it has.
 */
const rowClass: Record<DiffRow["kind"], string> = {
  same: "text-gray-500",
  added: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  removed: "bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-200",
};

const MARK: Record<DiffRow["kind"], string> = { same: " ", added: "+", removed: "−" };

function LineNumber({ value }: { value?: number }) {
  return (
    <span aria-hidden className="w-10 shrink-0 pr-2 text-right text-gray-400 select-none">
      {value ?? ""}
    </span>
  );
}

export function SpecDiffView({
  saved,
  edited,
  onRevert,
}: {
  saved: string;
  edited: string;
  /** Absent when the draft is not editable, which hides the revert action. */
  onRevert?: () => void;
}) {
  const [layout, setLayout] = useState<"inline" | "split">("inline");
  const [region, setRegion] = useState(-1);
  const [reverting, setReverting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => diffLines(saved, edited), [saved, edited]);
  const regions = useMemo(() => diffRegions(rows), [rows]);
  const stats = useMemo(() => diffStats(rows), [rows]);
  const scenes = useMemo(() => changedScenes(saved, edited), [saved, edited]);
  const shown = useMemo(() => visibleRows(rows), [rows]);
  const truncated = saved.split("\n").length * edited.split("\n").length > DIFF_CELL_LIMIT;
  // The regions array is rebuilt on every edit, so an index taken before the edit can
  // outlive the region it named. Clamp on the way out rather than carry an impossible
  // position like "3 / 1" until the next click.
  const current = region < regions.length ? region : -1;

  function jumpTo(rowIndex: number) {
    const container = scrollRef.current;
    const target = container?.querySelector<HTMLElement>(`[data-row="${rowIndex}"]`);
    if (!container || !target) return;
    container.scrollTop = target.offsetTop - container.clientHeight / 3;
  }

  function step(direction: 1 | -1) {
    const next = stepRegion(current, regions.length, direction);
    setRegion(next);
    if (next >= 0) jumpTo(regions[next]!.start);
  }

  if (!stats.added && !stats.removed)
    return <p className="text-xs text-gray-500">{S.activities.diffNone}</p>;

  return (
    <section className="space-y-2">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        {S.activities.diffTitle}
        <InfoPopover label={S.activities.diffTitle}>
          <p>{S.activities.diffHelp}</p>
        </InfoPopover>
      </h4>
      {truncated && <p className={`text-xs ${toneInk.attention}`}>{S.activities.diffTooLarge}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">
          {S.activities.diffStats(stats.added, stats.removed, stats.regions)}
        </span>
        <Button size="sm" onClick={() => step(-1)}>
          {S.activities.diffPrevious}
        </Button>
        <Button size="sm" onClick={() => step(1)}>
          {S.activities.diffNext}
        </Button>
        <span className="text-xs text-gray-500">
          {S.activities.diffPosition(current + 1, regions.length)}
        </span>
        <div className="w-44">
          <Segmented
            cols={2}
            value={layout}
            onChange={setLayout}
            options={[
              { value: "inline", label: S.activities.diffInline },
              { value: "split", label: S.activities.diffSideBySide },
            ]}
          />
        </div>
        {onRevert && (
          <Button size="sm" onClick={() => setReverting(true)}>
            {S.activities.diffRevert}
          </Button>
        )}
      </div>
      {scenes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-500">{S.activities.diffScenes}</span>
          {scenes.map((scene) => (
            <button
              key={`${scene.id}-${scene.change}`}
              type="button"
              onClick={() => {
                const index = sceneRowIndex(rows, scene.id);
                if (index >= 0) jumpTo(index);
              }}
              className="rounded bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800"
            >
              {scene.id} · {S.activities.diffSceneChange[scene.change]}
            </button>
          ))}
        </div>
      )}
      <div
        ref={scrollRef}
        aria-label={S.activities.diffTitle}
        className="max-h-96 overflow-auto rounded-lg border border-gray-200 font-mono text-xs dark:border-gray-800"
      >
        {layout === "inline" ? <InlineRows shown={shown} /> : <SplitRows shown={shown} />}
      </div>
      {onRevert && reverting && (
        <ConfirmModal
          open
          title={S.activities.diffRevert}
          confirmLabel={S.activities.diffRevert}
          onClose={() => setReverting(false)}
          onConfirm={() => {
            setReverting(false);
            onRevert();
          }}
        >
          <p>{S.activities.diffRevertConfirm}</p>
        </ConfirmModal>
      )}
    </section>
  );
}

/** A gap standing in for the unchanged lines between two regions. */
function Fold({ lines }: { lines: number }) {
  return (
    <p className="border-y border-gray-200 bg-gray-50 px-2 py-1 text-gray-500 dark:border-gray-800 dark:bg-gray-900">
      {S.activities.diffFolded(lines)}
    </p>
  );
}

function withFolds(shown: { row: DiffRow; index: number }[]) {
  const parts: ({ kind: "fold"; lines: number } | { kind: "row"; row: DiffRow; index: number })[] =
    [];
  let previous = -1;
  for (const entry of shown) {
    if (previous >= 0 && entry.index > previous + 1)
      parts.push({ kind: "fold", lines: entry.index - previous - 1 });
    parts.push({ kind: "row", row: entry.row, index: entry.index });
    previous = entry.index;
  }
  return parts;
}

function InlineRows({ shown }: { shown: { row: DiffRow; index: number }[] }) {
  return (
    <div>
      {withFolds(shown).map((part, position) =>
        part.kind === "fold" ? (
          <Fold key={`fold-${position}`} lines={part.lines} />
        ) : (
          <div
            key={part.index}
            data-row={part.index}
            className={`flex whitespace-pre-wrap ${rowClass[part.row.kind]}`}
          >
            <LineNumber value={part.row.before} />
            <LineNumber value={part.row.after} />
            <span aria-hidden className="w-4 shrink-0 select-none">
              {MARK[part.row.kind]}
            </span>
            <span className="min-w-0 break-all">{part.row.text || " "}</span>
          </div>
        ),
      )}
    </div>
  );
}

function SplitRows({ shown }: { shown: { row: DiffRow; index: number }[] }) {
  return (
    <div>
      <div className="sticky top-0 grid grid-cols-2 border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
        <p className="px-2 py-1 text-gray-500">{S.activities.diffSavedSide}</p>
        <p className="border-l border-gray-200 px-2 py-1 text-gray-500 dark:border-gray-800">
          {S.activities.diffEditedSide}
        </p>
      </div>
      {withFolds(shown).map((part, position) =>
        part.kind === "fold" ? (
          <Fold key={`fold-${position}`} lines={part.lines} />
        ) : (
          <div key={part.index} data-row={part.index} className="grid grid-cols-2">
            <div
              className={`flex whitespace-pre-wrap ${part.row.kind === "added" ? "" : rowClass[part.row.kind]}`}
            >
              {part.row.kind !== "added" && (
                <>
                  <LineNumber value={part.row.before} />
                  <span className="min-w-0 break-all">{part.row.text || " "}</span>
                </>
              )}
            </div>
            <div
              className={`flex border-l border-gray-200 whitespace-pre-wrap dark:border-gray-800 ${part.row.kind === "removed" ? "" : rowClass[part.row.kind]}`}
            >
              {part.row.kind !== "removed" && (
                <>
                  <LineNumber value={part.row.after} />
                  <span className="min-w-0 break-all">{part.row.text || " "}</span>
                </>
              )}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

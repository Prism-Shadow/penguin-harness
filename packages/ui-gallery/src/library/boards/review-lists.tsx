/**
 * The review list, on the data board: a cleanup's review — scratchpads of deleted conversations
 * (chosen to begin with), idle ones with the line that says what removing them costs, and Agent
 * caches with one in use that cannot be chosen — and a list of conversations whose rows carry
 * marks after their titles (archived, running). The choice is live, and the line under the lists
 * counts it the way a dialog's footer would.
 */
import { useState } from "react";
import { Pill, ReviewList, Spinner } from "@prismshadow/penguin-ui";
import type { ReviewGroup } from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

/** Sizes in bytes and the times: data, the same in both languages. */
const MB = 1024 ** 2;
const SIZES: Record<string, number> = {
  o1: 412 * MB,
  o2: 96 * MB,
  i1: 1210 * MB,
  i2: 38 * MB,
  c1: 860 * MB,
  c2: 240 * MB,
  t1: 520 * MB,
  t2: 44 * MB,
  t3: 12 * MB,
};

function size(bytes: number): string {
  return bytes >= 1024 * MB
    ? `${(bytes / 1024 / MB).toFixed(1)} GB`
    : `${Math.round(bytes / MB)} MB`;
}

const total = (keys: readonly string[]) => size(keys.reduce((n, k) => n + (SIZES[k] ?? 0), 0));

export function ReviewLists() {
  const { S } = useGallery();
  const t = S.library.data.reviewList;
  const [cleanup, setCleanup] = useState<ReadonlySet<string>>(() => new Set(["o1", "o2"]));
  const [chats, setChats] = useState<ReadonlySet<string>>(() => new Set(["t1"]));
  const where = `docs-site › ${t.agent}`;
  const groups: ReviewGroup[] = [
    {
      key: "orphan",
      label: t.orphan,
      total: total(["o1", "o2"]),
      items: [
        { key: "o1", title: "c1f0e5a2-7d3b", meta: where, time: t.ago(12), value: size(SIZES.o1!) },
        { key: "o2", title: "9a4b7c10-22ef", meta: where, time: t.ago(31), value: size(SIZES.o2!) },
      ],
    },
    {
      key: "idle",
      label: t.idle,
      note: t.idleNote,
      total: total(["i1", "i2"]),
      items: [
        { key: "i1", title: t.titles[0]!, meta: where, time: t.ago(9), value: size(SIZES.i1!) },
        { key: "i2", title: t.titles[1]!, meta: where, time: t.ago(14), value: size(SIZES.i2!) },
      ],
    },
    {
      key: "cache",
      label: t.caches,
      note: t.cachesNote,
      total: total(["c1", "c2"]),
      items: [
        { key: "c1", title: "python-3.12", meta: where, time: t.ago(4), value: size(SIZES.c1!) },
        {
          key: "c2",
          title: "node-22",
          meta: `research › ${t.agent}`,
          time: t.ago(0),
          value: size(SIZES.c2!),
          disabled: true,
          disabledReason: t.inUse,
        },
      ],
    },
  ];
  const chatGroups: ReviewGroup[] = [
    {
      key: "chats",
      label: t.chats,
      total: total(["t1", "t2", "t3"]),
      items: [
        {
          key: "t1",
          title: t.titles[2]!,
          trail: <Pill>{t.archived}</Pill>,
          meta: where,
          time: t.ago(45),
          value: size(SIZES.t1!),
        },
        {
          key: "t2",
          title: t.titles[3]!,
          trail: (
            <span data-tooltip={t.running} className="shrink-0">
              <Spinner size="sm" tone="success" label={t.running} />
            </span>
          ),
          meta: where,
          time: t.ago(0),
          value: size(SIZES.t2!),
          disabled: true,
          disabledReason: t.running,
        },
        { key: "t3", title: t.titles[4]!, meta: where, time: t.ago(2), value: size(SIZES.t3!) },
      ],
    },
  ];
  const chosen = (keys: ReadonlySet<string>) => t.chosen(keys.size, total([...keys]));
  return (
    <BoardGroup title={t.title} aside={t.hint}>
      <div className="grid max-w-2xl gap-8">
        <div className="space-y-3">
          <ReviewList groups={groups} selected={cleanup} onChange={setCleanup} labels={t.labels} />
          <p className="text-sm tabular-nums text-fg-muted">{chosen(cleanup)}</p>
        </div>
        <div className="space-y-3">
          <ReviewList groups={chatGroups} selected={chats} onChange={setChats} labels={t.labels} />
          <p className="text-sm tabular-nums text-fg-muted">{chosen(chats)}</p>
        </div>
      </div>
    </BoardGroup>
  );
}

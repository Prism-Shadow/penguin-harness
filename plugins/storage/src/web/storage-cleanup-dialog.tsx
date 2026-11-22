/**
 * Clean up temporary files (Settings › Storage): the review of what the server says can be
 * removed safely now, then the removal.
 *
 * - On top, the idle age in a sentence ("Idle scratchpads: last active more than [7] days ago");
 *   changing it reviews again once typing rests. A review measures first, so it can take a while:
 *   the first one shows placeholders and a line saying so, a later one keeps the list on screen.
 * - The review list (the shared ReviewList), grouped in this order, empty groups hidden:
 *   scratchpads of deleted chats, scratchpads of idle chats (with what removing them costs),
 *   orphaned temporary workspaces, Agent caches (with what removing them costs), and the server's
 *   caches (an admin's alone). A scratchpad is named by its chat's title (never by its folder,
 *   whose name is an id), the rest by their folder's name; each row says where it lives and
 *   when it was last used. What the server picks is chosen to begin with.
 * - The foot counts the choice and its size; Delete asks first (the count and the size), then
 *   removes, says what went, what it freed and what was left, closes, and the page measures again.
 */
import { useEffect, useState } from "react";
import {
  ConfirmModal,
  Input,
  Modal,
  ReviewList,
  SettingsEmpty,
  SkeletonList,
  Spinner,
  toastAttention,
  toastInfo,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import type { ReviewGroup, ReviewItem } from "@prismshadow/penguin-ui";
import { useStore } from "zustand/react";
import {
  formatDateTime,
  formatRelativeShort,
  toastApiError,
} from "@prismshadow/penguin-web-plugin";
import type { StorageCleanupItem } from "../types";
import {
  CLEANUP_DEFAULT_DAYS,
  CLEANUP_MAX_DAYS,
  CLEANUP_MIN_DAYS,
  chosenBytes,
  chosenItems,
  createCleanupStore,
  type CleanupStore,
} from "./storage-cleanup-state";
import { formatSize } from "./storage-format";
import { ReviewFoot, reviewLabels } from "./storage-review-foot";
import { S } from "./strings";

/** How long typing in the idle-age field rests before the review is asked again. */
const DAYS_DEBOUNCE_MS = 400;

/** The idle age typed, when it is one the server accepts; null otherwise. */
export function parseCleanupDays(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= CLEANUP_MIN_DAYS && n <= CLEANUP_MAX_DAYS ? n : null;
}

/** The review's groups, in order: each with its words and the items it holds. */
const GROUPS: ReadonlyArray<{
  key: string;
  holds: (item: StorageCleanupItem) => boolean;
  label: () => string;
  note?: () => string;
}> = [
  {
    key: "orphanScratchpads",
    holds: (item) => item.kind === "scratchpad" && item.reason === "orphan",
    label: () => S.storage.temp.orphanScratchpads,
  },
  {
    key: "idleScratchpads",
    holds: (item) => item.kind === "scratchpad" && item.reason === "idle",
    label: () => S.storage.temp.idleScratchpads,
    note: () => S.storage.temp.idleScratchpadsNote,
  },
  {
    key: "workspaces",
    holds: (item) => item.kind === "workspace",
    label: () => S.storage.temp.workspaces,
  },
  {
    key: "agentCaches",
    holds: (item) => item.kind === "agentCache",
    label: () => S.storage.temp.agentCaches,
    note: () => S.storage.temp.agentCachesNote,
  },
  {
    key: "serverCaches",
    holds: (item) => item.kind === "serverCache",
    label: () => S.storage.temp.serverCaches,
  },
];

/** Where an item lives: its Project and its Agent, as far as the item says. */
function placeOf(item: StorageCleanupItem): string | undefined {
  if (item.projectName !== undefined && item.agentName !== undefined) {
    return `${item.projectName} › ${item.agentName}`;
  }
  return item.projectName;
}

/** One item as a review row. */
function rowOf(item: StorageCleanupItem): ReviewItem {
  // A scratchpad goes by its chat's title. Its folder's name is the chat's id, never shown: one
  // whose chat is gone reads as such, and one whose title is not the viewer's to read (another
  // user's Project, for an admin) as another user's chat. The rest go by their folder's name.
  const title =
    item.kind !== "scratchpad"
      ? item.name
      : item.reason === "orphan"
        ? S.storage.temp.deletedChat
        : item.title === undefined
          ? S.storage.temp.hiddenChat
          : (item.title ?? S.storage.untitledChat);
  const used = item.lastActiveAt ?? item.lastModifiedAt;
  const place = placeOf(item);
  return {
    key: item.id,
    title,
    value: formatSize(item.bytes),
    ...(place !== undefined ? { meta: place } : {}),
    ...(used !== null ? { time: formatRelativeShort(used), timeTitle: formatDateTime(used) } : {}),
  };
}

export function cleanupGroups(items: readonly StorageCleanupItem[]): ReviewGroup[] {
  return GROUPS.map((group) => {
    const held = items.filter(group.holds);
    return {
      key: group.key,
      label: group.label(),
      ...(group.note !== undefined ? { note: group.note() } : {}),
      total: formatSize(held.reduce((n, item) => n + item.bytes, 0)),
      items: held.map((item) => rowOf(item)),
    };
  }).filter((group) => group.items.length > 0);
}

export function StorageCleanupDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  /** Something was removed: the page reads its usage again. */
  onDone: () => void;
}) {
  const [store] = useState<CleanupStore>(() =>
    createCleanupStore((reason, err) =>
      toastApiError(err, { text: S.storage.actionFailed(reason) }),
    ),
  );
  const state = useStore(store);
  const [days, setDays] = useState(String(CLEANUP_DEFAULT_DAYS));
  const [confirming, setConfirming] = useState(false);

  useEffect(() => () => store.getState().dispose(), [store]);

  // The first review at once; a new age once typing rests.
  useEffect(() => {
    const n = parseCleanupDays(days);
    if (n === null) return;
    const first = store.getState().review === null && !store.getState().loading;
    const timer = setTimeout(() => void store.getState().load(n), first ? 0 : DAYS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [store, days]);

  const count = chosenItems(state).length;
  const bytes = chosenBytes(state);
  const close = () => (state.busy ? undefined : onClose());

  const remove = async () => {
    const result = await store.getState().remove();
    setConfirming(false);
    if (result === null) return;
    const failed = result.skipped.filter((s) => s.reason === "failed").length;
    const skipped = result.skipped.length - failed;
    const text = S.storage.temp.summary(result.removed, formatSize(result.bytes), skipped, failed);
    if (failed > 0) toastAttention(text);
    else if (result.removed > 0) toastSuccess(text);
    else toastInfo(text);
    onDone();
    onClose();
  };

  const review = state.review;
  return (
    <>
      <Modal
        open
        title={S.storage.cleanTemp}
        onClose={close}
        widthClass="sm:max-w-2xl"
        footer={
          <ReviewFoot
            count={count}
            bytes={bytes}
            busy={state.busy}
            onDelete={() => setConfirming(true)}
          />
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>{S.storage.temp.idleBefore}</span>
            <div className="w-24">
              <Input
                size="sm"
                type="number"
                inputMode="numeric"
                min={CLEANUP_MIN_DAYS}
                max={CLEANUP_MAX_DAYS}
                aria-label={S.storage.temp.idleDays}
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </div>
            <span>{S.storage.temp.idleAfter}</span>
            {state.loading && review !== null && (
              <Spinner size="xs" label={S.storage.temp.reviewing} />
            )}
          </div>
          {review === null ? (
            state.error !== null ? (
              <SettingsEmpty>{S.storage.temp.reviewFailed(state.error)}</SettingsEmpty>
            ) : (
              <div className="space-y-3">
                <p className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
                  <Spinner size="xs" label={S.storage.temp.reviewing} />
                  <span aria-hidden>{S.storage.temp.reviewing}</span>
                </p>
                <SkeletonList rows={4} />
              </div>
            )
          ) : (
            <>
              {state.error !== null && (
                <p className="text-xs text-fg-muted">{S.storage.temp.reviewFailed(state.error)}</p>
              )}
              {review.items.length === 0 ? (
                <SettingsEmpty>{S.storage.temp.empty}</SettingsEmpty>
              ) : (
                <ReviewList
                  groups={cleanupGroups(review.items)}
                  selected={state.selected}
                  onChange={(next) => store.getState().setSelected(next)}
                  labels={reviewLabels()}
                />
              )}
            </>
          )}
        </div>
      </Modal>
      <ConfirmModal
        open={confirming}
        title={S.storage.temp.confirmTitle(count)}
        confirmLabel={S.storage.delete}
        cancelLabel={S.storage.cancel}
        busy={state.busy}
        onClose={() => (state.busy ? undefined : setConfirming(false))}
        onConfirm={() => void remove()}
      >
        <p className="text-sm text-fg-muted">
          {S.storage.temp.confirmBody(count, formatSize(bytes))}
        </p>
      </ConfirmModal>
    </>
  );
}

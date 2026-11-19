/**
 * Clean up old chats and Manage chats (Settings › Storage): the conversations of the Projects
 * the user can open, by size or by last activity, to delete the ones chosen.
 *
 * - Filters on top: an Agent (every one, or one "Project › Agent"), archived or not, last active
 *   more than N days ago (blank for any time; applied once typing rests), and the order. Clean up
 *   old chats opens on archived, idle for a month, everything chosen; Manage chats with no filter
 *   and nothing chosen.
 * - One group of rows (the shared ReviewList): the title, an Archived pill, a running mark on a
 *   conversation under way — which cannot be chosen — where it lives, its last activity and its
 *   size (its Trace and its scratchpad). The server lists at most 500; a muted line says so when
 *   more matched.
 * - The foot counts the choice and its size; Delete asks first, then deletes through the archive
 *   page's batch delete (the one way a conversation is deleted), says how many went, lists again,
 *   and the page measures again.
 */
import { useEffect, useRef, useState } from "react";
import {
  ConfirmModal,
  Input,
  Modal,
  Pill,
  ReviewList,
  Select,
  SettingsEmpty,
  SkeletonList,
  Spinner,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import type { ReviewGroup, ReviewItem } from "@prismshadow/penguin-ui";
import type {
  StorageSessionListing,
  StorageSessionRow,
  StorageSessionSort,
  StorageUsage,
} from "@prismshadow/penguin-server/api";
import { useStore } from "zustand/react";
import { formatDateTime, formatRelativeShort } from "../../lib/format";
import { S } from "../../lib/strings";
import { toastApiError } from "../../lib/toast-api-error";
import { useLocale, type Locale } from "../../state/locale";
import { CLEANUP_MAX_DAYS, CLEANUP_MIN_DAYS } from "./storage-cleanup-state";
import { formatSize } from "./storage-format";
import { ReviewFoot, reviewLabels } from "./storage-review-foot";
import {
  ALL_SESSIONS,
  OLD_SESSIONS,
  chosenSessions,
  createSessionsStore,
  sessionBytes,
  type SessionFilters,
  type SessionsStore,
} from "./storage-sessions-state";

/** How long typing in the last-active field rests before the list is read again. */
const DAYS_DEBOUNCE_MS = 400;

const LISTINGS: readonly StorageSessionListing[] = ["all", "archived", "active"];
const SORTS: readonly StorageSessionSort[] = ["size", "age"];

/** An Agent picked in the filter, as one option value: its Project and its id (neither holds a `/`). */
const agentValue = (projectId: string, agentId: string) => `${projectId}/${agentId}`;

function agentOf(value: string): SessionFilters["agent"] {
  const slash = value.indexOf("/");
  return slash < 0 ? null : { projectId: value.slice(0, slash), agentId: value.slice(slash + 1) };
}

/**
 * The last-active field: blank is any time (null), a number the server accepts is that many days,
 * and anything else is not a filter yet (undefined: the list stays as it is).
 */
function parseOlderDays(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n >= CLEANUP_MIN_DAYS && n <= CLEANUP_MAX_DAYS ? n : undefined;
}

/** A conversation as a review row. */
function rowOf(row: StorageSessionRow, locale: Locale): ReviewItem {
  const marks = row.archived || row.running;
  return {
    key: row.sessionId,
    title: row.title ?? S.chat.defaultSessionTitle,
    ...(marks
      ? {
          trail: (
            <>
              {row.archived && <Pill>{S.storage.chats.archived}</Pill>}
              {row.running && (
                <span className="shrink-0" data-tooltip={S.storage.chats.running}>
                  <Spinner size="sm" tone="success" label={S.storage.chats.running} />
                </span>
              )}
            </>
          ),
        }
      : {}),
    meta: `${row.projectName} › ${row.agentName}`,
    time: formatRelativeShort(row.lastActiveAt, locale),
    timeTitle: formatDateTime(row.lastActiveAt),
    value: formatSize(sessionBytes(row)),
    ...(row.running ? { disabled: true, disabledReason: S.storage.chats.running } : {}),
  };
}

export function StorageSessionsDialog({
  preset,
  usage,
  onClose,
  onDeleted,
}: {
  /** Clean up old chats (`old`) or Manage chats (`all`): what the dialog opens on. */
  preset: "old" | "all";
  /** The page's usage: the Projects and Agents the Agent filter offers. */
  usage: StorageUsage;
  onClose: () => void;
  /** Conversations were deleted: the page measures again. */
  onDeleted: () => void;
}) {
  const { locale } = useLocale();
  const start = preset === "old" ? OLD_SESSIONS : ALL_SESSIONS;
  const [store] = useState<SessionsStore>(() =>
    createSessionsStore((reason, err) =>
      toastApiError(err, { text: S.storage.actionFailed(reason) }),
    ),
  );
  const state = useStore(store);
  const [agent, setAgent] = useState("");
  const [listing, setListing] = useState<StorageSessionListing>(start.listing);
  const [days, setDays] = useState(start.olderThanDays === null ? "" : String(start.olderThanDays));
  const [sort, setSort] = useState<StorageSessionSort>(start.sort);
  const [confirming, setConfirming] = useState(false);
  // Clean up old chats chooses everything on its first list, and only then: taken when that read
  // is sent, so a read cancelled before it went (a filter changed at once) leaves it waiting.
  const chooseAll = useRef(preset === "old");

  useEffect(() => () => store.getState().dispose(), [store]);

  useEffect(() => {
    const olderThanDays = parseOlderDays(days);
    if (olderThanDays === undefined) return;
    const filters: SessionFilters = { agent: agentOf(agent), listing, olderThanDays, sort };
    const current = store.getState();
    const typed = current.list !== null && current.filters.olderThanDays !== olderThanDays;
    const timer = setTimeout(
      () => {
        const all = chooseAll.current;
        chooseAll.current = false;
        void store.getState().load(filters, { chooseAll: all });
      },
      typed ? DAYS_DEBOUNCE_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [store, agent, listing, days, sort]);

  const chosen = chosenSessions(state);
  const count = chosen.length;
  const bytes = chosen.reduce((n, row) => n + sessionBytes(row), 0);
  const close = () => (state.busy ? undefined : onClose());

  const remove = async () => {
    const deleted = await store.getState().remove();
    setConfirming(false);
    if (deleted === null) return;
    toastSuccess(S.storage.chats.deleted(deleted));
    onDeleted();
  };

  const list = state.list;
  const group: ReviewGroup | null =
    list === null || list.sessions.length === 0
      ? null
      : {
          key: "chats",
          label: S.storage.chats.group,
          total: formatSize(list.sessions.reduce((n, row) => n + sessionBytes(row), 0)),
          items: list.sessions.map((row) => rowOf(row, locale)),
        };

  return (
    <>
      <Modal
        open
        title={preset === "old" ? S.storage.cleanOld : S.storage.manageSessions}
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
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                size="sm"
                aria-label={S.storage.chats.agentFilter}
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                className="min-w-0 basis-full sm:w-56 sm:flex-none sm:basis-auto"
              >
                <option value="">{S.storage.chats.allAgents}</option>
                {usage.projects.flatMap((project) =>
                  project.agents.map((a) => (
                    <option
                      key={agentValue(project.projectId, a.agentId)}
                      value={agentValue(project.projectId, a.agentId)}
                    >
                      {`${project.name} › ${a.name}`}
                    </option>
                  )),
                )}
              </Select>
              <Select
                size="sm"
                aria-label={S.storage.chats.listingFilter}
                value={listing}
                onChange={(e) => setListing(e.target.value as StorageSessionListing)}
                className="min-w-0 flex-1 sm:w-32 sm:flex-none"
              >
                {LISTINGS.map((l) => (
                  <option key={l} value={l}>
                    {S.storage.chats.listing[l]}
                  </option>
                ))}
              </Select>
              <Select
                size="sm"
                aria-label={S.storage.chats.sortFilter}
                value={sort}
                onChange={(e) => setSort(e.target.value as StorageSessionSort)}
                className="min-w-0 flex-1 sm:w-32 sm:flex-none"
              >
                {SORTS.map((s) => (
                  <option key={s} value={s}>
                    {S.storage.chats.sort[s]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>{S.storage.chats.olderBefore}</span>
              <div className="w-24">
                <Input
                  size="sm"
                  type="number"
                  inputMode="numeric"
                  min={CLEANUP_MIN_DAYS}
                  max={CLEANUP_MAX_DAYS}
                  placeholder={S.storage.chats.olderAny}
                  aria-label={S.storage.chats.olderDays}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </div>
              <span>{S.storage.chats.olderAfter}</span>
              {state.loading && list !== null && <Spinner size="xs" label={S.common.loading} />}
            </div>
          </div>
          {list === null ? (
            state.error !== null ? (
              <SettingsEmpty>{S.storage.chats.loadFailed(state.error)}</SettingsEmpty>
            ) : (
              <SkeletonList rows={4} />
            )
          ) : (
            <>
              {state.error !== null && (
                <p className="text-xs text-fg-muted">{S.storage.chats.loadFailed(state.error)}</p>
              )}
              {group === null ? (
                <SettingsEmpty>{S.storage.chats.empty}</SettingsEmpty>
              ) : (
                <ReviewList
                  groups={[group]}
                  selected={state.selected}
                  onChange={(next) => store.getState().setSelected(next)}
                  labels={reviewLabels()}
                />
              )}
              {list.truncated && (
                <p className="text-xs text-fg-muted">
                  {S.storage.chats.truncated(list.sessions.length)}
                </p>
              )}
            </>
          )}
        </div>
      </Modal>
      <ConfirmModal
        open={confirming}
        title={S.storage.chats.confirmTitle(count)}
        confirmLabel={S.common.delete}
        cancelLabel={S.common.cancel}
        busy={state.busy}
        onClose={() => (state.busy ? undefined : setConfirming(false))}
        onConfirm={() => void remove()}
      >
        <p className="text-sm text-fg-muted">
          {S.storage.chats.confirmBody(count, formatSize(bytes))}
        </p>
      </ConfirmModal>
    </>
  );
}

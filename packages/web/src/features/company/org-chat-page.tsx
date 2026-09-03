/**
 * The organization's chat: the stream of the loaded days — a separator per day (paging back
 * through earlier day files), consecutive messages by one sender under one avatar and name
 * with each line's time on hover, `system` messages as centred banners, @-mentions as chips
 * (stronger when they address the reader), ticket and session references as chips that
 * open them, an unread divider at the read cursor — and the composer beneath it. The view
 * follows the stream while it is at the bottom; scrolled up, new messages collect behind a
 * pill that returns to the latest. Sitting at the bottom of today marks everything read,
 * which is what clears the nav entry's badge. Nothing here delivers to an employee unless
 * it is @-mentioned; the composer's hint and the empty state say so.
 *
 * Only the chat file is essential: the chart (names, mention candidates) and the member
 * list are best effort, so a hiccup there degrades names to ids rather than blocking the
 * page. The skeleton stands only until the first response; a failed first fetch is an
 * error with a retry inside the stream area, with the composer still there.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { OrgChannelMessage } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime } from "../../lib/format";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import { useDocumentTitle } from "../../lib/use-document-title";
import { toneDot, toneInk, toneSurface } from "../../lib/tone";
import { useAuth } from "../../state/auth";
import { useCompany, useCompanyEvents } from "../../state/company";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { NAV_ICONS } from "../../components/ui/icons";
import { Skeleton } from "../../components/ui/skeleton";
import { toastError } from "../../components/ui/toast";
import { createStreamFollow, stickToBottom } from "../chat/stream-follow";
import { OrgPage, useOrg } from "./org-layout";
import { principalLabel } from "./shared";
import { orgKey, orgPagePath } from "./company-nav";
import { ChatComposer } from "./chat-composer";
import {
  mentionCandidates,
  mentionIsMe,
  mentionLabel,
  mentionRuns,
  mentionsUser,
} from "./chat-mentions";
import {
  appendMessage,
  buildStream,
  clockTime,
  dayKind,
  earlierDay,
  lastMessageId,
  messageCount,
} from "./chat-stream";
import type { ChatDay, StreamItem } from "./chat-stream";
import { parsePrincipal } from "./principals";

/** What the first response fixes for the page's lifetime: today, the day list, and the read cursor the divider is drawn at. */
interface StreamMeta {
  today: string;
  /** Every day with a chat file, newest first. */
  days: string[];
  unreadAfterId: string | null;
}

/** Downward arrow on the return-to-latest pill (lucide arrow-down). */
const ARROW_DOWN_ICON = "M12 5v14M6 13l6 6 6-6";

export function OrgChatPage() {
  const { projectId, orgId, org } = useOrg();
  const navigate = useNavigate();
  const company = useCompany();
  const { user } = useAuth();
  useDocumentTitle(org ? `${org.name} · ${S.nav.org.chat}` : S.nav.org.chat);
  const [days, setDays] = useState<ChatDay[] | null>(null);
  const [meta, setMeta] = useState<StreamMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [employees, setEmployees] = useState<
    ReadonlyArray<{ agentId: string; name: string; title: string }>
  >([]);
  const [members, setMembers] = useState<string[]>([]);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  /** Messages that arrived while the view was scrolled up; shown on the pill. */
  const [pendingNew, setPendingNew] = useState(0);
  const [showJump, setShowJump] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const follow = useMemo(createStreamFollow, []);
  /** The newest id already posted as read: the cursor is written once per new tail, not per render. */
  const markedRef = useRef<string | null>(null);
  /** Scroll anchoring across a prepend: the height before the earlier day landed, and which day was first. */
  const heightRef = useRef(0);
  const firstDayRef = useRef<string | null>(null);
  const me = user?.userId ?? "";
  const myKey = orgKey(projectId, orgId);

  const load = useCallback(async () => {
    // Names and candidates are best effort: the stream must not wait on them.
    void api
      .getOrgChart(projectId, orgId)
      .then((ch) =>
        setEmployees(
          ch.employees.map((e) => ({ agentId: e.agentId, name: e.name, title: e.title })),
        ),
      )
      .catch(() => undefined);
    void api
      .listMembers(projectId)
      .then((res) => setMembers(res.members.map((m) => m.userId)))
      .catch(() => undefined);
    try {
      const res = await api.getOrgChannelMessages(projectId, orgId, api.DEFAULT_CHANNEL_ID);
      setDays([{ date: res.date, messages: res.messages }]);
      setMeta((prev) => ({
        today: res.date,
        days: res.days,
        // The divider stays where the first load put it: marking read must not move it out
        // from under the reader.
        unreadAfterId: prev?.unreadAfterId ?? res.lastReadId ?? null,
      }));
      setError(null);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, orgId]);
  useEffect(() => {
    void load();
  }, [load]);

  const loadEarlier = async () => {
    if (days === null || meta === null || loadingEarlier) return;
    const target = earlierDay(meta.days, days[0]?.date ?? meta.today);
    if (target === null) return;
    setLoadingEarlier(true);
    try {
      const res = await api.getOrgChannelMessages(projectId, orgId, api.DEFAULT_CHANNEL_ID, target);
      setDays((prev) =>
        prev === null || prev.some((d) => d.date === target)
          ? prev
          : [{ date: target, messages: res.messages }, ...prev],
      );
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setLoadingEarlier(false);
    }
  };

  // A new message on this organization lands in the stream without a refetch. While the
  // view is at the bottom it simply appears; scrolled up, it counts towards the pill.
  // The append is decided here, not inside a setDays updater: bumping the pill is a side
  // effect and an updater must stay pure. It reads the latest list through a ref rather
  // than this render's `days`, so two messages arriving before React re-renders both land
  // instead of the second overwriting the first.
  const latestDays = useRef(days);
  latestDays.current = days;
  useCompanyEvents((ev) => {
    if (ev.type !== "org_channel" || orgKey(ev.projectId, ev.orgId) !== myKey) return;
    const current = latestDays.current;
    if (meta === null || current === null) return;
    const next = appendMessage(current, meta.today, ev.message);
    // Unchanged means the message is already in the stream — the reader's own, appended on send.
    if (next === current) return;
    latestDays.current = next;
    setDays(next);
    if (!follow.stick) setPendingNew((n) => n + 1);
  });

  const syncScrollState = () => {
    const el = listRef.current;
    const stick = follow.stick;
    setAtBottom(stick);
    setShowJump(!stick && el !== null && el.scrollHeight - el.scrollTop - el.clientHeight > 1);
    if (stick) setPendingNew(0);
  };

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    follow.scrolled({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    });
    syncScrollState();
  };

  // Before paint: keep the reader's place when an earlier day lands above the viewport, and
  // otherwise stick to the bottom while following.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || days === null) return;
    const firstDay = days[0]?.date ?? null;
    const prepended = firstDayRef.current !== null && firstDay !== firstDayRef.current;
    if (prepended && !follow.stick) el.scrollTop += el.scrollHeight - heightRef.current;
    firstDayRef.current = firstDay;
    heightRef.current = el.scrollHeight;
    if (follow.stick) stickToBottom(el, follow);
    syncScrollState();
    // syncScrollState is recreated per render; the effect keys on the stream's content only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, follow]);

  // The composer growing, or the window resizing, shrinks the stream: re-snap while following.
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      heightRef.current = el.scrollHeight;
      if (follow.stick) stickToBottom(el, follow);
    });
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [follow, days === null]);

  // Sitting at the bottom of the newest day marks its tail as read and clears the badge.
  const lastId = days === null ? null : lastMessageId(days);
  useEffect(() => {
    if (!atBottom || lastId === null || lastId === markedRef.current) return;
    markedRef.current = lastId;
    company.setChatCounters(0, 0);
    void api
      .readOrgChannel(projectId, orgId, api.DEFAULT_CHANNEL_ID, { upTo: lastId })
      .catch(() => undefined);
  }, [atBottom, lastId, company, projectId, orgId]);

  const jumpToLatest = () => {
    const el = listRef.current;
    if (!el) return;
    follow.resume();
    stickToBottom(el, follow);
    syncScrollState();
  };

  const send = async (text: string): Promise<boolean> => {
    try {
      const msg = await api.sendOrgChannelMessage(projectId, orgId, api.DEFAULT_CHANNEL_ID, {
        text,
      });
      follow.resume();
      setDays((prev) =>
        prev === null ? prev : appendMessage(prev, meta?.today ?? msg.time.slice(0, 10), msg),
      );
      return true;
    } catch (e) {
      toastError(apiErrorText(e));
      return false;
    }
  };

  const names = useMemo(() => new Map(employees.map((e) => [e.agentId, e.name])), [employees]);
  const employeeIds = useMemo(() => new Set(employees.map((e) => e.agentId)), [employees]);
  const candidates = useMemo(
    () => mentionCandidates(employees, members, S.company.chat.mentionAll),
    [employees, members],
  );
  const stream = useMemo(
    () => (days === null ? [] : buildStream(days, { unreadAfterId: meta?.unreadAfterId ?? null })),
    [days, meta],
  );
  const earlier =
    days !== null && meta !== null ? earlierDay(meta.days, days[0]?.date ?? meta.today) : null;

  const openTicket = (ticketId: string) =>
    navigate(`${orgPagePath(projectId, orgId, "tickets")}?ticket=${encodeURIComponent(ticketId)}`);
  const scrollToMessage = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ block: "center" });

  const renderText = (m: OrgChannelMessage) =>
    mentionRuns(m.text).map((run, i) =>
      run.mention === null ? (
        <span key={i}>{run.text}</span>
      ) : (
        <MentionChip
          key={i}
          raw={run.text}
          label={mentionLabel(run.mention, names, S.company.principalAll)}
          me={mentionIsMe(run.mention, me, employeeIds)}
        />
      ),
    );

  const renderRefs = (m: OrgChannelMessage) => {
    // Destructured, so each id narrows to `string` inside the chips' closures too.
    const { ticket, session, replyTo } = m.refs ?? {};
    if (ticket === undefined && session === undefined && replyTo === undefined) return null;
    return (
      <span className={`mt-1 flex flex-wrap items-center ${ICON_GAP.row}`}>
        {ticket !== undefined && (
          <RefChip onClick={() => openTicket(ticket)} icon={NAV_ICONS.orgTickets}>
            {S.company.chat.ticketRef(ticket)}
          </RefChip>
        )}
        {session !== undefined && (
          <RefChip onClick={() => navigate(`/chat/${session}`)}>
            {S.company.chat.sessionRef}
          </RefChip>
        )}
        {replyTo !== undefined && (
          <RefChip onClick={() => scrollToMessage(replyTo)}>{S.company.chat.replyTo}</RefChip>
        )}
      </span>
    );
  };

  const renderItem = (item: StreamItem, i: number) => {
    if (item.kind === "day") {
      const kind = meta === null ? "other" : dayKind(item.date, meta.today);
      const label =
        kind === "today"
          ? S.company.chat.today
          : kind === "yesterday"
            ? S.company.chat.yesterday
            : null;
      return (
        <div key={`day-${item.date}`} className={`flex items-center ${ICON_GAP.menu} py-3`}>
          <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
          <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
            {label !== null ? `${label} · ${item.date}` : item.date}
          </span>
          <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
        </div>
      );
    }
    if (item.kind === "unread") {
      return (
        <div
          key={`unread-${i}`}
          className={`flex items-center ${ICON_GAP.menu} py-2`}
          role="separator"
          aria-label={S.company.chat.unreadDivider}
        >
          <span className={`h-px flex-1 ${toneDot.attention}`} />
          <span className={`text-[11px] font-medium ${toneInk.attention}`}>
            {S.company.chat.unreadDivider}
          </span>
          <span className={`h-px flex-1 ${toneDot.attention}`} />
        </div>
      );
    }
    if (item.kind === "system") {
      const m = item.message;
      return (
        <div key={m.id} id={m.id} className="my-2 flex justify-center">
          <p
            title={formatDateTime(m.time)}
            className="max-w-[85%] rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-center text-xs leading-relaxed text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400"
          >
            <span className="sr-only">{S.company.chat.systemMessage} </span>
            {renderText(m)}
            <span className="ml-2 text-gray-400 dark:text-gray-500">{clockTime(m.time)}</span>
            {renderRefs(m)}
          </p>
        </div>
      );
    }
    const first = item.messages[0]!;
    const p = parsePrincipal(item.sender);
    const label = principalLabel(item.sender, names);
    const mine = p.kind === "user" && p.id === me;
    return (
      <div key={first.id} className={`flex ${ICON_GAP.card} py-1.5`}>
        {p.kind === "agent" ? (
          <AgentAvatar id={p.id} name={label} size={28} className="mt-0.5 shrink-0 rounded-md" />
        ) : (
          <span
            aria-hidden
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gray-900 text-xs font-bold text-white dark:bg-gray-200 dark:text-gray-900"
          >
            {label.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className={`flex flex-wrap items-baseline ${ICON_GAP.menu} text-xs`}>
            <span className="font-semibold text-gray-900 dark:text-gray-100">{label}</span>
            {mine && (
              <span className="text-gray-400 dark:text-gray-500">({S.company.chat.you})</span>
            )}
            <span
              className="text-[11px] text-gray-400 dark:text-gray-500"
              title={formatDateTime(first.time)}
            >
              {clockTime(first.time)}
            </span>
            {item.hop > 0 && (
              <span className="text-[11px] text-gray-400 dark:text-gray-500">
                {S.company.chat.hop(item.hop)}
              </span>
            )}
          </div>
          {item.messages.map((m) => {
            const addressed = mentionsUser(m.mentions, me);
            return (
              <div
                key={m.id}
                id={m.id}
                className={`group relative -mx-2 rounded-md px-2 py-0.5 ${
                  addressed
                    ? "bg-amber-50/70 dark:bg-amber-950/25"
                    : "hover:bg-gray-50 dark:hover:bg-gray-900/60"
                }`}
              >
                <p className="whitespace-pre-wrap pr-12 text-sm leading-relaxed text-gray-800 dark:text-gray-200">
                  {renderText(m)}
                </p>
                {renderRefs(m)}
                <span
                  className="absolute right-2 top-0.5 hidden text-[11px] text-gray-400 group-hover:inline dark:text-gray-500"
                  title={formatDateTime(m.time)}
                  aria-label={S.company.chat.sentAt(formatDateTime(m.time))}
                >
                  {clockTime(m.time)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <OrgPage title={S.nav.org.chat} info={S.company.chat.info}>
      {/* The stream and the composer fill the page frame beneath its title: the frame is a
          scroll container (a containing block), so the column is pinned to its edges and the
          stream alone scrolls, whatever the viewport or a notice banner above the shell does. */}
      <div className="absolute inset-x-4 bottom-4 top-[3.75rem] flex flex-col md:inset-x-6 md:bottom-6 md:top-[4.25rem]">
        <div className="relative mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col">
          <div
            ref={listRef}
            role="log"
            aria-label={S.company.chat.title}
            onScroll={onScroll}
            onWheel={(e) => follow.wheel(e.deltaY)}
            onTouchStart={(e) => follow.touchStart(e.touches[0]?.clientY ?? 0)}
            onTouchMove={(e) => follow.touchMove(e.touches[0]?.clientY ?? 0)}
            onTouchEnd={() => follow.touchEnd()}
            className="min-h-0 flex-1 overflow-y-auto pr-1"
          >
            <div>
              {days === null && error !== null ? (
                <EmptyState
                  title={error}
                  action={<Button onClick={() => void load()}>{S.common.retry}</Button>}
                />
              ) : days === null ? (
                <StreamSkeleton />
              ) : (
                <>
                  {earlier !== null ? (
                    <div className="flex justify-center py-2">
                      <Button
                        size="sm"
                        disabled={loadingEarlier}
                        onClick={() => void loadEarlier()}
                      >
                        {loadingEarlier ? S.common.loading : S.company.chat.earlierDays}
                      </Button>
                    </div>
                  ) : (
                    messageCount(days) > 0 && (
                      <p className="py-2 text-center text-[11px] text-gray-400 dark:text-gray-500">
                        {S.company.chat.noEarlier}
                      </p>
                    )
                  )}
                  {messageCount(days) === 0 ? (
                    <EmptyState
                      title={S.company.chat.empty}
                      description={S.company.chat.emptyHint}
                    />
                  ) : (
                    stream.map(renderItem)
                  )}
                </>
              )}
            </div>
          </div>
          {showJump && (
            <button
              type="button"
              aria-label={S.chat.jumpToLatest}
              title={S.chat.jumpToLatest}
              onClick={jumpToLatest}
              className={`anim-pop absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center ${ICON_GAP.tight} rounded-full border border-gray-300 bg-white py-1 pl-2.5 pr-2 text-xs text-gray-600 shadow-sm transition-colors duration-150 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100`}
            >
              {pendingNew > 0 ? S.company.chat.newMessages(pendingNew) : S.chat.jumpToLatest}
              <GlyphIcon d={ARROW_DOWN_ICON} size={ICON_SIZE.inlineGlyph} />
            </button>
          )}
        </div>
        <div className="mx-auto w-full max-w-5xl">
          <ChatComposer candidates={candidates} names={names} onSend={send} />
        </div>
      </div>
    </OrgPage>
  );
}

/** A mention as a chip: the resolved name after the `@`, the raw token in the tooltip; attention-toned when it addresses the reader. */
function MentionChip({ raw, label, me }: { raw: string; label: string; me: boolean }) {
  return (
    <span
      title={raw}
      className={`rounded px-1 ${
        me
          ? `font-semibold ${toneSurface.attention}`
          : "bg-gray-100 font-medium text-gray-800 dark:bg-gray-800 dark:text-gray-100"
      }`}
    >
      @{label}
      {me && <span className="sr-only"> ({S.company.chat.mentionsYou})</span>}
    </span>
  );
}

/** A small bordered chip that opens what a message refers to. */
function RefChip({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon?: string;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center ${ICON_GAP.tight} rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-600 transition-colors duration-150 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100`}
    >
      {icon !== undefined && <GlyphIcon d={icon} size={ICON_SIZE.inlineGlyph} />}
      {children}
    </button>
  );
}

/** Three message-shaped bands while the first day loads. */
function StreamSkeleton() {
  return (
    <div className="space-y-4 py-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className={`flex ${ICON_GAP.card}`}>
          <Skeleton className="h-7 w-7 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className={`h-4 ${i === 1 ? "w-1/2" : "w-3/4"}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

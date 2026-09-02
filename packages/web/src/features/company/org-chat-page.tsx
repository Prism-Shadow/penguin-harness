/**
 * The organization's chat: one day's message stream (sender avatar and name, `system`
 * messages as a grey banner, @-mentions highlighted, ticket and session references as
 * links), paging back through earlier days, and the composer — `@` opens an autocomplete
 * over employees, members and `all`, Enter sends. Viewing the newest message posts the read
 * cursor, which is what clears the nav entry's badge. Nothing here delivers to an employee
 * unless it is @-mentioned; the empty state says so.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router";
import type {
  OrgChatMessage,
  OrgChatResponse,
  OrgChartResponse,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime } from "../../lib/format";
import { useDocumentTitle } from "../../lib/use-document-title";
import { toneInk } from "../../lib/tone";
import { useAuth } from "../../state/auth";
import { useCompany, useCompanyEvents } from "../../state/company";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { Dropdown } from "../../components/ui/dropdown";
import { EmptyState } from "../../components/ui/empty-state";
import { Skeleton } from "../../components/ui/skeleton";
import { noAutofill } from "../../components/ui/input";
import { toastError } from "../../components/ui/toast";
import { OrgPage, useOrg } from "./org-layout";
import { PrincipalChip } from "./shared";
import { orgKey, orgPagePath } from "./company-nav";
import {
  filterMentionCandidates,
  insertMention,
  mentionCandidates,
  mentionQueryAt,
  mentionRuns,
  mentionsUser,
} from "./chat-mentions";
import type { MentionCandidate } from "./chat-mentions";
import { parsePrincipal } from "./principals";

export function OrgChatPage() {
  const { projectId, orgId, org } = useOrg();
  const navigate = useNavigate();
  const company = useCompany();
  const { user } = useAuth();
  useDocumentTitle(org ? `${org.name} · ${S.nav.org.chat}` : S.nav.org.chat);
  const [data, setData] = useState<OrgChatResponse | null>(null);
  const [chart, setChart] = useState<OrgChartResponse | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState<string | undefined>(undefined);
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const me = user?.userId ?? "";
  const myKey = orgKey(projectId, orgId);

  const load = useCallback(async () => {
    try {
      const [chat, ch, mem] = await Promise.all([
        api.getOrgChat(projectId, orgId, date),
        api.getOrgChart(projectId, orgId),
        api.listMembers(projectId).catch(() => ({ members: [] })),
      ]);
      setData(chat);
      setChart(ch);
      setMembers(mem.members.map((m) => m.userId));
      setError(null);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, orgId, date]);
  useEffect(() => {
    void load();
  }, [load]);

  /** Mark everything shown as read once the newest day is on screen, and clear the badge. */
  const markRead = useCallback(
    (messages: readonly OrgChatMessage[], viewingToday: boolean) => {
      if (!viewingToday) return;
      company.setChatCounters(0, 0);
      const last = messages[messages.length - 1];
      if (last !== undefined)
        void api.readOrgChat(projectId, orgId, { upTo: last.id }).catch(() => undefined);
    },
    [company, projectId, orgId],
  );
  const viewingToday = data !== null && (date === undefined || date === data.days[0]);
  useEffect(() => {
    if (data === null) return;
    markRead(data.messages, viewingToday);
    // Follow the stream to its end on load.
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [data, viewingToday, markRead]);

  // A new message on this organization lands in the stream without a refetch (and is read at once while today is on screen).
  useCompanyEvents((ev) => {
    if (ev.type !== "org_chat" || orgKey(ev.projectId, ev.orgId) !== myKey) return;
    setData((prev) => {
      if (prev === null || !viewingToday) return prev;
      if (prev.messages.some((m) => m.id === ev.message.id)) return prev;
      return { ...prev, messages: [...prev.messages, ev.message] };
    });
  });

  const names = new Map((chart?.employees ?? []).map((e) => [e.agentId, e.name]));
  const candidates = useMemo(
    () =>
      mentionCandidates(
        (chart?.employees ?? []).map((e) => ({ agentId: e.agentId, name: e.name })),
        members,
        S.company.chat.mentionAll,
      ),
    [chart, members],
  );
  const mention = mentionQueryAt(text, caret);
  const suggestions = mention === null ? [] : filterMentionCandidates(candidates, mention.query);
  const panelOpen = mention !== null && suggestions.length > 0;

  const pick = (c: MentionCandidate) => {
    if (mention === null) return;
    const next = insertMention(text, mention.start, caret, c.principal);
    setText(next.text);
    setCaret(next.caret);
    setHighlight(0);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
      }
    });
  };

  const send = async () => {
    const body = text.trim();
    if (body === "" || sending) return;
    setSending(true);
    try {
      const msg = await api.sendOrgChat(projectId, orgId, { text: body });
      setText("");
      setCaret(0);
      setData((prev) =>
        prev === null || prev.messages.some((m) => m.id === msg.id)
          ? prev
          : { ...prev, messages: [...prev.messages, msg] },
      );
      if (!viewingToday) setDate(undefined);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (panelOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const c = suggestions[highlight] ?? suggestions[0];
        if (c) pick(c);
        return;
      }
    }
    // Enter sends; Shift+Enter breaks the line. The isComposing guard keeps an IME's
    // candidate-accepting Enter from sending the raw pinyin.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const renderText = (m: OrgChatMessage) =>
    mentionRuns(m.text).map((run, i) =>
      run.mention === null ? (
        <span key={i}>{run.text}</span>
      ) : (
        <span
          key={i}
          className={`rounded px-0.5 font-medium ${toneInk.busy} bg-emerald-50 dark:bg-emerald-950/40`}
        >
          {run.text}
        </span>
      ),
    );

  const message = (m: OrgChatMessage) => {
    const p = parsePrincipal(m.sender);
    if (p.kind === "system") {
      return (
        <div key={m.id} className="my-2 flex justify-center">
          <p className="max-w-[85%] rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-center text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
            {renderText(m)}
            <span className="ml-2 text-gray-400 dark:text-gray-500">{formatDateTime(m.time)}</span>
          </p>
        </div>
      );
    }
    const mine = p.kind === "user" && p.id === me;
    const addressed = mentionsUser(m.mentions, me);
    return (
      <div key={m.id} className={`my-2 flex flex-col ${mine ? "items-end" : "items-start"}`}>
        <div className="mb-0.5 flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
          <PrincipalChip principal={m.sender} names={names} size={16} />
          {mine && <span>({S.company.chat.you})</span>}
          {m.hop > 0 && <span className="text-gray-400">{S.company.chat.hop(m.hop)}</span>}
          <span className="text-gray-400 dark:text-gray-500">{formatDateTime(m.time)}</span>
        </div>
        <div
          className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
            mine
              ? "bg-gray-100 dark:bg-gray-800"
              : addressed
                ? "border border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30"
                : "border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
          }`}
        >
          {renderText(m)}
          {(m.refs?.ticket !== undefined || m.refs?.session !== undefined) && (
            <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
              {m.refs.ticket !== undefined && (
                <button
                  type="button"
                  className={`${toneInk.busy} hover:underline`}
                  onClick={() =>
                    navigate(
                      `${orgPagePath(projectId, orgId, "tickets")}?ticket=${encodeURIComponent(m.refs?.ticket ?? "")}`,
                    )
                  }
                >
                  {S.company.chat.ticketRef(m.refs.ticket)}
                </button>
              )}
              {m.refs.session !== undefined && (
                <button
                  type="button"
                  className={`${toneInk.busy} hover:underline`}
                  onClick={() => navigate(`/chat/${m.refs?.session ?? ""}`)}
                >
                  {S.company.chat.sessionRef}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const dayPicker =
    data !== null && data.days.length > 1 ? (
      <div className="w-40">
        <Select
          size="sm"
          aria-label={S.company.chat.earlierDays}
          value={date ?? data.days[0] ?? ""}
          onChange={(e) => setDate(e.target.value)}
        >
          {data.days.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
      </div>
    ) : undefined;

  return (
    <OrgPage title={S.nav.org.chat} info={S.company.chat.info} actions={dayPicker}>
      {/* The stream and the composer share the page's column: the stream scrolls, the composer stays. */}
      <div className="flex h-[calc(100vh-9rem)] min-h-[24rem] flex-col">
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
          {error !== null && data === null ? (
            <EmptyState
              title={error}
              action={<Button onClick={() => void load()}>{S.common.retry}</Button>}
            />
          ) : data === null ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-2/3" />
              <Skeleton className="h-10 w-1/2" />
            </div>
          ) : data.messages.length === 0 ? (
            <EmptyState title={S.company.chat.empty} description={S.company.chat.emptyHint} />
          ) : (
            data.messages.map(message)
          )}
        </div>
        <div className="mt-3 shrink-0 border-t border-gray-200 pt-3 dark:border-gray-800">
          <Dropdown
            open={panelOpen}
            // Dismissing (outside click, Escape) parks the caret at 0, where no token can
            // end, so the panel stays closed until the next keystroke moves the caret again.
            setOpen={(v) => {
              if (!v) setCaret(0);
            }}
            portal={{ direction: "up", align: "left" }}
            menuClass="w-72"
            focusOnOpen={false}
            button={null}
          >
            <p className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-medium text-gray-400 dark:text-gray-500">
              @
            </p>
            {suggestions.map((c, i) => (
              <button
                key={c.principal}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
                className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 ${
                  i === highlight ? "bg-gray-100 dark:bg-gray-800" : ""
                }`}
              >
                <span className="min-w-0 truncate">
                  <PrincipalChip principal={c.principal} names={names} />
                </span>
                <span className="shrink-0 text-gray-400">
                  {c.kind === "employee"
                    ? S.company.chat.employees
                    : c.kind === "member"
                      ? S.company.chat.members
                      : S.company.chat.mentionAllDesc}
                </span>
              </button>
            ))}
          </Dropdown>
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              rows={2}
              value={text}
              placeholder={S.company.chat.placeholder}
              aria-label={S.company.chat.placeholder}
              disabled={sending}
              {...noAutofill}
              onChange={(e) => {
                setText(e.target.value);
                setCaret(e.target.selectionStart ?? e.target.value.length);
                setHighlight(0);
              }}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
              onKeyDown={onKeyDown}
              className="min-h-[3.25rem] w-full flex-1 resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400/30 dark:border-gray-700 dark:bg-gray-900 dark:placeholder:text-gray-500"
            />
            <Button
              variant="primary"
              disabled={sending || text.trim() === ""}
              onClick={() => void send()}
            >
              {S.company.chat.send}
            </Button>
          </div>
        </div>
      </div>
    </OrgPage>
  );
}

/**
 * The full search page (/search): the sidebar's quick box, given room to be a real surface.
 *
 * Why a page at all: a search that has to answer "which conversation was that phrase in"
 * needs a filter bar (which agent, which workspace, which month, archived or not) and a result
 * row wide enough to read an excerpt in — the sidebar can offer neither, so every hit had to be
 * opened before it could be judged. The page shares the sidebar's endpoint, its page size and
 * its pure logic (lib/session-search.ts) through the shared hook (lib/use-conversation-search.ts);
 * what is new here is the width, the filters, and the deep link.
 *
 * The query lives in the URL (`?q=`), so the sidebar's search box can hand it over in one
 * navigate, a refresh keeps it, and a hit can be linked to. Filters are page state: they are
 * a way of reading this answer rather than a place of its own, so they are not in the URL.
 *
 * A hit's excerpt is the deep link (`/chat/<id>?at=…` — lib/message-jump.ts): the row opens
 * the conversation, and the line the reader recognized opens it pinned to that moment. The
 * chat page scrolls to the exchange that contains it and flashes it; when the moment predates
 * the history it has loaded, it says so instead of landing somewhere else.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { SearchResult } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { formatRelativeShort } from "../../lib/format";
import { workspaceLabel } from "../../lib/session-grouping";
import { DEFAULT_SEARCH_FILTERS, markedSegments, searchExcerpt } from "../../lib/session-search";
import type { SearchFilters, SearchRangePreset } from "../../lib/session-search";
import { messageJumpPath } from "../../lib/message-jump";
import { useConversationSearch } from "../../lib/use-conversation-search";
import { useDocumentTitle } from "../../lib/use-document-title";
import {
  Button,
  EmptyState,
  GlyphIcon,
  Input,
  Segmented,
  Select,
  SkeletonList,
  Switch,
} from "@prismshadow/penguin-ui";
import { Truncated } from "../../components/ui/truncated";

/** The match highlight: yellow in both themes, but the dark one dims rather than glares. */
const MARK_CLASS =
  "rounded-sm bg-yellow-200 px-px text-gray-900 dark:bg-yellow-500/30 dark:text-yellow-50";

const SEARCH_ICON = "M21 21l-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0z";
const CLOSE_ICON = "M18 6L6 18M6 6l12 12";

/** Which kind of message a hit's excerpt came out of, as the row's leading tag. */
function hitRoleLabel(role: string): string {
  switch (role.toLowerCase()) {
    case "user":
      return S.search.roleUser;
    case "assistant":
      return S.search.roleAssistant;
    case "thinking":
      return S.search.roleThinking;
    case "tool":
      return S.search.roleTool;
    default:
      return S.search.roleOther;
  }
}

export function SearchPage() {
  const { currentProject, agents } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const { locale } = useLocale();
  const navigate = useNavigate();
  // The query is the URL's, so the sidebar can hand one over and a refresh keeps it. Replaced
  // rather than pushed: typing is not navigation, and a back button that walks through every
  // keystroke is worse than no back button at all.
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_SEARCH_FILTERS);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useDocumentTitle(S.search.title);

  const setQuery = useCallback(
    (q: string) => {
      const next = new URLSearchParams(params);
      if (q === "") next.delete("q");
      else next.set("q", q);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const search = useConversationSearch(projectId, query, filters);
  const { results, total, index, loading, loadingMore, error, hasMore, loadMore } = search;
  const searching = query.trim() !== "";

  /**
   * `/` and ⌘K focus the field; Esc clears it.
   *
   * The palette owns ⌘P (lib/command-palette.ts), so this is a different chord rather than a
   * competing one, and `/` is bound only while this page is mounted — on a chat page `/` is a
   * character the user is typing, and stealing it there would be a bug, not a shortcut.
   * Cmd/Ctrl+K is the platform's own "go to" chord, which the app has never used.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      if (e.key === "Escape" && document.activeElement === inputRef.current) {
        if (query !== "") {
          e.preventDefault();
          setQuery("");
        }
        return;
      }
      if (typing) return;
      if (e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [query, setQuery]);

  // The Agent a result row names. The list is Project-wide, so the page holds no single
  // id→name map the way the sidebar does — it resolves against the Project's Agent list and
  // falls back to the raw id, which is what the server indexed under.
  const agentName = useCallback(
    (id: string): string => agents.find((a) => a.agentId === id)?.name ?? id,
    [agents],
  );

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4 overflow-y-auto px-5 py-4">
      <header className="shrink-0">
        <h1 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{S.search.title}</h1>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{S.search.focusHint}</p>

        {/* The field: the page's one large control, because everything below it is its answer. */}
        <div className="mt-2.5 flex h-9 items-center gap-2 rounded-lg border border-gray-300 bg-white px-2.5 transition-colors focus-within:border-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:focus-within:border-gray-500">
          <span aria-hidden className="shrink-0 text-gray-400 dark:text-gray-500">
            <GlyphIcon d={SEARCH_ICON} size={15} />
          </span>
          <input
            ref={inputRef}
            // The page opens on its own field — someone who navigated here means to type.
            autoFocus
            value={query}
            aria-label={S.search.title}
            placeholder={S.search.placeholder}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none dark:text-gray-100 dark:placeholder:text-gray-500"
          />
          {query !== "" && (
            <button
              type="button"
              title={S.chat.searchClear}
              aria-label={S.chat.searchClear}
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="flex h-5 w-5 shrink-0 items-center justify-center text-gray-400 transition-colors hover:text-gray-700 dark:hover:text-gray-300"
            >
              <GlyphIcon d={CLOSE_ICON} size={12} />
            </button>
          )}
        </div>

        {/* The filter bar. Every control here is a narrowing of the same question, so they sit
            on one row under the field rather than in a side column that would take the width
            the excerpts need. */}
        <div className="mt-2.5 flex flex-wrap items-end gap-x-3 gap-y-2">
          <Select
            label={S.search.agent}
            value={filters.agentId ?? ""}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                agentId: e.target.value === "" ? undefined : e.target.value,
              }))
            }
            className="w-44"
          >
            <option value="">{S.search.allAgents}</option>
            {agents.map((a) => (
              <option key={a.agentId} value={a.agentId}>
                {a.name ?? a.agentId}
              </option>
            ))}
          </Select>

          <Input
            label={S.search.workspace}
            value={filters.workspace}
            placeholder={S.search.workspacePlaceholder}
            onChange={(e) => setFilters((f) => ({ ...f, workspace: e.target.value }))}
            className="w-52"
          />

          {/* The window control carries its own label because "when" is the one filter whose
              answer is not obvious: the server bounds a chat's CREATION date, so a window that
              says nothing would be read as "when I talked" and quietly drop live chats. */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">{S.search.range}</span>
            <Segmented
              options={[
                { value: "all" as SearchRangePreset, label: S.search.rangeAll },
                { value: "today" as SearchRangePreset, label: S.search.rangeToday },
                { value: "7d" as SearchRangePreset, label: S.search.range7d },
                { value: "30d" as SearchRangePreset, label: S.search.range30d },
              ]}
              value={filters.range}
              onChange={(range) => setFilters((f) => ({ ...f, range }))}
              cols={4}
            />
          </div>

          <label className="flex h-8 items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
            <Switch
              checked={filters.includeArchived}
              onChange={(includeArchived) => setFilters((f) => ({ ...f, includeArchived }))}
              aria-label={S.search.includeArchived}
            />
            {S.search.includeArchived}
          </label>

          <Select
            label={S.search.sort}
            value={filters.sort}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                sort: e.target.value === "recent" ? "recent" : "relevance",
              }))
            }
            className="w-32"
          >
            <option value="relevance">{S.search.sortRelevance}</option>
            <option value="recent">{S.search.sortRecent}</option>
          </Select>
        </div>
      </header>

      {/* One status line: what is being searched, how far the index has got, how many chats
          matched. The count waits for the first answer — a request in flight has not found
          "no chats", it has not answered yet. */}
      {searching && (
        <p className="shrink-0 text-[11px] leading-4 text-gray-400 dark:text-gray-500">
          {[
            filters.agentId === undefined ? S.search.scopeAll : agentName(filters.agentId),
            index.state === "building" ? S.search.indexing(index.indexed, index.total) : null,
            loading && results.length === 0 ? S.search.searching : S.search.found(total),
          ]
            .filter((part) => part !== null)
            .join(" · ")}
        </p>
      )}

      {error !== null && (
        <p className="shrink-0 text-xs text-red-600 dark:text-red-400">{S.search.failed(error)}</p>
      )}

      {!searching && <EmptyState title={S.search.idleTitle} description={S.search.idleHint} />}

      {searching && loading && results.length === 0 && <SkeletonList rows={5} />}

      {searching && !loading && results.length === 0 && error === null && (
        <EmptyState title={S.search.emptyTitle(query.trim())} description={S.search.emptyHint} />
      )}

      <ul className="min-h-0 space-y-1.5">
        {results.map((r) => (
          <ResultRow
            key={r.sessionId}
            result={r}
            locale={locale}
            agentName={agentName(r.agentId)}
            onOpenSession={(sessionId) => void navigate(`/chat/${sessionId}`)}
            onOpenHit={(sessionId, at) => void navigate(messageJumpPath(sessionId, at))}
          />
        ))}
      </ul>

      {hasMore && (
        <Button onClick={loadMore} disabled={loadingMore} className="mx-auto">
          {loadingMore ? S.search.loadingMore : S.search.loadMore}
        </Button>
      )}
    </div>
  );
}

/**
 * One matched conversation: title, when it was last alive, the Agent and Workspace it belongs
 * to and how much of it matched — then the matched messages themselves, each one a link into
 * the conversation pinned to that message.
 *
 * The row and the excerpt are two different destinations on purpose. The row answers "which
 * conversation is this" (open it); the excerpt answers "where inside it" (open it at that
 * line). Making both open the conversation would waste the one thing the excerpt knows.
 */
function ResultRow({
  result,
  locale,
  agentName,
  onOpenSession,
  onOpenHit,
}: {
  result: SearchResult;
  locale: "zh" | "en";
  agentName: string;
  onOpenSession: (sessionId: string) => void;
  onOpenHit: (sessionId: string, at: string) => void;
}) {
  const excerpt = useMemo(() => searchExcerpt(result), [result]);
  return (
    <li className="rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
      <button
        type="button"
        data-testid="search-result-row"
        data-session-id={result.sessionId}
        onClick={() => onOpenSession(result.sessionId)}
        className="flex w-full min-w-0 flex-col items-start gap-0.5 text-left"
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          <Truncated
            text={result.title ?? S.chat.defaultSessionTitle}
            className="min-w-0 flex-1 text-sm font-medium text-gray-800 hover:underline dark:text-gray-200"
          />
          {result.archived && (
            <span className="shrink-0 text-[11px] text-gray-400 dark:text-gray-500">
              {S.search.archived}
            </span>
          )}
          <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
            {formatRelativeShort(result.lastActiveAt, locale)}
          </span>
        </span>

        <span className="flex w-full min-w-0 items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500">
          <Truncated text={agentName} className="min-w-0 shrink" />
          <span aria-hidden>·</span>
          <Truncated text={workspaceLabel(result.workspace)} className="min-w-0 flex-1" />
          {result.matchCount > 0 && (
            <span className="shrink-0 whitespace-nowrap">
              {S.search.matches(result.matchCount)}
            </span>
          )}
        </span>
      </button>

      {/* A title-only match has no message to quote; it says so instead of drawing an empty
          excerpt block that would read as a result with nothing in it. */}
      {result.matchedTitle ? (
        <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">{S.search.titleOnly}</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {excerpt.map((hit, i) => (
            <li key={`${hit.fileIndex}:${hit.lineNo}:${i}`}>
              <button
                type="button"
                data-testid="search-result-hit"
                onClick={() => onOpenHit(result.sessionId, hit.at)}
                title={formatRelativeShort(hit.at, locale)}
                className="flex w-full min-w-0 items-baseline gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  {hitRoleLabel(hit.role)}
                </span>
                {/* The excerpt is one line of its own: the marks are offsets INTO the server's
                    snippet, so the text is cut by those offsets verbatim — trimming first would
                    slide every highlight off the word it belongs to. */}
                <span className="min-w-0 flex-1 truncate text-xs text-gray-600 dark:text-gray-300">
                  {markedSegments(hit.snippet, hit.marks).map((seg, j) =>
                    seg.marked ? (
                      <mark key={j} className={MARK_CLASS}>
                        {seg.text}
                      </mark>
                    ) : (
                      <span key={j}>{seg.text}</span>
                    ),
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

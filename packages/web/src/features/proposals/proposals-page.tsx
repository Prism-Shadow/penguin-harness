/**
 * The proposals pages — two, on one contributed route (`proposals/:number?`): the QUEUE, a
 * full-width list (one row per proposal: its number, its title as the link, its status as a
 * text pill, its author, its unread count and when it last moved; unread first, then newest),
 * and one PROPOSAL as its own page — a breadcrumb back to the queue, the header, the brief,
 * the materials (the implementer's PR among them), the scope table (the one place a file path
 * appears), the body, the sessions opened for it, the event timeline, and the action bar. No
 * side column: the body is what a person reads, and it gets the width.
 *
 * Both are the builtin renderer the company-proposals plugin's page contribution names
 * (`OrgProposalsPage`); it mounts under the organization layout only while the contributions
 * carry that entry, and reads the queue off the company store's index (state/company.tsx),
 * which the sidebar's badge and every `proposal:<n>` capsule share.
 *
 * A comment is on a PASSAGE: the person selects text in a section, a chip offers "Comment on
 * selection", and the comment is stored as a range of that section's Markdown source — found
 * by matching the selected words against the source's plain projection (proposals-model.ts
 * `rangeOfSelection`), so what is stored is exact while what was selected was rendered text.
 * Existing comments show as marks over their passages (attention-toned while pending, plain
 * once sent, faded once resolved); clicking a mark opens the section's comments under it.
 * Pending comments are the person's own until "Request changes" sends them to the author as
 * one batch. Approving requests the merge; rejecting asks for a one-line reason. Opening a
 * proposal marks everything on it read, which is what clears its badge.
 *
 * A `proposal:<n>#<pattern>` capsule lands here with the pattern in the hash (`#p=…`); once the
 * proposal is loaded the pattern is matched against its headings and paragraph first lines
 * and the page scrolls to the hit, marking it for a moment.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import type {
  ProposalComment,
  ProposalDetail,
  ProposalItem,
  ProposalMaterial,
  ProposalPrStatus,
  ProposalMaterialKind,
  ProposalSection,
  ProposalStatus,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime, formatRelativeShort } from "../../lib/format";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import { toneDot, toneInk, toneStrip, toneSurface } from "../../lib/tone";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useAuth } from "../../state/auth";
import { useCompany } from "../../state/company";
import { useLocale } from "../../state/locale";
import { Badge } from "../../components/ui/badge";
import type { BadgeTone } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { CloseIcon, NAV_ICONS } from "../../components/ui/icons";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { Select } from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { Md } from "../chat/md";
import { orgContributedPagePath, orgProposalPath } from "../company/company-nav";
import { EmployeeAvatar } from "../company/employee-avatar";
import { OrgEmptyLine, OrgPage, OrgSection, useOrg } from "../company/org-layout";
import { dismissHint, hintKey, isHintDismissed } from "../company/page-hints";
import {
  ErrorLine,
  JumpButton,
  PrincipalChip,
  TitleButton,
  principalLabel,
} from "../company/shared";
import { PROPOSAL_COMPONENTS, PROPOSAL_REMARK_PLUGINS } from "./proposal-links";
import {
  PROPOSAL_STATUS_TONE,
  commentsInSection,
  eventDetail,
  eventLine,
  DEFAULT_PROPOSAL_QUERY,
  filterProposals,
  hasToken,
  withToken,
  withoutToken,
  findPassage,
  matchProposalPattern,
  orphanComments,
  parseProposalHash,
  proposalActions,
  proposalsRoute,
  paragraphSpan,
  rangeOfSelection,
  scopeFileCandidates,
  sectionSource,
  sortProposals,
} from "./proposals-model";

/** Speech bubble (lucide message-square): the comment chip's mark. */
const COMMENT_ICON = "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z";

/**
 * A material's glyph by kind: a pull request (two branches joined), an issue (a ringed dot),
 * a branch, a document, a ticket (the board's own mark) and a plain link.
 */
const MATERIAL_ICONS: Record<ProposalMaterialKind, string> = {
  pr: "M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM13 6h3a2 2 0 0 1 2 2v7M6 9v6",
  issue: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  branch:
    "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9",
  doc: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  ticket: NAV_ICONS.orgTickets,
  url: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
};

/** The DOM id of a section or paragraph, the target a hash or a pattern scrolls to. */
const domId = (id: string): string => `proposal-${id}`;

/** How long the scrolled-to paragraph keeps its mark. */
const HIGHLIGHT_MS = 2400;

/** The classes a comment's mark wears by state: pending (the person's own, unsent), sent, resolved. */
const MARK_CLASS = {
  pending: `rounded-sm ${toneSurface.attention} cursor-pointer`,
  sent: "rounded-sm bg-gray-200 text-inherit cursor-pointer dark:bg-gray-700",
  resolved:
    "rounded-sm bg-transparent text-inherit underline decoration-dotted decoration-gray-400 cursor-pointer",
};

export function ProposalStatusPill({ status }: { status: ProposalStatus }) {
  return (
    <Badge tone={PROPOSAL_STATUS_TONE[status]}>
      {S.company.proposals.status[status] ?? status}
    </Badge>
  );
}

export function OrgProposalsPage() {
  const params = useParams<{ number?: string }>();
  const route = proposalsRoute(params.number);
  return "queue" in route ? <QueuePage /> : <DetailPage number={route.number} />;
}

/** Employee id → display name, for every principal drawn on these pages. */
function useEmployeeNames(): ReadonlyMap<string, string> {
  const company = useCompany();
  return useMemo(
    () => new Map((company.orgChart?.employees ?? []).map((e) => [e.agentId, e.name])),
    [company.orgChart],
  );
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

function QueuePage() {
  const { projectId, orgId, org } = useOrg();
  const company = useCompany();
  const { user } = useAuth();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const names = useEmployeeNames();
  const t = S.company.proposals;
  useDocumentTitle(org ? `${org.name} · ${S.nav.org.proposals}` : S.nav.org.proposals);

  // The query lives in the URL (`?q=`, omitted at the default), so a filter can be linked
  // and survives a reload; the box edits it debounced, Enter applies at once, Esc resets.
  // An EMPTY query is "everything" and stays in the URL as `?q=` — dropping it would read
  // back as the default and hide the closed half again.
  const [params, setParams] = useSearchParams();
  const query = params.has("q") ? (params.get("q") ?? "") : DEFAULT_PROPOSAL_QUERY;
  const setQuery = useCallback(
    (next: string) => {
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          if (next.trim() === DEFAULT_PROPOSAL_QUERY) out.delete("q");
          else out.set("q", next.trim());
          return out;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const [draft, setDraft] = useState(query);
  const draftTimer = useRef<number | null>(null);
  useEffect(() => {
    setDraft(query);
  }, [query]);
  const editDraft = (next: string) => {
    setDraft(next);
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => setQuery(next), 150);
  };
  const applyDraft = useCallback(
    (next: string) => {
      if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
      setDraft(next);
      setQuery(next);
    },
    [setQuery],
  );
  const [createOpen, setCreateOpen] = useState(false);

  // The empty-queue note goes away for good once read; the page's "?" carries the same
  // sentence. Keyed by organization, so switching to another one re-reads the dismissal.
  const emptyHintKey = hintKey(user?.userId ?? null, projectId, orgId, "proposals");
  const [hintDismissed, setHintDismissed] = useState(() => isHintDismissed(emptyHintKey));
  useEffect(() => {
    setHintDismissed(isHintDismissed(emptyHintKey));
  }, [emptyHintKey]);

  const queue = useMemo(
    () =>
      company.proposals === null ? null : sortProposals(filterProposals(company.proposals, query)),
    [company.proposals, query],
  );
  // The chips: one per lifecycle state (replacing the `is:` tokens), All (none), and an
  // Unread toggle. Each counts what it would show, with the query's other tokens kept.
  const chips = useMemo(() => {
    const all = company.proposals ?? [];
    const rest = withoutToken(query, "is");
    const count = (q: string) => filterProposals(all, q).length;
    const state = (value: string, label: string) => ({
      key: value,
      label,
      on: hasToken(query, "is", value),
      count: count(withToken(rest, "is", value)),
      apply: () => applyDraft(withToken(query, "is", value, { replace: true })),
    });
    return {
      states: [
        state("open", t.chip.open),
        state("ready", t.chip.ready),
        state("approved", t.chip.approved),
        state("merged", t.chip.merged),
        state("rejected", t.chip.rejected),
        {
          key: "all",
          label: t.chip.all,
          on: !hasToken(query, "is"),
          count: count(rest),
          apply: () => applyDraft(rest),
        },
      ],
      unread: {
        on: hasToken(query, "unread", "yes"),
        count: count(withToken(withoutToken(query, "unread"), "unread", "yes")),
        apply: () =>
          applyDraft(
            hasToken(query, "unread", "yes")
              ? withoutToken(query, "unread")
              : withToken(withoutToken(query, "unread"), "unread", "yes"),
          ),
      },
    };
  }, [applyDraft, company.proposals, query, t]);
  const open = (number: number) => navigate(orgProposalPath(projectId, orgId, number));

  return (
    <OrgPage
      title={S.nav.org.proposals}
      info={t.info}
      actions={
        <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
          {t.newProposal}
        </Button>
      }
    >
      {company.proposalsError !== null && (
        <ErrorLine
          message={t.loadFailed}
          detail={company.proposalsError}
          onRetry={() => void company.reloadProposals()}
          className="mb-3"
        />
      )}

      {queue !== null && company.proposals?.length === 0 && !hintDismissed && (
        <div
          className={`mb-3 flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${toneStrip.muted}`}
        >
          <span className="min-w-0 flex-1">{t.queueEmptyHint}</span>
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0"
            title={t.dismissHint}
            aria-label={t.dismissHint}
            onClick={() => {
              dismissHint(emptyHintKey);
              setHintDismissed(true);
            }}
          >
            <CloseIcon />
          </Button>
        </div>
      )}

      <div className="mb-2 max-w-lg">
        <Input
          size="sm"
          value={draft}
          aria-label={t.search}
          placeholder={t.searchPlaceholder}
          className="font-mono text-xs"
          onChange={(e) => editDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") applyDraft(draft);
            else if (e.key === "Escape") applyDraft(DEFAULT_PROPOSAL_QUERY);
          }}
        />
      </div>
      {/* The chips: a pill group for the lifecycle, an Unread toggle apart from it. A chip
          carries its count so the hidden halves of the queue are never a surprise. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <div
          role="group"
          aria-label={t.chip.group}
          className="inline-flex flex-wrap gap-0.5 rounded-md bg-gray-100 p-0.5 dark:bg-gray-800"
        >
          {chips.states.map((chip) => (
            <QueueChip key={chip.key} on={chip.on} count={chip.count} onClick={chip.apply}>
              {chip.label}
            </QueueChip>
          ))}
        </div>
        <QueueChip
          on={chips.unread.on}
          count={chips.unread.count}
          onClick={chips.unread.apply}
          toggle
        >
          {t.chip.unread}
        </QueueChip>
      </div>
      {queue === null ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : queue.length === 0 ? (
        company.proposals?.length === 0 ? (
          <OrgEmptyLine>{t.queueEmpty}</OrgEmptyLine>
        ) : (
          <OrgEmptyLine>
            {t.noMatch(query)}{" "}
            <TitleButton onClick={() => applyDraft("")} className="text-xs">
              {t.showAll}
            </TitleButton>
          </OrgEmptyLine>
        )
      ) : (
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {queue.map((item) => (
            <QueueRow
              key={item.number}
              item={item}
              names={names}
              locale={locale}
              onOpen={() => open(item.number)}
            />
          ))}
        </ul>
      )}

      <NewProposalDialog
        open={createOpen}
        projectId={projectId}
        orgId={orgId}
        onClose={() => setCreateOpen(false)}
        onCreated={(item) => {
          setCreateOpen(false);
          company.proposalsChanged();
          toastSuccess(t.created(item.number));
          open(item.number);
        }}
      />
    </OrgPage>
  );
}

/**
 * One chip of the queue's filter bar: a small pill that is "on" when its token is in the
 * query, with the count it would show. In the group it selects a lifecycle state; alone
 * (`toggle`) it is the Unread switch. The count is tabular so the chips do not jitter.
 */
function QueueChip({
  on,
  count,
  toggle = false,
  onClick,
  children,
}: {
  on: boolean;
  count: number;
  toggle?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const shape = toggle ? "rounded-md border border-gray-200 dark:border-gray-800" : "rounded";
  const ink = on
    ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100"
    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100";
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:outline-none ${shape} ${ink}`}
    >
      <span>{children}</span>
      <span className="tabular-nums text-[10px] text-gray-400 dark:text-gray-500">{count}</span>
    </button>
  );
}

/**
 * One row of the queue. The title is the link (a text button, underlined on hover); the
 * row itself is inert, tinting a little under the pointer. A row with unread events wears a
 * 2px bar on its left edge in the attention tone and its count at the right; the status is a
 * text pill after the title; the author, the implementer when another, and when it last
 * moved sit on a quiet second line.
 */
function QueueRow({
  item,
  names,
  locale,
  onOpen,
}: {
  item: ProposalItem;
  names: ReadonlyMap<string, string>;
  locale: "zh" | "en";
  onOpen: () => void;
}) {
  const t = S.company.proposals;
  const author = names.get(item.author) ?? item.author;
  const implementer =
    item.implementer !== null && item.implementer !== item.author
      ? (names.get(item.implementer) ?? item.implementer)
      : null;
  return (
    <li
      className={`relative flex items-start gap-3 px-3 py-2.5 transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-900 ${
        item.unread > 0 ? "pl-4" : ""
      }`}
    >
      {item.unread > 0 && (
        <span
          aria-hidden="true"
          className={`absolute top-2 bottom-2 left-0 w-0.5 rounded-r ${toneDot.attention}`}
        />
      )}
      <span className="mt-0.5 w-10 shrink-0 font-mono text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
        #{item.number}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <TitleButton
            onClick={onOpen}
            title={t.openProposal}
            className="text-sm font-medium focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:outline-none"
          >
            <span className="line-clamp-2">{item.title}</span>
          </TitleButton>
          <ProposalStatusPill status={item.status} />
        </div>
        <div
          className={`mt-1 flex flex-wrap items-center ${ICON_GAP.row} text-[11px] text-gray-500 dark:text-gray-400`}
        >
          <EmployeeAvatar
            id={item.author}
            name={author}
            size={ICON_SIZE.rowLead}
            className="shrink-0 rounded"
          />
          <span className="truncate">{author}</span>
          {implementer !== null && (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate" title={t.implementer}>
                {t.implementer} {implementer}
              </span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span title={formatDateTime(item.updatedAt)}>
            {t.updated} {formatRelativeShort(item.updatedAt, locale)}
          </span>
        </div>
      </div>
      {item.unread > 0 && (
        <span
          title={t.unreadBadge(item.unread)}
          aria-label={t.unreadBadge(item.unread)}
          className={`mt-0.5 shrink-0 rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${toneSurface.attention}`}
        >
          {item.unread}
        </span>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// One proposal
// ---------------------------------------------------------------------------

function DetailPage({ number }: { number: number }) {
  const { projectId, orgId, org } = useOrg();
  const { user } = useAuth();
  const company = useCompany();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const names = useEmployeeNames();
  const t = S.company.proposals;

  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"request" | "approve" | "reject" | "merged" | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);

  useDocumentTitle(
    detail === null
      ? `#${number} · ${S.nav.org.proposals}`
      : `#${number} ${detail.title} · ${org?.name ?? S.nav.org.proposals}`,
  );

  const proposalsVersion = company.versions.proposals;

  // The proposal's detail: read on arrival and whenever the index says a proposal moved (the
  // plugin's event, or a write from this page).
  const loadDetail = useCallback(async () => {
    try {
      const d = await api.getOrgProposal(projectId, orgId, number);
      setDetail(d);
      setDetailError(null);
    } catch (e) {
      setDetailError(apiErrorText(e));
    }
  }, [projectId, orgId, number]);
  useEffect(() => {
    setDetail(null);
    setDetailError(null);
  }, [number]);
  useEffect(() => {
    void loadDetail();
  }, [loadDetail, proposalsVersion]);

  // Reading is what marks read: once the detail is on screen, the read position moves to its
  // latest event, and the badge clears here before the server confirms.
  const readSeqRef = useRef<{ number: number; seq: number } | null>(null);
  useEffect(() => {
    if (detail === null || detail.unread === 0) return;
    const last = readSeqRef.current;
    if (last !== null && last.number === detail.number && last.seq >= detail.seq) return;
    readSeqRef.current = { number: detail.number, seq: detail.seq };
    company.markProposalRead(detail.number);
    void api.readOrgProposal(projectId, orgId, detail.number, { upTo: detail.seq }).catch(() => {
      // A lost write only costs a badge that comes back on the next listing.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the store's mark is stable per Provider
  }, [detail, projectId, orgId]);

  // The hash names where to land: a pattern from a capsule, or an element id. Resolved once
  // per detail, since the paragraph ids are the detail's.
  useEffect(() => {
    if (detail === null) return;
    const target = parseProposalHash(location.hash);
    if (target === null) return;
    const id =
      "pattern" in target
        ? (matchProposalPattern(detail, target.pattern)?.targetId ?? null)
        : target.targetId;
    if (id === null) return;
    const el = document.getElementById(domId(id));
    if (el === null) return;
    el.scrollIntoView({ block: "center" });
    setHighlightId(id);
    const timer = window.setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [detail, location.hash]);

  /** One write against the proposal: the answer is the new detail, and every other surface refetches off the store's bump. */
  const write = async (run: () => Promise<ProposalDetail>, done: string): Promise<boolean> => {
    setBusy(true);
    try {
      const next = await run();
      setDetail(next);
      company.proposalsChanged();
      toastSuccess(done);
      return true;
    } catch (e) {
      toastError(apiErrorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = async () => {
    if (detail === null || confirm === null) return;
    let ok = false;
    if (confirm === "request") {
      ok = await write(
        () => api.requestOrgProposalChanges(projectId, orgId, number),
        t.changesRequested,
      );
    } else if (confirm === "approve") {
      ok = await write(() => api.approveOrgProposal(projectId, orgId, number), t.approved);
    } else if (confirm === "reject") {
      ok = await write(
        () => api.rejectOrgProposal(projectId, orgId, number, { reason: rejectReason.trim() }),
        t.rejected,
      );
    } else {
      ok = await write(() => api.mergedOrgProposal(projectId, orgId, number), t.merged);
    }
    if (ok) {
      setConfirm(null);
      setRejectReason("");
    }
  };

  /** A comment on a passage: the range the selection names in the section's source, quoted exactly as the server will check it. */
  const addComment = async (
    section: ProposalSection,
    selectedText: string,
    paragraphId: string | null,
    text: string,
    whole = false,
  ): Promise<boolean> => {
    if (detail === null) return false;
    const source = sectionSource(section);
    // A whole paragraph (the hover button) is its own span; a selection is looked up.
    const range =
      whole && paragraphId !== null
        ? paragraphSpan(section, paragraphId)
        : rangeOfSelection(
            source,
            selectedText,
            paragraphId === null ? undefined : { section, paragraphId },
          );
    if (range === null) {
      toastError(t.selectionNotPlaced);
      return false;
    }
    return write(
      () =>
        api.commentOrgProposal(projectId, orgId, detail.number, {
          sectionId: section.id,
          start: range.start,
          end: range.end,
          quote: source.slice(range.start, range.end),
          text,
        }),
      t.commentAdded,
    );
  };

  /**
   * A scope file opens in the Files tab of a session that has it — the implementation
   * sessions (newest first), then the author's desk — at the path it has there: as
   * written, or under the organization's shared workspace. None has it: say so, and leave
   * the path on the clipboard.
   */
  const openScopeFile = async (file: string): Promise<void> => {
    if (detail === null) return;
    const candidates = [...detail.sessions].reverse();
    try {
      candidates.push((await api.getOrgDesk(projectId, orgId, detail.author)).sessionId);
    } catch {
      // No desk to fall back to; the implementation sessions may still have it.
    }
    let orgWorkspace: string | null = null;
    try {
      orgWorkspace = (await api.getOrganization(projectId, orgId)).settings.workspace ?? null;
    } catch {
      // The scope is then read only as Workspace-relative.
    }
    for (const sessionId of candidates) {
      let workspace: string;
      try {
        workspace = (await api.getSession(sessionId)).session.workspace;
      } catch {
        continue;
      }
      for (const rel of scopeFileCandidates(file, workspace, orgWorkspace)) {
        const stat = await api.statSessionFiles(sessionId, [rel]).catch(() => null);
        if (stat?.existing.includes(rel)) {
          navigate(`/chat/${sessionId}?file=${encodeURIComponent(rel)}`);
          return;
        }
      }
    }
    toastError(t.fileNotInWorkspace);
    await navigator.clipboard?.writeText(file).catch(() => undefined);
  };

  /** The person's own pending comments are theirs to reword or withdraw until sent. */
  const me = user == null ? null : `user:${user.userId}`;
  const editComment = (commentId: string, text: string): Promise<boolean> =>
    detail === null
      ? Promise.resolve(false)
      : write(
          () => api.editOrgProposalComment(projectId, orgId, detail.number, commentId, { text }),
          t.commentEdited,
        );
  const deleteComment = (commentId: string): Promise<boolean> =>
    detail === null
      ? Promise.resolve(false)
      : write(
          () => api.deleteOrgProposalComment(projectId, orgId, detail.number, commentId),
          t.commentDeleted,
        );

  const actions = detail === null ? null : proposalActions(detail.status, detail.pendingComments);
  const crumb = (
    <nav aria-label={S.nav.org.proposals} className="mb-3 text-xs text-gray-500 dark:text-gray-400">
      <TitleButton
        onClick={() => navigate(orgContributedPagePath(projectId, orgId, "proposals"))}
        title={t.backToQueue}
        className="text-xs"
      >
        {S.nav.org.proposals}
      </TitleButton>
      <span className="mx-1.5" aria-hidden="true">
        ›
      </span>
      <span className="font-mono">#{number}</span>
    </nav>
  );

  return (
    <OrgPage title={detail?.title ?? `#${number}`} info={t.info}>
      {crumb}
      {detailError !== null ? (
        <ErrorLine message={t.loadFailed} detail={detailError} onRetry={() => void loadDetail()} />
      ) : detail === null ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-16" />
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <ProposalView
          detail={detail}
          names={names}
          locale={locale}
          highlightId={highlightId}
          busy={busy}
          onComment={addComment}
          onOpenSession={(sessionId) => navigate(`/chat/${sessionId}`)}
          onOpenTicket={(ticketId) => company.openTicket(projectId, orgId, ticketId)}
          onOpenFile={openScopeFile}
          me={me}
          onEditComment={editComment}
          onDeleteComment={deleteComment}
          actions={
            actions === null ? null : (
              <>
                <Button
                  size="sm"
                  disabled={busy || !actions.requestChanges}
                  onClick={() => setConfirm("request")}
                >
                  {t.requestChanges(detail.pendingComments)}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy || !actions.approve}
                  onClick={() => setConfirm("approve")}
                >
                  {t.approve}
                </Button>
                {actions.markMerged && (
                  <Button size="sm" disabled={busy} onClick={() => setConfirm("merged")}>
                    {t.markMerged}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy || !actions.reject}
                  onClick={() => setConfirm("reject")}
                >
                  {t.reject}
                </Button>
              </>
            )
          }
        />
      )}

      <ConfirmModal
        open={confirm !== null}
        title={
          confirm === "request"
            ? t.requestChangesTitle
            : confirm === "approve"
              ? t.approveTitle
              : confirm === "merged"
                ? t.markMergedTitle
                : t.rejectTitle
        }
        tone={confirm === "reject" ? "danger" : "primary"}
        confirmLabel={S.common.confirm}
        confirmDisabled={confirm === "reject" && rejectReason.trim() === ""}
        busy={busy}
        onClose={() => {
          setConfirm(null);
          setRejectReason("");
        }}
        onConfirm={() => void onConfirm()}
      >
        <div className="space-y-2">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {detail === null || confirm === null
              ? ""
              : confirm === "request"
                ? t.requestChangesConfirm(detail.pendingComments)
                : confirm === "approve"
                  ? t.approveConfirm(detail.title)
                  : confirm === "merged"
                    ? t.markMergedConfirm(detail.title)
                    : t.rejectConfirm(detail.title)}
          </p>
          {confirm === "reject" && (
            <Input
              size="sm"
              label={t.rejectReason}
              required
              value={rejectReason}
              hint={t.rejectReasonHint}
              autoFocus
              onChange={(e) => setRejectReason(e.target.value)}
            />
          )}
        </div>
      </ConfirmModal>
    </OrgPage>
  );
}

/** The proposal: header, brief, materials, scope, body with its comments, sessions, events, and the action bar at the foot. */
function ProposalView({
  detail,
  names,
  locale,
  highlightId,
  busy,
  onComment,
  onOpenSession,
  onOpenTicket,
  onOpenFile,
  me,
  onEditComment,
  onDeleteComment,
  actions,
}: {
  detail: ProposalDetail;
  names: ReadonlyMap<string, string>;
  locale: "zh" | "en";
  highlightId: string | null;
  busy: boolean;
  onComment: (
    section: ProposalSection,
    selectedText: string,
    paragraphId: string | null,
    text: string,
    whole?: boolean,
  ) => Promise<boolean>;
  onOpenSession: (sessionId: string) => void;
  onOpenTicket: (ticketId: string) => void;
  /** A scope file: opened in the Files tab of a session that has it (the implementation's, else the author's desk). */
  onOpenFile: (file: string) => Promise<void>;
  /** The signed-in person's principal: whose pending comments carry Edit / Delete. */
  me: string | null;
  onEditComment: (commentId: string, text: string) => Promise<boolean>;
  onDeleteComment: (commentId: string) => Promise<boolean>;
  actions: ReactNode;
}) {
  const t = S.company.proposals;
  const stale = useMemo(
    () => orphanComments(detail.comments, detail.revision),
    [detail.comments, detail.revision],
  );
  const events = useMemo(() => [...detail.events].reverse(), [detail.events]);
  const closed = detail.status === "merged" || detail.status === "rejected";
  return (
    <div className="space-y-6">
      <header>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-xs text-gray-400 dark:text-gray-500">
            #{detail.number}
          </span>
          <ProposalStatusPill status={detail.status} />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {detail.revision === 0 ? t.noRevision : t.revision(detail.revision)}
          </span>
        </div>
        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          <Meta label={t.author}>
            <PrincipalChip principal={`agent:${detail.author}`} names={names} />
          </Meta>
          <Meta label={t.implementer}>
            {detail.implementer === null ? (
              <span>{t.noImplementer}</span>
            ) : (
              <PrincipalChip principal={`agent:${detail.implementer}`} names={names} />
            )}
          </Meta>
          <Meta label={t.delegatedBy}>
            <PrincipalChip principal={detail.delegatedBy} names={names} />
          </Meta>
          <Meta label={S.common.created}>
            <span title={formatDateTime(detail.createdAt)}>
              {formatRelativeShort(detail.createdAt, locale)}
            </span>
          </Meta>
        </dl>
      </header>

      <OrgSection title={t.briefSection}>
        <div className="md-body md-compact text-sm text-gray-800 dark:text-gray-100">
          <Md
            text={detail.brief}
            extraPlugins={PROPOSAL_REMARK_PLUGINS}
            components={PROPOSAL_COMPONENTS}
          />
        </div>
      </OrgSection>

      <OrgSection title={t.materials} count={detail.materials.length}>
        {detail.materials.length === 0 ? (
          <OrgEmptyLine>{t.materialsEmpty}</OrgEmptyLine>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {detail.materials.map((m) => (
              <MaterialRow key={`${m.kind}:${m.url}`} material={m} onOpenTicket={onOpenTicket} />
            ))}
          </ul>
        )}
      </OrgSection>

      <OrgSection title={t.scope} count={detail.scope.length}>
        {detail.scope.length === 0 ? (
          <OrgEmptyLine>{t.scopeEmpty}</OrgEmptyLine>
        ) : (
          <ul className="divide-y divide-gray-100 text-xs dark:divide-gray-800">
            {detail.scope.map((entry, i) => (
              // A list, not a table: a long name pattern wraps under its file instead of
              // squeezing the file column to a character a line.
              <li key={`${entry.file}-${i}`} className="py-1.5">
                <div className="font-mono break-all">
                  <TitleButton
                    onClick={() => void onOpenFile(entry.file)}
                    title={t.openFile}
                    className="font-mono"
                  >
                    {entry.file}
                  </TitleButton>
                </div>
                {entry.name !== undefined && (
                  <div className="mt-0.5 font-mono whitespace-pre-wrap break-all text-gray-500 dark:text-gray-400">
                    <span className="mr-1 text-[11px] uppercase tracking-wide">
                      {t.scopePattern}
                    </span>
                    {entry.name}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </OrgSection>

      <OrgSection title={t.sections}>
        {detail.sections.length === 0 ? (
          <OrgEmptyLine>{t.sectionsEmpty}</OrgEmptyLine>
        ) : (
          <>
            {!closed && (
              <p className="mb-3 text-[11px] text-gray-400 dark:text-gray-500">{t.selectionHint}</p>
            )}
            <ProposalBody
              detail={detail}
              names={names}
              locale={locale}
              highlightId={highlightId}
              busy={busy}
              closed={closed}
              onComment={onComment}
              me={me}
              onEditComment={onEditComment}
              onDeleteComment={onDeleteComment}
            />
          </>
        )}
        {stale.length > 0 && (
          <div className="mt-5">
            <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t.staleComments}
            </h4>
            <div className="space-y-2">
              {stale.map((c) => (
                <CommentLine
                  key={c.id}
                  comment={c}
                  names={names}
                  locale={locale}
                  stale
                  mine={me !== null && c.by === me}
                  busy={busy}
                  onEdit={onEditComment}
                  onDelete={onDeleteComment}
                />
              ))}
            </div>
          </div>
        )}
      </OrgSection>

      {detail.sessions.length > 0 && (
        <OrgSection title={t.sessions} count={detail.sessions.length}>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {detail.sessions.map((sessionId) => (
              <li
                key={sessionId}
                className="flex items-center justify-between gap-2 py-1.5 text-xs"
              >
                <span className="truncate font-mono text-gray-600 dark:text-gray-300">
                  {sessionId}
                </span>
                <JumpButton label={t.openSession} onClick={() => onOpenSession(sessionId)} />
              </li>
            ))}
          </ul>
        </OrgSection>
      )}

      <OrgSection title={t.events} count={events.length}>
        <ol className="space-y-2">
          {events.map((ev) => {
            const more = eventDetail(ev);
            return (
              <li key={ev.seq} className="flex items-start gap-2 text-xs">
                <span
                  className="w-14 shrink-0 tabular-nums text-gray-400 dark:text-gray-500"
                  title={formatDateTime(ev.at)}
                >
                  {formatRelativeShort(ev.at, locale)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-1.5">
                    <PrincipalChip principal={ev.by} names={names} />
                    <span className="text-gray-600 dark:text-gray-300">{eventLine(ev, names)}</span>
                  </div>
                  {more !== null && (
                    <div className="md-body md-compact mt-0.5 text-gray-700 dark:text-gray-200">
                      <Md
                        text={more}
                        extraPlugins={PROPOSAL_REMARK_PLUGINS}
                        components={PROPOSAL_COMPONENTS}
                      />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </OrgSection>

      {/* The action bar sits at the foot of the page and stays in view while the body
          scrolls under it: the decision is taken after reading, so it waits at the end. */}
      {actions !== null && (
        <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 bg-white/95 px-1 py-3 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95">
          {actions}
        </div>
      )}
    </div>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <dt className="shrink-0">{label}</dt>
      <dd className="flex min-w-0 items-center text-gray-700 dark:text-gray-200">{children}</dd>
    </div>
  );
}

/**
 * A material as one row: the kind's glyph and word, the label as the link (a bare ticket id
 * opens the ticket dialog, a URL opens in a new tab), a pull request's state on GitHub as a
 * pill when the server could read it, and the URL's own text muted at the right.
 */
function MaterialRow({
  material,
  onOpenTicket,
}: {
  material: ProposalMaterial;
  onOpenTicket: (ticketId: string) => void;
}) {
  const t = S.company.proposals;
  const kind = t.materialKind[material.kind] ?? material.kind;
  const isTicket = material.kind === "ticket" && !/^[a-z][a-z0-9+.-]*:/i.test(material.url);
  const link = "font-medium hover:underline";
  return (
    <li className={`flex items-center ${ICON_GAP.row} py-1.5 text-xs`}>
      <GlyphIcon
        d={MATERIAL_ICONS[material.kind]}
        size={ICON_SIZE.inlineGlyph}
        className="shrink-0 text-gray-500 dark:text-gray-400"
      />
      <span className="shrink-0 text-gray-500 dark:text-gray-400">{kind}</span>
      {isTicket ? (
        <button
          type="button"
          className={link}
          title={material.url}
          onClick={() => onOpenTicket(material.url)}
        >
          {material.label}
        </button>
      ) : (
        <a
          href={material.url}
          target="_blank"
          rel="noreferrer"
          title={material.url}
          className={link}
        >
          {material.label}
        </a>
      )}
      {material.status !== undefined && (
        <Badge tone={MATERIAL_STATUS_TONE[material.status]}>
          {t.materialStatus[material.status] ?? material.status}
        </Badge>
      )}
      {!isTicket && (
        <span className="ml-auto min-w-0 truncate pl-3 text-gray-400 dark:text-gray-500">
          {material.url.replace(/^https?:\/\//, "")}
        </span>
      )}
    </li>
  );
}

/** A pull request's state as a badge tone: merged is done, open is a link to follow, draft is not there yet, closed went nowhere. */
const MATERIAL_STATUS_TONE: Record<ProposalPrStatus, BadgeTone> = {
  draft: "gray",
  open: "brand",
  merged: "green",
  closed: "red",
};

// ---------------------------------------------------------------------------
// The body: sections, passage marks, the selection chip and the composer
// ---------------------------------------------------------------------------

/** What the person selected: the section it lies in, the paragraph it starts in, the words, and where to put the chip. */
interface Selection {
  sectionId: string;
  paragraphId: string | null;
  text: string;
  top: number;
  left: number;
  /** The whole paragraph, from its hover button — no words to look up. */
  whole?: boolean;
}

/**
 * The sections, each a block of paragraphs rendered as Markdown, over which the comments
 * are drawn as marks (a DOM pass after every render — see markComments) and a selection
 * offers a chip. Under a section its comments unfold: opened by the chip on the section's
 * count, or by clicking a mark, which also names the comment.
 */
function ProposalBody({
  detail,
  names,
  locale,
  highlightId,
  busy,
  closed,
  onComment,
  me,
  onEditComment,
  onDeleteComment,
}: {
  detail: ProposalDetail;
  names: ReadonlyMap<string, string>;
  locale: "zh" | "en";
  highlightId: string | null;
  busy: boolean;
  closed: boolean;
  me: string | null;
  onEditComment: (commentId: string, text: string) => Promise<boolean>;
  onDeleteComment: (commentId: string) => Promise<boolean>;
  onComment: (
    section: ProposalSection,
    selectedText: string,
    paragraphId: string | null,
    text: string,
    whole?: boolean,
  ) => Promise<boolean>;
}) {
  const t = S.company.proposals;
  const rootRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [composer, setComposer] = useState<Selection | null>(null);
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(new Set());
  const [focusedComment, setFocusedComment] = useState<string | null>(null);

  // The marks: cleared and drawn again whenever the comments or the text change. They are
  // DOM the renderer does not know about, which is why they go on after render and come
  // off before the next pass rather than living in React's tree.
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    clearMarks(root);
    for (const section of detail.sections) {
      const block = root.querySelector<HTMLElement>(`[data-section-id="${section.id}"]`);
      if (block === null) continue;
      for (const c of commentsInSection(detail.comments, section.id, detail.revision)) {
        markPassage(block, c, principalLabel(c.by, names));
      }
    }
    return () => clearMarks(root);
  }, [detail.sections, detail.comments, detail.revision, names]);

  const readSelection = () => {
    const root = rootRef.current;
    const sel = window.getSelection();
    if (root === null || sel === null || sel.isCollapsed || sel.rangeCount === 0) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const startBlock = sectionOf(range.startContainer);
    const endBlock = sectionOf(range.endContainer);
    if (startBlock === null || startBlock !== endBlock || !root.contains(startBlock)) {
      setSelection(null);
      return;
    }
    const text = sel.toString();
    if (text.trim() === "") {
      setSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    setSelection({
      sectionId: startBlock.dataset.sectionId ?? "",
      paragraphId: paragraphOf(range.startContainer),
      text,
      top: rect.bottom - rootRect.top + 6,
      left: Math.max(0, Math.min(rect.left - rootRect.left, rootRect.width - 160)),
    });
  };

  const onMouseUp = (e: ReactMouseEvent<HTMLDivElement>) => {
    const mark = (e.target as HTMLElement).closest?.("mark[data-comment]");
    if (mark instanceof HTMLElement) {
      const id = mark.dataset.comment ?? null;
      const sectionId = sectionOf(mark)?.dataset.sectionId ?? null;
      if (id !== null && sectionId !== null) {
        setFocusedComment(id);
        setOpenSections((prev) => new Set([...prev, sectionId]));
      }
    }
    // The browser settles the selection after mouseup; read it once it has.
    window.setTimeout(readSelection, 0);
  };

  const toggleSection = (sectionId: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });

  const sectionById = (id: string) => detail.sections.find((s) => s.id === id) ?? null;

  return (
    <div ref={rootRef} className="relative" onMouseUp={onMouseUp}>
      <div className="space-y-5">
        {detail.sections.map((section) => {
          const comments = commentsInSection(detail.comments, section.id, detail.revision);
          const isOpen = openSections.has(section.id);
          return (
            <div key={section.id} id={domId(section.id)} className="scroll-mt-4">
              <h3
                className={`mb-2 text-sm font-semibold ${
                  highlightId === section.id ? `rounded px-1 ${toneSurface.attention}` : ""
                }`}
              >
                {section.heading}
              </h3>
              <div data-section-id={section.id} className="space-y-2">
                {section.paragraphs.map((paragraph) => (
                  // A paragraph is a hover target: its surface tints and a Comment button
                  // appears at its right edge, commenting on the whole paragraph — the
                  // no-aim way; a drag-select still names a narrower passage.
                  <div
                    key={paragraph.id}
                    id={domId(paragraph.id)}
                    data-paragraph-id={paragraph.id}
                    className={`group relative scroll-mt-4 rounded transition-colors duration-150 ${
                      highlightId === paragraph.id
                        ? toneSurface.attention
                        : closed
                          ? ""
                          : "hover:bg-gray-50 dark:hover:bg-gray-800/40"
                    }`}
                  >
                    <div
                      className={`md-body md-compact px-1 text-sm text-gray-800 dark:text-gray-100 ${
                        closed ? "" : "pr-8"
                      }`}
                    >
                      <Md
                        text={paragraph.text}
                        extraPlugins={PROPOSAL_REMARK_PLUGINS}
                        components={PROPOSAL_COMPONENTS}
                      />
                    </div>
                    {!closed && (
                      <button
                        type="button"
                        aria-label={t.commentParagraph}
                        title={t.commentParagraph}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setSelection(null);
                          window.getSelection()?.removeAllRanges();
                          setComposer({
                            sectionId: section.id,
                            paragraphId: paragraph.id,
                            text: paragraph.text,
                            top: 0,
                            left: 0,
                            whole: true,
                          });
                        }}
                        className="absolute top-0.5 right-1 flex h-6 w-6 items-center justify-center rounded text-gray-400 opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:bg-gray-200 hover:text-gray-700 focus-visible:opacity-100 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                      >
                        <GlyphIcon d={COMMENT_ICON} size={ICON_SIZE.inlineGlyph} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {composer !== null && composer.sectionId === section.id && (
                <CommentComposer
                  quote={composer.text}
                  busy={busy}
                  onCancel={() => setComposer(null)}
                  onSubmit={async (text) => {
                    const ok = await onComment(
                      section,
                      composer.text,
                      composer.paragraphId,
                      text,
                      composer.whole === true,
                    );
                    if (ok) {
                      setComposer(null);
                      setOpenSections((prev) => new Set([...prev, section.id]));
                    }
                    return ok;
                  }}
                />
              )}
              {comments.length > 0 && (
                <div className="mt-2">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => toggleSection(section.id)}
                    className={`inline-flex items-center gap-1 text-[11px] ${
                      comments.some((c) => c.batchId === null)
                        ? toneInk.attention
                        : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    }`}
                  >
                    <GlyphIcon d={COMMENT_ICON} size={ICON_SIZE.inlineGlyph} />
                    {t.sectionComments(comments.length)}
                  </button>
                  {isOpen && (
                    <div className="mt-1 space-y-2 border-l-2 border-gray-200 pl-3 dark:border-gray-800">
                      {comments.map((c) => (
                        <CommentLine
                          key={c.id}
                          comment={c}
                          names={names}
                          locale={locale}
                          focused={focusedComment === c.id}
                          mine={me !== null && c.by === me}
                          busy={busy}
                          onEdit={onEditComment}
                          onDelete={onDeleteComment}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* The chip: offered while a selection lies in one section, gone once it is taken. */}
      {selection !== null && !closed && composer === null && (
        <div className="absolute z-10" style={{ top: selection.top, left: selection.left }}>
          <Button
            size="sm"
            variant="primary"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (sectionById(selection.sectionId) === null) return;
              setComposer(selection);
              setSelection(null);
              window.getSelection()?.removeAllRanges();
            }}
          >
            <GlyphIcon d={COMMENT_ICON} size={ICON_SIZE.inlineGlyph} />
            <span className="ml-1">{t.commentSelection}</span>
          </Button>
        </div>
      )}
    </div>
  );
}

/** The composer under a section: the passage as a quote, the text, Add / Cancel; Ctrl/Cmd+Enter adds. */
function CommentComposer({
  quote,
  busy,
  onCancel,
  onSubmit,
}: {
  quote: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (text: string) => Promise<boolean>;
}) {
  const t = S.company.proposals;
  const [text, setText] = useState("");
  const submit = async () => {
    const value = text.trim();
    if (value === "") return;
    if (await onSubmit(value)) setText("");
  };
  return (
    <div className="mt-2 space-y-2 rounded-md border border-gray-200 p-3 dark:border-gray-800">
      <div className="text-[11px] text-gray-500 dark:text-gray-400">{t.selectedText}</div>
      <blockquote className="border-l-2 border-gray-300 pl-2 text-xs text-gray-700 whitespace-pre-wrap dark:border-gray-600 dark:text-gray-200">
        {quote}
      </blockquote>
      <Textarea
        size="sm"
        rows={3}
        aria-label={t.addComment}
        placeholder={t.commentPlaceholder}
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={onCancel} disabled={busy}>
          {S.common.cancel}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={busy || text.trim() === ""}
          onClick={() => void submit()}
        >
          {t.addComment}
        </Button>
      </div>
    </div>
  );
}

/** One comment: the passage it is on, who, when, the text; its pending tag; and the resolution folded under it when there is one. */
function CommentLine({
  comment,
  names,
  locale,
  focused = false,
  stale = false,
  mine = false,
  busy = false,
  onEdit,
  onDelete,
}: {
  comment: ProposalComment;
  names: ReadonlyMap<string, string>;
  locale: "zh" | "en";
  /** Named by a click on its mark. */
  focused?: boolean;
  /** Its passage is not in the current revision. */
  stale?: boolean;
  /** Written by the signed-in person: pending, it can still be reworded or withdrawn. */
  mine?: boolean;
  busy?: boolean;
  onEdit?: (commentId: string, text: string) => Promise<boolean>;
  onDelete?: (commentId: string) => Promise<boolean>;
}) {
  const t = S.company.proposals;
  const [showResolved, setShowResolved] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  // Only a pending comment is still the writer's own; sent, it stands as the author read it.
  const editable =
    mine && comment.batchId === null && onEdit !== undefined && onDelete !== undefined;
  const saveEdit = async () => {
    if (editing === null || onEdit === undefined) return;
    const next = editing.trim();
    if (next === "" || next === comment.text) {
      setEditing(null);
      return;
    }
    if (await onEdit(comment.id, next)) setEditing(null);
  };
  return (
    <div
      id={`comment-${comment.id}`}
      className={`rounded px-1 text-xs transition-colors duration-150 ${
        focused ? toneSurface.attention : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-gray-500 dark:text-gray-400">
        <span className="font-medium text-gray-700 dark:text-gray-200">
          {principalLabel(comment.by, names)}
        </span>
        <span title={formatDateTime(comment.at)}>{formatRelativeShort(comment.at, locale)}</span>
        {comment.batchId === null && <Badge tone="amber">{t.pending}</Badge>}
        {editable && editing === null && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(comment.text)}
              className="rounded px-1 text-gray-500 underline-offset-2 hover:underline disabled:opacity-50 dark:text-gray-400"
            >
              {S.common.edit}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onDelete?.(comment.id)}
              className={`rounded px-1 underline-offset-2 hover:underline disabled:opacity-50 ${toneInk.danger}`}
            >
              {S.common.delete}
            </button>
          </>
        )}
        {stale && <span>{t.fromRevision(comment.revision)}</span>}
        {comment.resolved !== undefined && (
          <button
            type="button"
            aria-expanded={showResolved}
            onClick={() => setShowResolved(!showResolved)}
            className={`rounded px-1 ${toneSurface.success}`}
          >
            {t.resolved}
          </button>
        )}
      </div>
      {(stale || focused) && comment.quote !== "" && (
        <blockquote className="mt-0.5 line-clamp-2 border-l-2 border-gray-300 pl-2 text-gray-600 dark:border-gray-600 dark:text-gray-300">
          {comment.quote}
        </blockquote>
      )}
      {editing !== null ? (
        <div className="mt-1 flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Textarea
              size="sm"
              rows={2}
              aria-label={S.common.edit}
              value={editing}
              autoFocus
              onChange={(e) => setEditing(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void saveEdit();
                if (e.key === "Escape") setEditing(null);
              }}
            />
          </div>
          <Button
            size="sm"
            disabled={busy || editing.trim() === ""}
            onClick={() => void saveEdit()}
          >
            {S.common.save}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(null)}>
            {S.common.cancel}
          </Button>
        </div>
      ) : (
        <p className="mt-0.5 whitespace-pre-wrap text-gray-800 dark:text-gray-100">
          {comment.text}
        </p>
      )}
      {comment.resolved !== undefined && showResolved && (
        <p className="mt-1 text-gray-600 dark:text-gray-300">
          {t.resolvedNote(comment.resolved.text)} · {principalLabel(comment.resolved.by, names)}
        </p>
      )}
    </div>
  );
}

/** The section block a node lies in, or null. */
function sectionOf(node: Node | null): HTMLElement | null {
  const el = node instanceof HTMLElement ? node : node?.parentElement;
  return el?.closest<HTMLElement>("[data-section-id]") ?? null;
}

/** The paragraph a node lies in, or null. */
function paragraphOf(node: Node | null): string | null {
  const el = node instanceof HTMLElement ? node : node?.parentElement;
  return el?.closest<HTMLElement>("[data-paragraph-id]")?.dataset.paragraphId ?? null;
}

/** Takes every comment mark off, leaving the text nodes as the renderer made them. */
function clearMarks(root: HTMLElement): void {
  for (const mark of Array.from(root.querySelectorAll("mark[data-comment]"))) {
    const parent = mark.parentNode;
    if (parent === null) continue;
    while (mark.firstChild !== null) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}

/**
 * Wraps a comment's passage in a `<mark>` — the first place the quote's words appear in the
 * block's rendered text, across element boundaries: the text nodes are split at the
 * passage's ends and each piece inside it gets its own mark, from the last node backwards so
 * the earlier offsets stay true. A passage the rendered text does not hold (a quote across a
 * code fence's syntax, say) gets no mark and keeps its listing under the section.
 */
function markPassage(block: HTMLElement, comment: ProposalComment, by: string): void {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = "";
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    nodes.push(n as Text);
    starts.push(text.length);
    text += (n as Text).data;
  }
  const hit = findPassage(text, comment.quote);
  if (hit === null) return;
  const state =
    comment.resolved !== undefined ? "resolved" : comment.batchId === null ? "pending" : "sent";
  for (let i = nodes.length - 1; i >= 0; i--) {
    const nodeStart = starts[i]!;
    const nodeEnd = nodeStart + nodes[i]!.data.length;
    const s = Math.max(hit.start, nodeStart);
    const e = Math.min(hit.end, nodeEnd);
    if (s >= e) continue;
    let target = nodes[i]!;
    if (e < nodeEnd) target.splitText(e - nodeStart);
    if (s > nodeStart) target = target.splitText(s - nodeStart);
    const mark = document.createElement("mark");
    mark.dataset.comment = comment.id;
    mark.className = MARK_CLASS[state];
    mark.title = `${by}: ${comment.text}`;
    target.parentNode?.insertBefore(mark, target);
    mark.appendChild(target);
  }
}

/**
 * Delegating a change: the author employee, the brief, an optional title. Creating it opens
 * the new proposal and tells the author in the proposals channel — the server does that.
 */
function NewProposalDialog({
  open,
  projectId,
  orgId,
  onClose,
  onCreated,
}: {
  open: boolean;
  projectId: string;
  orgId: string;
  onClose: () => void;
  onCreated: (item: ProposalItem) => void;
}) {
  const t = S.company.proposals;
  const company = useCompany();
  const employees = company.orgChart?.employees ?? [];
  const [author, setAuthor] = useState("");
  const [brief, setBrief] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setAuthor(employees[0]?.agentId ?? "");
    setBrief("");
    setTitle("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open only
  }, [open]);
  const submit = async () => {
    if (author === "" || brief.trim() === "") return;
    setBusy(true);
    try {
      const item = await api.createOrgProposal(projectId, orgId, {
        author,
        brief: brief.trim(),
        ...(title.trim() !== "" ? { title: title.trim() } : {}),
      });
      onCreated(item);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      title={t.newTitle}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || author === "" || brief.trim() === ""}
            onClick={() => void submit()}
          >
            {S.common.create}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select
          size="sm"
          label={t.author}
          required
          value={author}
          hint={t.authorHint}
          onChange={(e) => setAuthor(e.target.value)}
        >
          {employees.map((e) => (
            <option key={e.agentId} value={e.agentId}>
              {e.name} ({e.agentId})
            </option>
          ))}
        </Select>
        <Textarea
          size="sm"
          label={t.brief}
          required
          rows={4}
          value={brief}
          hint={t.briefHint}
          autoFocus
          onChange={(e) => setBrief(e.target.value)}
        />
        <Input
          size="sm"
          label={t.titleField}
          value={title}
          hint={t.titleHint}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
    </Modal>
  );
}

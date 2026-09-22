/**
 * The proposals page — one page, two columns: the queue on the left (one card per proposal:
 * its number, its title as the link, its status as a text pill, its author's avatar and its
 * unread count; unread first, then newest), and on the right the proposal the route names —
 * its header, the person's brief, the materials (the implementer's PR among them), the scope
 * table (the one place a file path appears), the body's sections with a comment gutter on
 * every paragraph, the sessions opened for it, the event timeline, and the action bar.
 *
 * The page is a builtin renderer the company-proposals plugin's page contribution names
 * (`OrgProposalsPage`); it mounts under the organization layout at `proposals/:number?` only
 * while the contributions carry that entry, and reads the queue off the company store's index
 * (state/company.tsx), which the sidebar's badge and every `proposal:<n>` capsule share.
 *
 * Comments are the person's, pending until sent: each paragraph's gutter opens its thread,
 * a pending comment is attention-toned and counted on the "Request changes" button, and that
 * button sends every pending comment to the author as one batch — the author works through a
 * batch, not a trickle. Approving requests the merge; rejecting asks for a one-line reason.
 * Opening a proposal marks everything on it read, which is what clears its badge.
 *
 * A `proposal:<n>#<pattern>` capsule lands here with the pattern in the hash (`#p=…`); once the
 * proposal is loaded the pattern is matched against its headings and paragraph first lines
 * and the page scrolls to the hit, marking it for a moment.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import type {
  ProposalComment,
  ProposalDetail,
  ProposalItem,
  ProposalMaterial,
  ProposalMaterialKind,
  ProposalParagraph,
  ProposalStatus,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime, formatRelativeShort } from "../../lib/format";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import { toneInk, toneStrip, toneSurface } from "../../lib/tone";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useAuth } from "../../state/auth";
import { useCompany } from "../../state/company";
import { useLocale } from "../../state/locale";
import { Badge } from "../../components/ui/badge";
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
import { orgProposalPath } from "../company/company-nav";
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
  commentsOn,
  eventDetail,
  eventLine,
  filterProposals,
  matchProposalPattern,
  orphanComments,
  parseProposalHash,
  proposalActions,
  sortProposals,
} from "./proposals-model";

/** Speech bubble (lucide message-square): the gutter's comment mark. */
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

export function ProposalStatusPill({ status }: { status: ProposalStatus }) {
  return (
    <Badge tone={PROPOSAL_STATUS_TONE[status]}>
      {S.company.proposals.status[status] ?? status}
    </Badge>
  );
}

export function OrgProposalsPage() {
  const { projectId, orgId, org } = useOrg();
  const company = useCompany();
  const { user } = useAuth();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ number?: string }>();
  useDocumentTitle(org ? `${org.name} · ${S.nav.org.proposals}` : S.nav.org.proposals);

  const selected = params.number === undefined ? null : Number(params.number);
  const selectedNumber = selected !== null && Number.isSafeInteger(selected) ? selected : null;

  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"request" | "approve" | "reject" | "merged" | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // The empty-queue note goes away for good once read; the page's "?" carries the same
  // sentence. Keyed by organization, so switching to another one re-reads the dismissal.
  const emptyHintKey = hintKey(user?.userId ?? null, projectId, orgId, "proposals");
  const [hintDismissed, setHintDismissed] = useState(() => isHintDismissed(emptyHintKey));
  useEffect(() => {
    setHintDismissed(isHintDismissed(emptyHintKey));
  }, [emptyHintKey]);

  /** Employee id → display name, for every principal drawn on the page. */
  const names = useMemo(
    () => new Map((company.orgChart?.employees ?? []).map((e) => [e.agentId, e.name])),
    [company.orgChart],
  );

  const proposalsVersion = company.versions.proposals;

  // The selected proposal's detail: read when the selection changes and whenever the index
  // says a proposal moved (the plugin's event, or a write from this page). The listing the
  // queue draws from is the store's, refreshed off the same version.
  const loadDetail = useCallback(async () => {
    if (selectedNumber === null) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    try {
      const d = await api.getOrgProposal(projectId, orgId, selectedNumber);
      setDetail(d);
      setDetailError(null);
    } catch (e) {
      setDetailError(apiErrorText(e));
    }
  }, [projectId, orgId, selectedNumber]);
  useEffect(() => {
    setDetail(null);
    setDetailError(null);
  }, [selectedNumber]);
  useEffect(() => {
    void loadDetail();
  }, [loadDetail, proposalsVersion]);

  // Reading is what marks read: once a detail is on screen, the read position moves to its
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

  const queue = useMemo(
    () =>
      company.proposals === null ? null : sortProposals(filterProposals(company.proposals, query)),
    [company.proposals, query],
  );

  const open = (number: number) => navigate(orgProposalPath(projectId, orgId, number));

  /** One write against the selected proposal: the answer is the new detail, and every other surface refetches off the store's bump. */
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
    const number = detail.number;
    const t = S.company.proposals;
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

  const addComment = async (paragraphId: string, text: string) => {
    if (detail === null) return false;
    return write(
      () => api.commentOrgProposal(projectId, orgId, detail.number, { paragraphId, text }),
      S.company.proposals.commentAdded,
    );
  };

  const t = S.company.proposals;
  const actions = detail === null ? null : proposalActions(detail.status, detail.pendingComments);

  return (
    <OrgPage
      title={S.nav.org.proposals}
      info={t.info}
      wide
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

      {/* Two columns from lg up; below that the queue is a strip of cards above the detail,
          scrolled sideways, so a phone still shows what is waiting without burying the text. */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <aside className="shrink-0 lg:w-72" aria-label={t.queue}>
          <div className="mb-2">
            <Input
              size="sm"
              value={query}
              aria-label={t.queue}
              placeholder={t.queue}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {queue === null ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : queue.length === 0 ? (
            <OrgEmptyLine>{t.queueEmpty}</OrgEmptyLine>
          ) : (
            <ul className="flex snap-x gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
              {queue.map((item) => (
                <QueueCard
                  key={item.number}
                  item={item}
                  names={names}
                  selected={item.number === selectedNumber}
                  onOpen={() => open(item.number)}
                />
              ))}
            </ul>
          )}
        </aside>

        <section className="min-w-0 flex-1">
          {selectedNumber === null ? (
            <OrgEmptyLine>{t.pickOne}</OrgEmptyLine>
          ) : detailError !== null ? (
            <ErrorLine
              message={t.loadFailed}
              detail={detailError}
              onRetry={() => void loadDetail()}
            />
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
        </section>
      </div>

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

/**
 * One card of the queue. The title is the link (a text button, underlined on hover); the
 * card itself is inert. The unread count rides at the top right in the attention tone, the
 * status as a text pill under the title, the author's avatar beside it.
 */
function QueueCard({
  item,
  names,
  selected,
  onOpen,
}: {
  item: ProposalItem;
  names: ReadonlyMap<string, string>;
  selected: boolean;
  onOpen: () => void;
}) {
  const t = S.company.proposals;
  return (
    <li
      aria-current={selected ? "true" : undefined}
      className={`w-60 shrink-0 snap-start rounded-md border p-3 lg:w-auto ${
        selected
          ? "border-gray-400 bg-gray-50 dark:border-gray-600 dark:bg-gray-800/60"
          : "border-gray-200 dark:border-gray-800"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[11px] text-gray-400 dark:text-gray-500">
          #{item.number}
        </span>
        {item.unread > 0 && (
          <span
            title={t.unreadBadge(item.unread)}
            aria-label={t.unreadBadge(item.unread)}
            className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${toneSurface.attention}`}
          >
            {item.unread}
          </span>
        )}
      </div>
      <TitleButton
        onClick={onOpen}
        title={t.openProposal}
        className={`mt-0.5 block w-full text-sm font-medium ${selected ? "" : ""}`}
      >
        <span className="line-clamp-2">{item.title}</span>
      </TitleButton>
      <div className={`mt-2 flex items-center justify-between ${ICON_GAP.row}`}>
        <ProposalStatusPill status={item.status} />
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
          <EmployeeAvatar
            id={item.author}
            name={names.get(item.author) ?? item.author}
            size={ICON_SIZE.rowLead}
            className="shrink-0 rounded"
          />
          <span className="truncate">{names.get(item.author) ?? item.author}</span>
        </span>
      </div>
    </li>
  );
}

/** The selected proposal: header, brief, materials, scope, body, sessions, events, and the action bar at the foot. */
function ProposalView({
  detail,
  names,
  locale,
  highlightId,
  busy,
  onComment,
  onOpenSession,
  onOpenTicket,
  actions,
}: {
  detail: ProposalDetail;
  names: ReadonlyMap<string, string>;
  locale: "zh" | "en";
  highlightId: string | null;
  busy: boolean;
  onComment: (paragraphId: string, text: string) => Promise<boolean>;
  onOpenSession: (sessionId: string) => void;
  onOpenTicket: (ticketId: string) => void;
  actions: ReactNode;
}) {
  const t = S.company.proposals;
  const orphans = useMemo(
    () => orphanComments(detail.comments, detail.sections),
    [detail.comments, detail.sections],
  );
  const events = useMemo(() => [...detail.events].reverse(), [detail.events]);
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
        <h2 className="mt-1 text-lg font-semibold leading-snug">{detail.title}</h2>
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
            <PrincipalChip principal={`user:${detail.delegatedBy}`} names={names} />
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
          <ul className="flex flex-wrap gap-2">
            {detail.materials.map((m) => (
              <li key={`${m.kind}:${m.url}`}>
                <MaterialChip material={m} onOpenTicket={onOpenTicket} />
              </li>
            ))}
          </ul>
        )}
      </OrgSection>

      <OrgSection title={t.scope} count={detail.scope.length}>
        {detail.scope.length === 0 ? (
          <OrgEmptyLine>{t.scopeEmpty}</OrgEmptyLine>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <th className="py-1 pr-3 font-medium">{t.scopeFile}</th>
                <th className="py-1 font-medium">{t.scopePattern}</th>
              </tr>
            </thead>
            <tbody>
              {detail.scope.map((entry, i) => (
                <tr
                  key={`${entry.file}-${i}`}
                  className="border-t border-gray-100 dark:border-gray-800"
                >
                  <td className="py-1 pr-3 font-mono break-all">{entry.file}</td>
                  <td className="py-1 font-mono text-gray-600 dark:text-gray-300">
                    {entry.name ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </OrgSection>

      <OrgSection title={t.sections}>
        {detail.sections.length === 0 ? (
          <OrgEmptyLine>{t.sectionsEmpty}</OrgEmptyLine>
        ) : (
          <div className="space-y-5">
            {detail.sections.map((section) => (
              <div key={section.id} id={domId(section.id)} className="scroll-mt-4">
                <h3
                  className={`mb-2 text-sm font-semibold ${
                    highlightId === section.id ? `rounded px-1 ${toneSurface.attention}` : ""
                  }`}
                >
                  {section.heading}
                </h3>
                <div className="space-y-2">
                  {section.paragraphs.map((paragraph) => (
                    <ParagraphRow
                      key={paragraph.id}
                      paragraph={paragraph}
                      comments={commentsOn(detail.comments, paragraph.id)}
                      names={names}
                      locale={locale}
                      highlighted={highlightId === paragraph.id}
                      busy={busy}
                      closed={detail.status === "merged" || detail.status === "rejected"}
                      onComment={(text) => onComment(paragraph.id, text)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {orphans.length > 0 && (
          <div className="mt-4 space-y-2">
            {orphans.map((c) => (
              <CommentLine key={c.id} comment={c} names={names} locale={locale} orphan />
            ))}
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

      {/* The action bar sits at the foot of the detail and stays in view while the body
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
 * A material as a chip: the kind's glyph, the label, and a link out (a new tab — it is a PR
 * or an issue on another site). A ticket material names one of this organization's tickets
 * and opens its dialog in place, the way a channel's ticket reference does.
 */
function MaterialChip({
  material,
  onOpenTicket,
}: {
  material: ProposalMaterial;
  onOpenTicket: (ticketId: string) => void;
}) {
  const t = S.company.proposals;
  const chip = `inline-flex items-center ${ICON_GAP.row} rounded-md border border-gray-200 px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/60`;
  const kind = t.materialKind[material.kind] ?? material.kind;
  const body = (
    <>
      <GlyphIcon
        d={MATERIAL_ICONS[material.kind]}
        size={ICON_SIZE.inlineGlyph}
        className="text-gray-500 dark:text-gray-400"
      />
      <span className="text-gray-500 dark:text-gray-400">{kind}</span>
      <span className="max-w-64 truncate font-medium">{material.label}</span>
    </>
  );
  if (material.kind === "ticket" && !/^[a-z][a-z0-9+.-]*:/i.test(material.url)) {
    return (
      <button
        type="button"
        className={chip}
        title={material.url}
        onClick={() => onOpenTicket(material.url)}
      >
        {body}
      </button>
    );
  }
  return (
    <a href={material.url} target="_blank" rel="noreferrer" title={material.url} className={chip}>
      {body}
    </a>
  );
}

/**
 * One paragraph and its gutter: the comment mark (with the thread's count) at the left, the
 * paragraph rendered as Markdown, and — once the gutter is opened — the thread beneath it:
 * pending comments in the attention tone, batched ones plain, resolved ones folded to their
 * answer, then the box for a new one. A closed proposal takes no new comment.
 */
function ParagraphRow({
  paragraph,
  comments,
  names,
  locale,
  highlighted,
  busy,
  closed,
  onComment,
}: {
  paragraph: ProposalParagraph;
  comments: ProposalComment[];
  names: ReadonlyMap<string, string>;
  locale: "zh" | "en";
  highlighted: boolean;
  busy: boolean;
  closed: boolean;
  onComment: (text: string) => Promise<boolean>;
}) {
  const t = S.company.proposals;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const pending = comments.filter((c) => c.batchId === null).length;
  const submit = async () => {
    const value = text.trim();
    if (value === "") return;
    if (await onComment(value)) setText("");
  };
  const gutterInk =
    pending > 0
      ? toneInk.attention
      : comments.length > 0
        ? "text-gray-600 dark:text-gray-300"
        : "text-gray-300 hover:text-gray-600 dark:text-gray-700 dark:hover:text-gray-300";
  return (
    <div id={domId(paragraph.id)} className="group flex scroll-mt-4 items-start gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-label={comments.length > 0 ? t.comments(comments.length) : t.comment}
        title={comments.length > 0 ? t.comments(comments.length) : t.comment}
        onClick={() => setOpen(!open)}
        className={`mt-0.5 flex h-6 w-8 shrink-0 items-center justify-center gap-0.5 rounded text-[11px] tabular-nums transition-colors duration-150 ${gutterInk}`}
      >
        <GlyphIcon d={COMMENT_ICON} size={ICON_SIZE.inlineGlyph} />
        {comments.length > 0 && <span>{comments.length}</span>}
      </button>
      <div className="min-w-0 flex-1">
        <div
          className={`md-body md-compact rounded px-1 text-sm text-gray-800 transition-colors duration-150 dark:text-gray-100 ${
            highlighted ? toneSurface.attention : ""
          }`}
        >
          <Md
            text={paragraph.text}
            extraPlugins={PROPOSAL_REMARK_PLUGINS}
            components={PROPOSAL_COMPONENTS}
          />
        </div>
        {open && (
          <div className="mt-1 space-y-2 border-l-2 border-gray-200 pl-3 dark:border-gray-800">
            {comments.map((c) => (
              <CommentLine key={c.id} comment={c} names={names} locale={locale} />
            ))}
            {!closed && (
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Textarea
                    size="sm"
                    rows={2}
                    aria-label={t.addComment}
                    placeholder={t.commentPlaceholder}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
                    }}
                  />
                </div>
                <Button
                  size="sm"
                  disabled={busy || text.trim() === ""}
                  onClick={() => void submit()}
                >
                  {t.addComment}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** One comment: who, when, the text; its pending tag; and the resolution folded under it when there is one. */
function CommentLine({
  comment,
  names,
  locale,
  orphan = false,
}: {
  comment: ProposalComment;
  names: ReadonlyMap<string, string>;
  locale: "zh" | "en";
  /** The paragraph it was written on is gone from the current revision. */
  orphan?: boolean;
}) {
  const t = S.company.proposals;
  const [showResolved, setShowResolved] = useState(false);
  return (
    <div className="text-xs">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-gray-500 dark:text-gray-400">
        <span className="font-medium text-gray-700 dark:text-gray-200">
          {principalLabel(comment.by, names)}
        </span>
        <span title={formatDateTime(comment.at)}>{formatRelativeShort(comment.at, locale)}</span>
        {comment.batchId === null && <Badge tone="amber">{t.pending}</Badge>}
        {orphan && <span>{t.fromRevision(comment.revision)}</span>}
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
      <p className="mt-0.5 whitespace-pre-wrap text-gray-800 dark:text-gray-100">{comment.text}</p>
      {comment.resolved !== undefined && showResolved && (
        <p className="mt-1 text-gray-600 dark:text-gray-300">
          {t.resolvedNote(comment.resolved.text)} · {principalLabel(comment.resolved.by, names)}
        </p>
      )}
    </div>
  );
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

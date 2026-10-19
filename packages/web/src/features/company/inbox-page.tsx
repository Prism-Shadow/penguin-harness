/**
 * The notification center: the organization's inbox as a page of its own. The same three
 * categories the overview's inbox section shows — what names the reader, what is stuck, what
 * has landed — with the reader's own preferences over them: which categories feed the list at
 * all, and the filter chip in force. Both are reading habits, so both are kept per
 * organization and both outlive the visit; the chip is the same one the overview keeps, and a
 * category muted here leaves the overview's inbox too. Where a row leads, its title is the
 * only thing that goes there — the rest of the row is inert.
 *
 * A row also carries the two things a list of notifications is for: the read mark (a seen row
 * wears a hollow dot, and the mark flips both ways) and archiving, which takes a row out of the
 * inbox for this reader alone and lists it in the archived section below, where it can be
 * restored. Both marks live on the server, per user, so they follow the reader between
 * browsers; every write re-reads the lists rather than guessing what the server now serves.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import type {
  OrgChannelMessage,
  OrgChartResponse,
  OrgInbox,
  OrganizationDetail,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  EmptyState,
  GlyphIcon,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  RuledSection,
  Segmented,
  ToggleRow,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime, formatRelativeShort } from "../../lib/format";
import { NAV_ICONS } from "../../lib/nav-icons";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useLocale } from "../../state/locale";
import { useCompany } from "../../state/company";
import { orgChannelPath } from "./company-nav";
import { CHANNEL_ICON } from "./channel-sidebar";
import { OrgEmptyLine, OrgPage, OrgPageSkeleton, useOrg } from "./org-layout";
import { InboxDot, TitleButton, principalLabel } from "./shared";
import {
  INBOX_CATEGORIES,
  readInboxFilter,
  readInboxPrefs,
  resolveInboxFilter,
  writeInboxFilter,
  writeInboxPrefs,
} from "./inbox-prefs";
import { inboxCounts, inboxMatches, inboxRows } from "./overview-summary";
import type { InboxCategory, InboxFilter, InboxRow, InboxTarget } from "./overview-summary";

/** The mark that leads a row: the channel hash for what was said, the board's glyph for a ticket. */
const INBOX_ICON: Record<InboxCategory, string> = {
  mention: CHANNEL_ICON,
  blocked: NAV_ICONS.orgTickets,
  done: NAV_ICONS.orgTickets,
};

/**
 * A row of the list: full width, the content decides the rest. The row is inert — it carries
 * no click of its own and no hover wash that would imply one; where it leads somewhere, its
 * title is the only thing that goes there. `action` is the trailing run of the row's own
 * buttons, which is what tells the inbox's rows from the archived ones.
 */
const rowClass = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm";

function InboxLine({
  row,
  onOpen,
  action,
}: {
  row: InboxRow;
  onOpen: (target: InboxTarget) => void;
  action: ReactNode;
}) {
  const { locale } = useLocale();
  return (
    <li className={rowClass}>
      <span
        className={`flex w-20 shrink-0 items-center ${ICON_GAP.tight} text-xs text-gray-500 dark:text-gray-400`}
      >
        <GlyphIcon d={INBOX_ICON[row.category]} size={ICON_SIZE.rowLead} />
        <span className="truncate">{S.company.overview.inboxCategories[row.category]}</span>
      </span>
      <InboxDot row={row} />
      <TitleButton className="flex-1 truncate" hint={row.title} onClick={() => onOpen(row.target)}>
        {row.title}
      </TitleButton>
      {row.detail !== undefined && (
        <span className="hidden max-w-40 shrink-0 truncate text-xs text-gray-500 sm:inline dark:text-gray-400">
          {row.detail}
        </span>
      )}
      <span
        className="w-20 shrink-0 text-right text-xs tabular-nums text-gray-400 dark:text-gray-500"
        {...(row.time !== null
          ? { "data-tooltip": formatDateTime(row.time), "data-tooltip-extra": true }
          : {})}
      >
        {row.time === null ? "—" : formatRelativeShort(row.time, locale)}
      </span>
      {action}
    </li>
  );
}

export function InboxPage() {
  const { projectId, orgId, org } = useOrg();
  const navigate = useNavigate();
  const company = useCompany();
  useDocumentTitle(org ? `${org.name} · ${S.nav.org.inbox}` : S.nav.org.inbox);
  const [detail, setDetail] = useState<OrganizationDetail | null>(null);
  const [chart, setChart] = useState<OrgChartResponse | null>(null);
  /** The archived rows, read with the rest: they are not part of the detail's inbox. */
  const [archived, setArchived] = useState<OrgInbox | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** A write in flight: every row action is held while one is, since they all move the list. */
  const [pending, setPending] = useState(false);
  /** A failed write's message, shown above the list — the page itself stays readable. */
  const [actionError, setActionError] = useState<string | null>(null);
  /** Why the archived list could not be read: said in that section, not over the whole page. */
  const [archivedError, setArchivedError] = useState<string | null>(null);
  /** The categories feeding the list; the reader's own, so they are kept once moved. */
  const [prefs, setPrefs] = useState<readonly InboxCategory[]>(() => readInboxPrefs(orgId));
  /** The chip in force — the same chip the overview keeps, read from the same entry. */
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>(() => readInboxFilter(orgId));
  /** A moved chip or toggle is stored back for the next visit — after the first run, which reads them. */
  const prefsDirty = useRef(false);
  useEffect(() => {
    if (!prefsDirty.current) return;
    prefsDirty.current = false;
    writeInboxPrefs(orgId, prefs);
    writeInboxFilter(orgId, inboxFilter);
  }, [orgId, prefs, inboxFilter]);

  // Another organization's data — and reading state — must not linger while this one loads.
  // The outlet reuses this element across organizations, so state persists without this.
  useEffect(() => {
    setDetail(null);
    setChart(null);
    setArchived(null);
    setError(null);
    setActionError(null);
    setArchivedError(null);
    setPrefs(readInboxPrefs(orgId));
    setInboxFilter(readInboxFilter(orgId));
  }, [projectId, orgId]);

  const load = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([
        api.getOrganization(projectId, orgId),
        api.getOrgChart(projectId, orgId),
      ]);
      setDetail(d);
      setChart(c);
      setError(null);
    } catch (e) {
      setError(apiErrorText(e));
      return;
    }
    // The archived list is read on its own: a server that predates the route leaves the inbox
    // itself readable, with the failure said in the section that failed rather than over the page.
    try {
      setArchived(await api.getArchivedOrgInbox(projectId, orgId));
      setArchivedError(null);
    } catch (e) {
      setArchived(null);
      setArchivedError(apiErrorText(e));
    }
  }, [projectId, orgId]);

  // Messages, tickets and runs all move this page: reload on any of them.
  const { messages, tickets, runs } = company.versions;
  useEffect(() => {
    void load();
  }, [load, messages, tickets, runs]);

  /**
   * Where a row leads: a ticket opens as the dialog over this page (the layout hosts it),
   * while what was said in a channel opens the channel — a conversation is a place, not a
   * detail.
   */
  const openRow = (target: InboxTarget) => {
    if (target.kind === "ticket") company.openTicket(projectId, orgId, target.ticketId);
    else navigate(orgChannelPath(projectId, orgId, target.channelId));
  };

  const toggleCategory = (category: InboxCategory, on: boolean) => {
    prefsDirty.current = true;
    const next = on ? [...prefs, category] : prefs.filter((c) => c !== category);
    setPrefs(next);
    // A chip left pointing at a muted category would show an empty list by surprise.
    if (!on && inboxFilter === category) setInboxFilter("all");
  };

  /**
   * One write, then the lists re-read: which rows the server serves back is the server's
   * decision (an archived row leaves the inbox, a restored one returns), so nothing is guessed
   * locally. A refused write leaves the list as it was and says why.
   */
  const run = async (write: () => Promise<unknown>) => {
    setPending(true);
    setActionError(null);
    try {
      await write();
      await load();
    } catch (e) {
      setActionError(apiErrorText(e));
    } finally {
      setPending(false);
    }
  };

  // The message behind each mention row: archiving one means sending the server the message the
  // reader is looking at, since a message cannot be looked up by its id.
  const mentionsByKey = useMemo(() => {
    const map = new Map<string, OrgChannelMessage>();
    for (const message of detail?.inbox?.mentions ?? []) {
      map.set(`mention/${message.id}`, message as OrgChannelMessage);
    }
    return map;
  }, [detail]);

  const title = S.nav.org.inbox;
  const info = S.company.inbox.info;

  if (detail === null || chart === null) {
    return (
      <OrgPage title={title} info={info}>
        {error !== null ? (
          <EmptyState
            title={error}
            action={<Button onClick={() => void load()}>{S.common.retry}</Button>}
          />
        ) : (
          <OrgPageSkeleton />
        )}
      </OrgPage>
    );
  }

  const names = new Map(chart.employees.map((e) => [e.agentId, e.name]));
  const label = (principal: string) => principalLabel(principal, names);
  const feeds = (row: InboxRow) => (prefs as readonly string[]).includes(row.category);
  const fed = inboxRows({ inbox: detail.inbox, names: label }).filter(feeds);
  const archivedRows = inboxRows({ inbox: archived ?? undefined, names: label }).filter(feeds);
  const filter = resolveInboxFilter(inboxFilter, prefs);
  const totals = inboxCounts(fed);
  const chips: readonly InboxFilter[] = ["all", ...prefs];
  const visible = fed.filter((row) => inboxMatches(row, filter));

  const setRead = (rows: readonly InboxRow[], read: boolean) => {
    void run(() =>
      api.markOrgInboxRead(projectId, orgId, { keys: rows.map((r) => r.key), read }),
    );
  };

  const setArchivedRows = (rows: readonly InboxRow[], flag: boolean) => {
    const snapshots: Record<string, OrgChannelMessage> = {};
    for (const row of rows) {
      const message = mentionsByKey.get(row.key);
      if (message !== undefined) snapshots[row.key] = message;
    }
    void run(() =>
      api.archiveOrgInbox(projectId, orgId, {
        keys: rows.map((r) => r.key),
        archived: flag,
        ...(Object.keys(snapshots).length > 0 ? { snapshots } : {}),
      }),
    );
  };

  /** The row's read button: its glyph is the state the click leads to, not the state now. */
  const readButton = (row: InboxRow) => (
    <Button
      size="icon-sm"
      variant="ghost"
      disabled={pending}
      title={row.read ? S.company.inbox.markUnread : S.company.inbox.markRead}
      aria-label={row.read ? S.company.inbox.markUnread : S.company.inbox.markRead}
      onClick={() => setRead([row], !row.read)}
    >
      <GlyphIcon d={row.read ? ICONS.undo : ICONS.checkCircle} size={ICON_SIZE.rowMark} />
    </Button>
  );

  const archiveButton = (row: InboxRow) => (
    <Button
      size="icon-sm"
      variant="ghost"
      disabled={pending}
      title={S.company.inbox.archive}
      aria-label={S.company.inbox.archive}
      onClick={() => setArchivedRows([row], true)}
    >
      <GlyphIcon d={ICONS.archive} size={ICON_SIZE.rowMark} />
    </Button>
  );

  return (
    <OrgPage title={title} info={info}>
      <RuledSection
        title={S.company.inbox.prefsTitle}
        info={S.company.inbox.prefsInfo}
        className="mt-8"
      >
        <div className="grid gap-1">
          {INBOX_CATEGORIES.map((category) => (
            <ToggleRow
              key={category}
              label={S.company.overview.inboxCategories[category]}
              hint={S.company.inbox.prefHint[category]}
              checked={(prefs as readonly string[]).includes(category)}
              onChange={(on) => toggleCategory(category, on)}
            />
          ))}
        </div>
      </RuledSection>

      <RuledSection
        title={S.nav.org.inbox}
        count={fed.length}
        className="mt-8"
        actions={
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label={S.nav.org.inbox}
          >
            <Segmented
              cols={Math.max(2, Math.min(5, chips.length)) as 2 | 3 | 4 | 5}
              value={filter}
              onChange={(f) => {
                prefsDirty.current = true;
                setInboxFilter(f);
              }}
              options={chips.map((f) => ({
                value: f,
                label: `${S.company.overview.inboxFilters[f]} ${totals[f]}`,
              }))}
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={pending || fed.every((row) => row.read)}
              onClick={() => setRead(fed, true)}
            >
              {S.company.inbox.markAllRead}
            </Button>
          </div>
        }
      >
        {actionError !== null && <p className="mb-2 text-xs text-tone-danger-fg">{actionError}</p>}
        {prefs.length === 0 ? (
          <OrgEmptyLine>{S.company.inbox.emptyAllOff}</OrgEmptyLine>
        ) : visible.length === 0 ? (
          <OrgEmptyLine>{S.company.inbox.emptyFilter}</OrgEmptyLine>
        ) : (
          <ul className="space-y-1">
            {visible.map((row) => (
              <InboxLine
                key={row.key}
                row={row}
                onOpen={openRow}
                action={
                  <span className="flex shrink-0 items-center">
                    <span className="sr-only">
                      {row.read ? S.company.inbox.readRow : S.company.inbox.unreadRow}
                    </span>
                    {readButton(row)}
                    {archiveButton(row)}
                  </span>
                }
              />
            ))}
          </ul>
        )}
      </RuledSection>

      <RuledSection
        title={S.company.inbox.archivedTitle}
        info={S.company.inbox.archivedInfo}
        count={archivedRows.length}
        className="mt-8"
      >
        {archivedError !== null && <p className="mb-2 text-xs text-tone-danger-fg">{archivedError}</p>}
        {archivedRows.length === 0 ? (
          <OrgEmptyLine>{S.company.inbox.archivedEmpty}</OrgEmptyLine>
        ) : (
          <ul className="space-y-1">
            {archivedRows.map((row) => (
              <InboxLine
                key={`archived/${row.key}`}
                row={row}
                onOpen={openRow}
                action={
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    title={S.company.inbox.unarchive}
                    onClick={() => setArchivedRows([row], false)}
                  >
                    <GlyphIcon d={ICONS.archiveRestore} size={ICON_SIZE.rowMark} />
                    {S.company.inbox.unarchive}
                  </Button>
                }
              />
            ))}
          </ul>
        )}
      </RuledSection>
    </OrgPage>
  );
}

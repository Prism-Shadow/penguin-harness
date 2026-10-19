/**
 * The notification center: the organization's inbox as a page of its own. The same three
 * categories the overview's inbox section shows — what names the reader, what is stuck, what
 * has landed — with the reader's own preferences over them: which categories feed the list at
 * all, and the filter chip in force. Both are reading habits, so both are kept per
 * organization and both outlive the visit; the chip is the same one the overview keeps, and a
 * category muted here leaves the overview's inbox too. Where a row leads, its title is the
 * only thing that goes there — the row itself stays inert.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type {
  OrgChartResponse,
  OrganizationDetail,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  EmptyState,
  GlyphIcon,
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
import type { InboxCategory, InboxFilter, InboxTarget } from "./overview-summary";

/** The mark that leads a row: the channel hash for what was said, the board's glyph for a ticket. */
const INBOX_ICON: Record<InboxCategory, string> = {
  mention: CHANNEL_ICON,
  blocked: NAV_ICONS.orgTickets,
  done: NAV_ICONS.orgTickets,
};

/**
 * A row of the list: full width, the content decides the rest. The row is inert — it carries
 * no click of its own and no hover wash that would imply one; where it leads somewhere, its
 * title is the only thing that goes there.
 */
const rowClass = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm";

export function InboxPage() {
  const { projectId, orgId, org } = useOrg();
  const navigate = useNavigate();
  const company = useCompany();
  const { locale } = useLocale();
  useDocumentTitle(org ? `${org.name} · ${S.nav.org.inbox}` : S.nav.org.inbox);
  const [detail, setDetail] = useState<OrganizationDetail | null>(null);
  const [chart, setChart] = useState<OrgChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    setError(null);
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
  const fed = inboxRows({
    inbox: detail.inbox,
    names: (principal) => principalLabel(principal, names),
  }).filter((row) => (prefs as readonly string[]).includes(row.category));
  const filter = resolveInboxFilter(inboxFilter, prefs);
  const totals = inboxCounts(fed);
  const chips: readonly InboxFilter[] = ["all", ...prefs];
  const visible = fed.filter((row) => inboxMatches(row, filter));

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
          <div role="group" aria-label={S.nav.org.inbox}>
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
          </div>
        }
      >
        {prefs.length === 0 ? (
          <OrgEmptyLine>{S.company.inbox.emptyAllOff}</OrgEmptyLine>
        ) : visible.length === 0 ? (
          <OrgEmptyLine>{S.company.inbox.emptyFilter}</OrgEmptyLine>
        ) : (
          <ul className="space-y-1">
            {visible.map((row) => (
              <li key={row.key} className={rowClass}>
                <span
                  className={`flex w-20 shrink-0 items-center ${ICON_GAP.tight} text-xs text-gray-500 dark:text-gray-400`}
                >
                  <GlyphIcon d={INBOX_ICON[row.category]} size={ICON_SIZE.rowLead} />
                  <span className="truncate">
                    {S.company.overview.inboxCategories[row.category]}
                  </span>
                </span>
                <InboxDot row={row} />
                <TitleButton
                  className="flex-1 truncate"
                  hint={row.title}
                  onClick={() => openRow(row.target)}
                >
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
              </li>
            ))}
          </ul>
        )}
      </RuledSection>
    </OrgPage>
  );
}

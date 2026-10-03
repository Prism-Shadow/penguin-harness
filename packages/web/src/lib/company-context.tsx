/** Shared read contract only. Company owns its original store, hydration and provider. */
import { createContext, useContext } from "react";
import type { MessagingChannel, OrgChannelItem, OrgChartResponse, OrgSessionsResponse, OrganizationSummary } from "@prismshadow/penguin-server/api";
export type WorkMode = "dev" | "company";
export interface TicketDialogTarget {
  projectId: string;
  orgId: string;
  ticketId: string;
}

export interface CompanyVersions {
  /** The organization list (an org's summary counts changed: a budget pause, a run, a resync). */
  orgs: number;
  /** A new message landed in one of the organization's channels. */
  messages: number;
  tickets: number;
  /** A desk or ticket Session was opened by the scheduler, or a resync may have lost that news. */
  runs: number;
  budget: number;
}

export interface CompanyContextValue {
  /** The server's master switch. */
  serverEnabled: boolean;
  /** The user's own switch. */
  personalEnabled: boolean;
  /** Both switches on: the mode switch renders and `/org` routes resolve. */
  available: boolean;
  /** The effective mode: the chosen one while company mode is available, development otherwise. */
  workMode: WorkMode;
  /** Where `/` and an unmatched path lead in the effective mode (company-nav.ts homePath). */
  homePath: string;
  setWorkMode: (mode: WorkMode) => void;
  setPersonalEnabled: (enabled: boolean) => void;
  organizations: OrganizationSummary[];
  orgsLoading: boolean;
  orgsLoaded: boolean;
  currentOrgKey: string | null;
  /** The summary of the open organization (or, outside its routes, of the one last opened), when the list holds it. */
  currentOrg: OrganizationSummary | null;
  lastOrgKey: string | null;
  setCurrentOrg: (key: string | null) => void;
  /** The open organization's channels; null until the first listing arrives. */
  channels: OrgChannelItem[] | null;
  channelsError: string | null;
  /** Unread and @me summed over the channels the user belongs to — the sidebar's and the rail's badges. */
  channelUnread: number;
  channelMentions: number;
  reloadChannels: () => Promise<void>;
  markChannelRead: (channelId: string) => void;
  /** Desk and ticket Sessions of every organization of the current Project, keyed by org key. */
  orgSessions: ReadonlyMap<string, OrgSessionsResponse>;
  /** Writes a desk's messaging binding change into `orgSessions` (null = unbound), so its row's mark follows at once. */
  setDeskMessagingChannel: (sessionId: string, channel: MessagingChannel | null) => void;
  /** The open organization's employees, in chart order; null until the first read. */
  orgChart: OrgChartResponse | null;
  orgChartError: string | null;
  reloadOrgChart: () => Promise<void>;
  /** The ticket the detail dialog is showing; null when it is closed. */
  ticketDialog: TicketDialogTarget | null;
  /** How many tickets the dialog can go back through (the parents and children followed inside it). */
  ticketBackDepth: number;
  openTicket: (projectId: string, orgId: string, ticketId: string) => void;
  closeTicket: () => void;
  backTicket: () => void;
  /** Say that a ticket was written here, so every surface that lists tickets refetches. */
  ticketsChanged: () => void;
  versions: CompanyVersions;
  reloadOrganizations: () => Promise<void>;
  reloadOrgSessions: () => Promise<void>;
}

export const CompanyContext = createContext<CompanyContextValue | null>(null);

export function useCompany(): CompanyContextValue {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used within a CompanyProvider");
  return ctx;
}

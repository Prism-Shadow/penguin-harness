/**
 * Agents list page: entry point for creating,
 * deleting, and editing Agents. Laid out as GitHub-repo-list-style single-column compact rows:
 * one horizontal band of "info | 30-day activity sparkline | button group" per row.
 * Info column has three lines: title line (small avatar + bold name + agentId); single-line
 * truncated description; and a stats line — icon + number only (Session count / tool count) plus
 * relative time (today/yesterday/n days ago), with meaning folded into the hover title; the
 * tool / skill / hook / memory / vault-key / schedule counts deep-link to the settings page's
 * matching tab (?tab=tools|skills|hooks|memory|vault|schedules) and appear in the settings tabs'
 * order.
 * A click anywhere on a card's body goes to the Agent's settings page (lib/card-open.ts), and every
 * control inside it acts on its own; the Agent's name is the link to that page, the keyboard's way in.
 * Buttons sit to the right of the sparkline: "New Chat" (draft state, same as sidebar group
 * header) and "Settings" (goes to settings page) show text labels; "Usage" (deep links via
 * ?agentId= to the usage center) and "Delete" (with confirmation; built-in Agents show a
 * non-interactive light gray placeholder with an undeletable tooltip) are square icon buttons
 * (tooltip shows the full name); "Create Agent" (create-agent-dialog.tsx) fills in name +
 * description and picks what the new Agent starts with — plugins from the library (each one's
 * skills, hook package and MCP servers), and Skills from a project directory's .agents/skills or
 * .claude/skills. A plain new Agent otherwise starts with none. A picked plugin with a stdio MCP
 * server asks before the Agent is created, showing the command it runs on this server.
 *
 * A machine's Agents are that machine's own (lib/agent-location.ts), and they sit in the same
 * list as this server's, the way the sidebar mixes machine Workspaces with local ones: one order
 * for all (lib/machine-agent-lists.ts `mixAgents`), each machine card named `[SSH: alias]` after
 * the Agent's name as a machine's Workspace group is. Every control on such a card acts on that
 * machine — its settings page there, a new chat in its temporary workspace, its delete. A machine
 * out of reach keeps what it was last seen holding on the list, greyed, every control off, with
 * the reason beside the tag and on each control.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import {
  AgentAvatar,
  Pill,
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  GlyphIcon,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  Input,
  PageFrame,
  PageHeader,
  RuledSection,
  Skeleton,
  SkeletonCard,
  Sparkline,
  TodoNotice,
  UpdatePill,
  toastError,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { cardBodyClick } from "../../lib/card-open";
import { formatDateTime, formatRelativeDays } from "../../lib/format";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useUpdateBadges } from "../../lib/use-update-badges";
import { dismissTodo } from "../../lib/todo-dismissals";
import { bulkOutcome, failedList, firstFailure, noticeCounts } from "../../lib/bulk-update";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";
import { STAT_ICONS } from "../../lib/stat-icons";
import { DRAFT_SESSION_ID } from "../chat/chat-page";
import { prepareNewChatDraft } from "../chat/new-chat";
import { AiCreateModal } from "../ai-create";
import { AiCreateButtons } from "../ai-create/ai-create-buttons";
import { agentKey, agentSettingsPath } from "../../lib/agent-location";
import { mixAgents, useMachineAgents } from "../../lib/machine-agent-lists";
import type { PlacedAgent } from "../../lib/machine-agent-lists";
import { toneInk } from "../../lib/tone";
import { employmentsOf, splitByEmployment } from "./agent-employment";
import { CreateAgentDialog, pluginPickItems } from "./create-agent-dialog";
import type { PluginPickItem } from "./create-agent-dialog";

/** Built-in Agents; the server also rejects deletion, so no delete entry point is shown here. */
const BUILTIN_AGENT_IDS = new Set(["default_agent", "penguin_support"]);

/** Card button icons (24x24 line path, rendered via GlyphIcon). */
const CARD_ICONS = {
  /** New chat (plus sign) */
  newChat: ICONS.plus,
  /** Delete (trash can) */
  trash: ICONS.trash,
  /** Total session count (chat bubble) */
  sessions: ICONS.bubbleLines,
  /** Vault key count (key: bow + teeth) */
  vaultKeys: ICONS.key,
  /** Schedule count: the alarm clock every scheduled-task surface wears. */
  schedules: ICONS.alarmClock,
  /** Installed skill count: the open book every skill surface wears (skill-use's BOOK_ICON). */
  skills: ICONS.bookOpen,
  /** Usage (bar chart, same as sidebar "Usage Center") */
  usage: ICONS.barChart,
  /** Memory count: the brain every Memory surface wears; opens the settings tab. */
  memory: ICONS.brain,
} as const;

/**
 * Stat entries that deep-link into a settings tab: same look as the plain stat spans
 * (no button chrome) plus a subtle hover text-color shift and pointer cursor.
 */
const STAT_LINK_CLASS =
  "inline-flex shrink-0 cursor-pointer items-center gap-1 tabular-nums " +
  "transition-colors duration-150 hover:text-gray-800 dark:hover:text-gray-200";

/**
 * The mark an Agent whose public API is on carries after its name: the plug the API wears
 * everywhere (the sidebar's Background rows included), with its meaning in the tooltip and for
 * screen readers. An Agent with the API off carries nothing.
 */
export function AgentApiMark({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return (
    <span data-tooltip={S.agent.apiOn} className="shrink-0 text-fg-subtle">
      <GlyphIcon d={ICONS.plug} size={ICON_SIZE.inlineGlyph} />
      <span className="sr-only">{S.agent.apiOn}</span>
    </span>
  );
}

/**
 * An Agent's card: a click anywhere on its body goes to the Agent's settings page, while each
 * control inside it (the name's link, New chat, Settings, the stat links, Usage, Delete, the
 * update pill) acts on its own. The card itself is no control; the keyboard's way in is the name
 * (`AgentNameLink`). A machine's Agent whose machine is out of reach opens nothing.
 */
export function AgentCard({
  onOpen,
  dimmed = false,
  children,
}: {
  /** Enters the Agent's settings page; null for one that cannot be reached right now. */
  onOpen: (() => void) | null;
  /** Greyed: a machine's Agent as last seen, while that machine cannot be asked. */
  dimmed?: boolean;
  children: ReactNode;
}) {
  return (
    <Card
      padding="md"
      interactive={onOpen !== null}
      className={`flex flex-wrap items-center gap-x-6 gap-y-2 ${dimmed ? "opacity-60" : ""}`}
      {...(onOpen === null ? {} : { onClick: cardBodyClick(onOpen) })}
    >
      {children}
    </Card>
  );
}

/**
 * The Agent's name on its card: a link to the Agent's settings page, wherever the Agent lives —
 * the card's keyboard way in, and a real address a middle click opens in a new tab — or plain
 * text for an Agent that cannot be reached right now.
 */
export function AgentNameLink({
  agentId,
  name,
  machineId = null,
  onFollow,
}: {
  agentId: string;
  name: string;
  /** The machine the Agent lives on; null for this server. */
  machineId?: string | null;
  /** What following the link also does (make it the current Agent); null for plain text. */
  onFollow: (() => void) | null;
}) {
  // min-w-0: a flex child does not shrink below its content by default, and a long name must truncate.
  const className = "min-w-0 truncate text-base font-bold";
  if (onFollow === null) return <span className={className}>{name}</span>;
  return (
    <Link
      to={agentSettingsPath(agentId, machineId)}
      onClick={onFollow}
      className={`${className} rounded-sm hover:underline`}
    >
      {name}
    </Link>
  );
}

export function AgentsPage() {
  const navigate = useNavigate();
  useDocumentTitle(S.nav.agents);
  const { locale } = useLocale();
  const { user } = useAuth();
  const { currentProject, agents, agentsLoading, reloadAgents, setCurrentAgentId } = useProject();
  /** Header search, the Models page's shape: name, id and description, case-insensitive. */
  const [query, setQuery] = useState("");
  /** The kernel trail's raised badge, or undefined — the notice under the title acts on it or clears it. */
  const kernelTodo = useUpdateBadges().todos.agents;
  /** The bulk kernel update's confirmation is open. */
  const [kernelConfirmOpen, setKernelConfirmOpen] = useState(false);
  const [kernelRunning, setKernelRunning] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  /** The "Create with AI" dialog, a separate surface from the form above: neither path is a step of the other. */
  const [aiOpen, setAiOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /**
   * Plugin library for the create dialog's picker, flattened out of its groups: the picker is a
   * flat searchable list (the same panel the composer uses), so the grouping the library page
   * renders carries no meaning here. `null` until a fetch succeeds.
   */
  const [library, setLibrary] = useState<PluginPickItem[] | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  /** In-flight guard for that fetch (StrictMode runs the effect twice), released on failure so reopening retries. */
  const libraryPending = useRef(false);
  /** Open the create dialog. Its form mounts with it, so every opening starts empty. */
  const openCreate = () => setCreateOpen(true);

  // The library is fetched the first time the dialog opens, not on page load: the list itself
  // never needs it, and a failure here must not keep the dialog from creating a plain Agent —
  // the picker then offers nothing and the field states the error in place of its hint.
  useEffect(() => {
    if (!createOpen || library !== null || libraryPending.current) return;
    libraryPending.current = true;
    setLibraryError(null);
    api
      .getPluginLibrary()
      .then((res) => setLibrary(pluginPickItems(res.groups.flatMap((g) => g.plugins))))
      .catch((e: unknown) => {
        // Leave `library` unset and release the guard, so the next open tries again.
        libraryPending.current = false;
        setLibraryError(apiErrorText(e));
      });
  }, [createOpen, library]);

  // Cross-page create intent (the sidebar's mode-dependent "new" button navigates here
  // with { create: true } route state — the chat draft's route-state idiom): open the
  // existing create dialog once, then strip the state so a refresh or back-nav doesn't
  // reopen it. That button names no path, so it opens the form; the AI path is one click
  // away on the header the dialog sits over.
  const location = useLocation();
  const createIntent = (location.state as { create?: boolean } | null)?.create === true;
  useEffect(() => {
    if (!createIntent) return;
    openCreate();
    navigate(location.pathname, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createIntent]);
  /** Agent pending delete confirmation (null = none), with the machine it is deleted on. */
  const [deleting, setDeleting] = useState<{
    agentId: string;
    name: string;
    machine: { machineId: string; label: string } | null;
  } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const projectId = currentProject?.projectId;
  /** Each installed machine's own Agents, mixed into this server's list (lib/machine-agent-lists.ts). */
  const { lists: machineLists, reload: reloadMachine } = useMachineAgents(projectId ?? null);

  /**
   * The dialog created an Agent: close it, and land on the new Agent's settings — on the machine
   * it was created on, whose list is read again for its card.
   */
  const onCreated = async (createdId: string, machineId: string | null) => {
    setCreateOpen(false);
    if (machineId !== null) {
      reloadMachine(machineId);
      navigate(agentSettingsPath(createdId, machineId));
      return;
    }
    await reloadAgents();
    setCurrentAgentId(createdId);
    navigate(agentSettingsPath(createdId, null));
  };

  /**
   * "New Chat": enters draft state (same as sidebar group header) — the Session is only
   * actually created when the first message is sent. agentId travels via route state: when the
   * draft view restores from cache it prefers the cached agentId, but the route state explicitly
   * overrides it, ensuring that clicking "New Chat" on a given card always lands on that Agent
   * rather than the previous one from the cache.
   */
  const newChat = (agentId: string, machineId: string | null = null) => {
    // Typed-but-unsent draft text becomes a parked draft conversation first, and every field
    // but the Agent starts on the Project's new-chat defaults (new-chat.ts).
    if (user && projectId) prepareNewChatDraft(user.userId, projectId);
    // The current Agent is one of THIS server's. An id that only a machine has matches none of
    // them, and the chat page renders nothing — the draft included — until there is a current
    // Agent, so naming one here left a placeholder that never resolved. The draft takes a
    // machine's Agent from the route state below, and validates it against that machine's list.
    if (machineId === null) setCurrentAgentId(agentId);
    navigate(`/chat/${DRAFT_SESSION_ID}`, {
      // An Agent that lives on a machine runs there: the draft is handed that machine with an
      // empty Workspace, which is the temporary workspace ON it. The draft applies a machine
      // only together with a path, since a machine without one would send the Session to a
      // machine the chosen path is not on.
      state: machineId === null ? { agentId } : { agentId, workspace: "", machineId },
    });
  };

  /** Header search, over name, id, description and an employee's organizations and titles. */
  const searching = query.trim() !== "";
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (a: AgentSummary) =>
      needle === "" ||
      [
        agentDisplayName(a),
        a.agentId,
        a.description ?? "",
        ...employmentsOf(a).flatMap((e) => [e.orgName, e.title]),
      ].some((field) => field.toLowerCase().includes(needle));
  }, [query]);
  /** Every Agent, this server's and each machine's, in one order; then what the search leaves. */
  const shownAgents = useMemo(
    () => mixAgents(agents, machineLists).filter((row) => matches(row.agent)),
    [agents, machineLists, matches],
  );
  /**
   * The list in two sections: the Agents the user works with directly, then the employees of
   * the Project's organizations (agent-employment.ts), a machine's among them. The search box
   * filters both.
   */
  const sections = useMemo(() => splitByEmployment(shownAgents, (row) => row.agent), [shownAgents]);

  /**
   * Stat icon click: same navigation as the "Settings" button plus `?tab=` so the settings
   * page lands directly on the matching tab (unknown keys fall back to Overview there, so
   * "skills" is harmless until the Skills tab ships).
   */
  const openSettingsTab = (
    agentId: string,
    tab:
      "overview" | "tools" | "vault" | "schedules" | "skills" | "hooks" | "workbenches" | "memory",
    machineId: string | null = null,
  ) => {
    // The current Agent is one of THIS server's: a machine's Agent never becomes it.
    if (machineId === null) setCurrentAgentId(agentId);
    navigate(agentSettingsPath(agentId, machineId, tab));
  };

  /** Where a click on a card's body goes: the page its "Settings" button opens. */
  const openSettings = (agentId: string, machineId: string | null = null) => {
    if (machineId === null) setCurrentAgentId(agentId);
    navigate(agentSettingsPath(agentId, machineId));
  };

  const doDelete = async () => {
    if (!projectId || !deleting) return;
    const machineId = deleting.machine?.machineId ?? null;
    setBusy(true);
    setDeleteError(null);
    try {
      await api.deleteAgent(projectId, deleting.agentId, machineId);
      setDeleting(null);
      if (machineId !== null) reloadMachine(machineId);
      else await reloadAgents();
    } catch (e) {
      setDeleteError(apiErrorText(e));
      // Hired since the list was read: re-read it, so the card moves to the employees and its
      // delete button turns off.
      if (e instanceof ApiError && e.code === "agent_employed") {
        if (machineId !== null) reloadMachine(machineId);
        else void reloadAgents().catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * The notice's bulk action: run the kernel update on every Agent behind the current defaults
   * generation. The per-Agent update on the settings overview is untouched and stays the way to
   * take just one — which is what makes dismissing this notice safe, since nothing it silences
   * becomes unreachable.
   *
   * `Promise.allSettled` with a named partial failure, the shape the Skills page's bulk update
   * uses: a smart merge that lands on three Agents and fails on two must say WHICH two, or the
   * user is left re-checking every card by hand.
   */
  const runKernelUpdates = async (targets: readonly string[]) => {
    if (!projectId || targets.length === 0) return;
    setKernelRunning(true);
    const labels = targets.map((agentId) => {
      const agent = agents.find((a) => a.agentId === agentId);
      return agent ? agentDisplayName(agent) : agentId;
    });
    const results = await Promise.allSettled(
      targets.map((agentId) => api.kernelUpdateAgentConfig(projectId, agentId)),
    );
    const outcome = bulkOutcome(labels, results);
    if (outcome.allOk) toastSuccess(S.todo.bulkDone(outcome.ok));
    else {
      toastError(
        `${S.todo.bulkPartial(outcome.ok, failedList(outcome.failed, S.todo.listSeparator))} — ${apiErrorText(firstFailure(results))}`,
      );
    }
    // The gate reads `AgentSummary.kernelOutdated` off the Project's Agent list, so the dot only
    // goes down once that list is re-read. Runs after a partial failure too — some Agent moved.
    // Guarded, because `reloadAgents` rejects on a failed list read and the busy flag disables
    // every control on this page, the dialog's Cancel included: a reload that failed after the
    // writes landed would otherwise leave the page frozen with nothing saying why.
    try {
      await reloadAgents();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setKernelRunning(false);
      setKernelConfirmOpen(false);
    }
  };

  /**
   * One Agent's card: the same band for every Agent. `on` is the machine's list for a machine's
   * Agent — every control then acts on that machine, and while the machine cannot be reached the
   * card is greyed and inert, its controls disabled with the reason — and null for this server's.
   */
  const renderCard = ({ agent: a, on }: PlacedAgent) => {
    const builtin = BUILTIN_AGENT_IDS.has(a.agentId);
    const machineId = on?.machine.machineId ?? null;
    /** Whether the server holding the Agent can be asked right now (this one always can). */
    const reachable = on === null || on.live;
    /** Why a control is off on an unreachable machine's card. */
    const offReason = on !== null && !on.live ? (on.reason ?? S.common.loading) : null;
    // An organization's employee: its delete waits for it to leave (the server refuses
    // with 409 agent_employed), and the card says where it works.
    const employments = employmentsOf(a);
    const employedTitle =
      employments.length === 0 ? null : S.agent.employedUndeletable(employments);
    return (
      <AgentCard
        key={agentKey(machineId, a.agentId)}
        onOpen={reachable ? () => openSettings(a.agentId, machineId) : null}
        dimmed={!reachable}
      >
        {/* Info column: once it can't fit within 14rem, everything after it
                    (sparkline/buttons) wraps as a whole. The avatar counts as the first line
                    (same line as the name); description/stats share the same left edge as the
                    avatar (the column's left edge) */}
        <div className="min-w-[14rem] flex-1">
          {/* Title line: small avatar + name (+ the machine's SSH address) + agentId + version badge */}
          <div className="flex items-center gap-2">
            <AgentAvatar
              id={a.agentId}
              name={agentDisplayName(a)}
              size={18}
              className="shrink-0 rounded"
            />
            <AgentNameLink
              agentId={a.agentId}
              name={agentDisplayName(a)}
              machineId={machineId}
              onFollow={
                !reachable
                  ? null
                  : machineId === null
                    ? () => setCurrentAgentId(a.agentId)
                    : () => {}
              }
            />
            {/* The machine the Agent lives on, written as a machine's Workspace group writes it;
                its hint says what that means. A machine out of reach adds the lifted plug, its
                reason in the hint. */}
            {on !== null && (
              <span
                className="shrink-0 font-mono text-xs normal-case text-gray-400 dark:text-gray-500"
                data-tooltip={S.agent.onMachineHint(on.machine.label)}
                data-tooltip-extra
              >
                {S.chat.machineTag(on.machine.label)}
              </span>
            )}
            {offReason !== null && (
              <span
                role="img"
                aria-label={offReason}
                data-tooltip={offReason}
                data-tooltip-extra
                className={`shrink-0 ${toneInk.attention}`}
              >
                <GlyphIcon d={ICONS.plugLifted} size={ICON_SIZE.inlineGlyph} />
              </span>
            )}
            <AgentApiMark enabled={a.apiEnabled} />
            <span className="hidden shrink-0 font-mono text-xs text-gray-400 md:inline dark:text-gray-500">
              {a.agentId}
            </span>
            <Pill>v{a.version}</Pill>
            {/* Kernel-outdated pill: the card the sidebar's Agents dot leads to, so it
                        names the state in words rather than as another bare dot — a capsule in
                        the version badge's own geometry, in the attention tint (behind is
                        unfinished, not failed), opening the settings overview where the update
                        action lives. Not on a card that cannot open it. */}
            {a.kernelOutdated && reachable && (
              <UpdatePill onClick={() => openSettingsTab(a.agentId, "overview", machineId)}>
                {S.agent.kernelUpdateNeeded}
              </UpdatePill>
            )}
          </div>
          {/* Description truncated to one line (an empty description still takes up a line, keeping card heights equal) */}
          <p className="mt-1.5 min-h-4 truncate text-xs text-gray-500 dark:text-gray-400">
            {a.description ?? ""}
          </p>
          {/* An employee's organizations, one line each: the building every company
                      surface wears, then `<organization> · <title>`. */}
          {employments.map((e) => (
            <p
              key={e.orgId}
              className={`mt-1.5 flex min-w-0 items-center ${ICON_GAP.row} text-xs text-gray-500 dark:text-gray-400`}
            >
              <GlyphIcon d={ICONS.building} size={ICON_SIZE.inlineGlyph} className="shrink-0" />
              <span className="min-w-0 truncate">{S.agent.employmentLine(e.orgName, e.title)}</span>
            </p>
          ))}
          {/* Stats on their own line: same color/font size as the description; each
                      item hugs its content, with spacing left to the container's uniform
                      gap-x-4; meaning folded into the hover title. Tool/skill/hook/memory/
                      vault/schedule counts are buttons deep-linking to the matching settings tab,
                      listed in the settings tabs' order (also for built-in Agents — their
                      Settings entry point has no gating either); session count and
                      last-modified stay plain text.
                      flex-wrap is load-bearing: every item is shrink-0 (a count must not be
                      cut in half) and the row has no scroll box, so with nowrap the seven
                      items simply spill past the card's padding once the info column is
                      narrower than they are — a phone. Wrapping spends a second line instead,
                      and never triggers where the row already fits. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            <span
              className="inline-flex shrink-0 items-center gap-1 tabular-nums"
              data-tooltip={S.agent.sessionCount(a.sessionCount)}
            >
              <GlyphIcon d={CARD_ICONS.sessions} size={ICON_SIZE.inlineGlyph} />
              {a.sessionCount}
            </span>
            {(
              [
                ["tools", STAT_ICONS.toolCalls, a.toolCount, S.agent.toolCount(a.toolCount)],
                ["skills", CARD_ICONS.skills, a.skillCount, S.skills.skillCount(a.skillCount)],
                ["hooks", ICONS.fishHook, a.hookCount, S.hooks.hookCount(a.hookCount)],
                [
                  "workbenches",
                  ICONS.anvil,
                  a.workbenchCount ?? 0,
                  S.workbenches.count(a.workbenchCount ?? 0),
                ],
                ["memory", CARD_ICONS.memory, a.memoryCount, S.agent.memoryCount(a.memoryCount)],
                [
                  "vault",
                  CARD_ICONS.vaultKeys,
                  a.vaultKeyCount,
                  S.agent.vaultKeyCount(a.vaultKeyCount),
                ],
                [
                  "schedules",
                  CARD_ICONS.schedules,
                  a.scheduleCount,
                  S.agent.scheduleCount(a.scheduleCount),
                ],
              ] as const
            ).map(([tab, glyph, count, label]) => (
              <button
                key={tab}
                type="button"
                className={STAT_LINK_CLASS}
                disabled={!reachable}
                data-tooltip={label}
                aria-label={label}
                onClick={() => openSettingsTab(a.agentId, tab, machineId)}
              >
                <GlyphIcon d={glyph} size={ICON_SIZE.inlineGlyph} />
                {count}
              </button>
            ))}
            <span
              className="inline-flex shrink-0 items-center gap-1"
              data-tooltip={`${S.agent.updatedAt} ${a.updatedAt ? formatDateTime(a.updatedAt) : "—"}`}
              data-tooltip-extra={Boolean(a.updatedAt)}
            >
              <GlyphIcon d={STAT_ICONS.elapsed} size={ICON_SIZE.inlineGlyph} />
              {a.updatedAt ? formatRelativeDays(a.updatedAt, locale) : "—"}
            </span>
          </div>
        </div>

        {/* Session activity sparkline, GitHub Pulse style: daily active Session counts
                    against zero with a faint fill, in the success ink (an agent in use is a
                    healthy one). Hidden on narrow screens first, giving the horizontal space back
                    to content and buttons. */}
        <Sparkline
          values={a.sessionActivity}
          label={S.agent.activity(a.sessionActivity.length || 30)}
          area
          tone="success"
          width={100}
          height={30}
          className="hidden shrink-0 md:block"
        />

        {/* Button group to the right of the sparkline: "New Chat" shows text, the rest are square icon buttons (tooltip shows the full name) */}
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={!reachable}
            {...(offReason !== null ? { title: offReason, "data-tooltip-extra": true } : {})}
            onClick={() => newChat(a.agentId, machineId)}
          >
            <GlyphIcon d={CARD_ICONS.newChat} />
            {S.chat.newSessionMenu}
          </Button>
          <Button
            size="sm"
            disabled={!reachable}
            {...(offReason !== null ? { title: offReason, "data-tooltip-extra": true } : {})}
            onClick={() => openSettings(a.agentId, machineId)}
          >
            <GlyphIcon d={ICONS.gear} />
            {S.common.settings}
          </Button>
          {/* The usage center reads this server's records: a machine's Agent has none here. */}
          <Button
            size="icon"
            title={machineId !== null ? S.agent.usageThisServerOnly : S.nav.usage}
            aria-label={S.nav.usage}
            disabled={machineId !== null}
            onClick={() => navigate(`/usage?agentId=${encodeURIComponent(a.agentId)}`)}
          >
            <GlyphIcon
              d={CARD_ICONS.usage}
              size={15}
              className="text-gray-600 dark:text-gray-300"
            />
          </Button>
          {/* Built-in Agents can't be deleted: shown as a non-button light gray
                      placeholder (no border/background, no hover response, disabled cursor,
                      explained via tooltip); the transparent border keeps the same box size as
                      an icon button so column widths stay consistent across cards */}
          {builtin ? (
            <span
              role="img"
              data-tooltip={S.agent.builtinUndeletable}
              aria-label={S.agent.builtinUndeletable}
              className="inline-flex cursor-not-allowed items-center justify-center rounded-md border border-transparent p-1.5 text-gray-300 dark:text-gray-600"
            >
              <GlyphIcon d={CARD_ICONS.trash} size={15} />
            </span>
          ) : (
            <Button
              size="icon"
              variant="danger"
              title={offReason ?? employedTitle ?? S.agent.deleteAgent}
              aria-label={S.agent.deleteAgent}
              disabled={!reachable || employedTitle !== null}
              onClick={() =>
                setDeleting({
                  agentId: a.agentId,
                  name: agentDisplayName(a),
                  machine:
                    on === null
                      ? null
                      : { machineId: on.machine.machineId, label: on.machine.label },
                })
              }
            >
              <GlyphIcon d={CARD_ICONS.trash} size={15} />
            </Button>
          )}
        </div>
      </AgentCard>
    );
  };

  return (
    <PageFrame>
      {/* The title row and the notice under it share one header block, so the gap below it (to
          the list) is the same whether or not the notice is showing — the models page's header
          has the same shape. Search plus the create pair sit at the end of the title row: on a
          narrow screen they wrap onto their own line and the box shrinks with it, fixed width
          from sm up. Both controls take the form rung — CreateButtons defaults to it — so the
          buttons read at the size of the box beside them. */}
      <PageHeader
        title={S.agent.listTitle}
        actions={
          <>
            <div className="min-w-0 flex-1 sm:w-56 sm:flex-none">
              <Input
                size="sm"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={S.agent.searchPlaceholder}
              />
            </div>
            <AiCreateButtons onAi={() => setAiOpen(true)} onManual={openCreate} />
          </>
        }
      >
        {/* Last stop on the kernel trail, in the one shape all four dismissible trails use.
            An Agent's kernel is never NEW — the Agent already exists and its config is simply
            behind the defaults generation — so the line states the upgradable count alone
            rather than padding it with a zero the page has no meaning for. The per-card capsule
            below and the per-Agent update in settings are untouched. */}
        {kernelTodo && (
          <TodoNotice
            text={S.todo.changesUpgradable(noticeCounts(kernelTodo).updated)}
            actionLabel={S.todo.updateNow}
            busy={kernelRunning}
            onAction={() => setKernelConfirmOpen(true)}
            dismissLabel={S.todo.dismiss}
            onDismiss={() => dismissTodo(projectId ?? null, "agents", kernelTodo.signature)}
          />
        )}
      </PageHeader>

      {agentsLoading ? (
        /* Same single-column row styling as the real list (space-y-3 + the card's p-4), with a
           three-line info column plus sparkline/button-group placeholders, so no layout shift
           occurs once the skeleton disappears */
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonCard key={i} className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
              <div className="min-w-[14rem] flex-1">
                <Skeleton className="h-[18px] w-40" />
                <Skeleton className="mt-1.5 h-4 w-2/3" />
                <Skeleton className="mt-1.5 h-4 w-48" />
              </div>
              <Skeleton className="hidden h-9 w-40 md:block" />
              <Skeleton className="h-8 w-52" />
            </SkeletonCard>
          ))}
        </div>
      ) : shownAgents.length === 0 ? (
        <EmptyState title={query.trim() === "" ? S.common.none : S.agent.searchEmpty} />
      ) : (
        /* GitHub-repo-list-style single column: separate cards with row spacing; each row is
           one horizontal band of "info | sparkline | button group", with the info column
           compressed to two lines of text (name line + combined description/stats line) to
           minimize row height. The organizations' employees follow in a ruled section of their
           own, shown only when there is one to list. */
        <>
          <div className="space-y-3">
            {sections.agents.map(renderCard)}
            {/* Until the Project has an agent of its own, the list ends in the AI path's call to
              action: the built-in default is not one the user set up. Hidden while searching
              (the list itself is being filtered). */}
            {query.trim() === "" && agents.every((a) => BUILTIN_AGENT_IDS.has(a.agentId)) && (
              <EmptyState
                title={S.agent.firstAgentTitle}
                description={S.agent.firstAgentDesc}
                action={
                  <AiCreateButtons size="sm" onAi={() => setAiOpen(true)} onManual={openCreate} />
                }
              />
            )}
          </div>
          {sections.employees.length > 0 && (
            <RuledSection
              title={S.agent.employeesSection}
              count={sections.employees.length}
              info={S.agent.employeesSectionInfo}
              className={sections.agents.length > 0 ? "mt-8" : ""}
            >
              <div className="space-y-3">{sections.employees.map(renderCard)}</div>
            </RuledSection>
          )}
        </>
      )}

      <CreateAgentDialog
        open={createOpen}
        projectId={projectId ?? null}
        library={library}
        libraryError={libraryError}
        machines={machineLists
          .filter((list) => list.machine.link === "connected")
          .map((list) => ({ value: list.machine.machineId, label: list.machine.label }))}
        onClose={() => setCreateOpen(false)}
        onCreated={onCreated}
      />

      {/* The AI path, its own dialog rather than a mode of the form above: the draft plus the
          fixed tail lands in a new conversation with the Project's default agent, which runs the
          agent-initialization skill. The list reloads on every mount, so the new agent's card is
          there when the page is next visited. */}
      <AiCreateModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        title={S.agent.aiCreateTitle}
        intro={S.agent.aiCreateIntro}
        placeholder={S.agent.aiCreatePlaceholder}
        examples={S.agent.aiExamples}
        tail={S.agent.aiCreateTail}
        agents={agents}
      />

      {/* Bulk kernel update confirmation. The body is the per-Agent confirm's own wording,
          verbatim — a kernel update is a smart merge that advances the settings tabs the user
          has not touched and leaves the customized ones whole — with the list naming every
          Agent the batch would write to. Primary (overwrite) tone, like its per-Agent twin. */}
      {kernelTodo && kernelConfirmOpen && (
        <ConfirmModal
          open
          title={S.todo.agentsConfirmTitle(kernelTodo.count)}
          tone="primary"
          confirmLabel={S.agent.kernelUpdateAction}
          cancelLabel={S.common.cancel}
          busy={kernelRunning}
          onClose={() => setKernelConfirmOpen(false)}
          onConfirm={() => void runKernelUpdates(kernelTodo.items)}
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {S.agent.kernelUpdateConfirmBody}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{S.todo.willTouch}</p>
            <ul className="max-h-60 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
              {kernelTodo.items.map((id) => {
                const agent = agents.find((a) => a.agentId === id);
                return (
                  <li key={id} className="px-3 py-1.5 text-xs">
                    {agent ? agentDisplayName(agent) : id}
                  </li>
                );
              })}
            </ul>
          </div>
        </ConfirmModal>
      )}

      {/* Delete confirmation (shared ConfirmModal) */}
      <ConfirmModal
        open={deleting !== null}
        title={S.agent.deleteAgent}
        busy={busy}
        onClose={() => {
          setDeleting(null);
          setDeleteError(null);
        }}
        onConfirm={() => void doDelete()}
        confirmLabel={S.common.delete}
        cancelLabel={S.common.cancel}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deleting === null
            ? ""
            : deleting.machine === null
              ? S.agent.deleteConfirm(deleting.name)
              : S.agent.deleteConfirmOnMachine(deleting.name, deleting.machine.label)}
        </p>
        {deleteError && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{deleteError}</p>
        )}
      </ConfirmModal>
    </PageFrame>
  );
}

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
 * Buttons sit to the right of the sparkline: "New Chat" (draft state, same as sidebar group
 * header) and "Settings" (goes to settings page) show text labels; "Usage" (deep links via
 * ?agentId= to the usage center) and "Delete" (with confirmation; built-in Agents show a
 * non-interactive light gray placeholder with an undeletable tooltip) are square icon buttons
 * (tooltip shows the full name); "Create Agent" fills in name + description and picks what the
 * new Agent starts with — plugins from the library (each one's skills and hook package), and
 * Skills from a project directory's .agents/skills or .claude/skills — through form-variant
 * dropdowns over the shared multi-select panel, with select all / select none. A plain new Agent
 * otherwise starts with none.
 */
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import type {
  AgentCreateRequest,
  PluginItem,
  SkillMetadataItem,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { SEMANTIC_ID_PATTERN } from "../../lib/semantic-id";
import { formatDateTime, formatRelativeDays } from "../../lib/format";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useUpdateBadges } from "../../lib/use-update-badges";
import { dismissTodo } from "../../lib/todo-dismissals";
import { bulkOutcome, failedList, firstFailure, noticeCounts } from "../../lib/bulk-update";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { FieldError, FieldHint, FieldLabel } from "../../components/ui/field";
import { FormPicker } from "../../components/ui/form-picker";
import { Modal } from "../../components/ui/modal";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { Badge } from "../../components/ui/badge";
import { Skeleton, SkeletonCard } from "../../components/ui/skeleton";
import { EmptyState } from "../../components/ui/empty-state";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { UpdatePill } from "../../components/ui/update-dot";
import { TodoNotice } from "../../components/ui/todo-notice";
import { CloseIcon, GEAR_ICON, HOOK_ICON, PLUGIN_ICON } from "../../components/ui/icons";
import { STAT_ICONS } from "../../lib/stat-icons";
import { DRAFT_SESSION_ID } from "../chat/chat-page";
import { parkActiveDraft } from "../chat/draft-sessions";
import { ActivitySparkline } from "./activity-sparkline";
import {
  SNAPSHOT_ACCEPT,
  SNAPSHOT_BUTTON_CLASS,
  agentIdFromSnapshotName,
  fileToBase64,
} from "./snapshot-file";
import { InstallFromGistDialog } from "./install-dialog";
import { HiddenFileInput } from "../../components/ui/hidden-file-input";
import { WorkspaceSelect } from "../chat/workspace-select";
import { SkillPickList } from "../skills/skill-pick-list";
import type { PickableItem } from "../skills/skill-pick-list";
import { addSkillNames, removeSkillNames, toggleSkillName } from "../skills/skill-selection";
import { ICON_SIZE } from "../../lib/icon-scale";

/** Built-in Agent shipped with every Project (default_agent only; the server also rejects deletion, so no delete entry point is shown here). */
const BUILTIN_AGENT_IDS = new Set(["default_agent"]);

/** Card button icons (24x24 line path, rendered via GlyphIcon). */
const CARD_ICONS = {
  /** New chat (plus sign) */
  newChat: "M12 5v14M5 12h14",
  /** Delete (trash can) */
  trash:
    "M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0l-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7m4 4v6m4-6v6",
  /** Total session count (chat bubble) */
  sessions: "M8 10h8M8 14h5M21 12a9 9 0 1 1-4-7.5",
  /** Vault key count (key: bow + teeth) */
  vaultKeys: "M15.5 7.5l3 3L22 7l-3-3M21 2l-9.6 9.6M13 15.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z",
  /** Schedule count (alarm clock: dial + hands + twin bells, distinct from the plain clock face used for "last modified") */
  schedules: "M12 21a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm0-10v3l2 1.5M5 3L2.5 5.5M19 3l2.5 2.5",
  /** Installed skill count (open book, same family as the plugin library) */
  skills:
    "M12 6.5C10.5 5 8 4.5 4 5v12c4-.5 6.5 0 8 1.5 1.5-1.5 4-2 8-1.5V5c-4-.5-6.5 0-8 1.5zm0 0V18",
  /** Usage (bar chart, same as sidebar "Usage Center") */
  usage: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  /** Memory (brain: two hemispheres + inner fold, lucide simplified), opens the settings tab */
  memory:
    "M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18ZM12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18ZM15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4",
} as const;

/**
 * Stat entries that deep-link into a settings tab: same look as the plain stat spans
 * (no button chrome) plus a subtle hover text-color shift and pointer cursor.
 */
const STAT_LINK_CLASS =
  "inline-flex shrink-0 cursor-pointer items-center gap-1 tabular-nums " +
  "transition-colors duration-150 hover:text-gray-800 dark:hover:text-gray-200";

/**
 * The library's plugins as picker rows. A row is a Skill's metadata, which a plugin's manifest
 * already carries (name, descriptions, icon, version); a plugin without an icon.svg draws the
 * puzzle piece rather than the book.
 */
function pluginPickItems(plugins: readonly PluginItem[]): PickableItem[] {
  return plugins.map((plugin) => ({ ...plugin, fallbackIcon: PLUGIN_ICON }));
}

export function AgentsPage() {
  const navigate = useNavigate();
  useDocumentTitle(S.nav.agents);
  const { locale } = useLocale();
  const { user } = useAuth();
  const { currentProject, agents, agentsLoading, reloadAgents, setCurrentAgentId } = useProject();
  /** The kernel trail's raised badge, or undefined — the notice under the title acts on it or clears it. */
  const kernelTodo = useUpdateBadges().todos.agents;
  /** The bulk kernel update's confirmation is open. */
  const [kernelConfirmOpen, setKernelConfirmOpen] = useState(false);
  const [kernelRunning, setKernelRunning] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // The id is the only validated create field; format problems and the server's duplicate-id rejection land beside it.
  const [idError, setIdError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  /**
   * Plugin library for the create dialog's picker, flattened out of its groups: the picker is a
   * flat searchable list (the same panel the composer uses), so the grouping the library page
   * renders carries no meaning here. `null` until a fetch succeeds.
   */
  const [library, setLibrary] = useState<PickableItem[] | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  /** In-flight guard for that fetch (StrictMode runs the effect twice), released on failure so reopening retries. */
  const libraryPending = useRef(false);
  /** Library plugins to install into the new Agent (each one's skills and hook package), in pick order. */
  const [createPlugins, setCreatePlugins] = useState<string[]>([]);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  /**
   * Skills imported from a directory instead of the library, kept as its own field rather than
   * merged into the list above: the server lets a directory Skill and a library plugin's Skill
   * share a name (the directory one wins), which one flat list of picked names could not express.
   */
  const [skillsDir, setSkillsDir] = useState("");
  const [dirSkills, setDirSkills] = useState<SkillMetadataItem[] | null>(null);
  const [dirSkillsError, setDirSkillsError] = useState<string | null>(null);
  const [createDirSkills, setCreateDirSkills] = useState<string[]>([]);
  const [dirSkillsOpen, setDirSkillsOpen] = useState(false);
  /**
   * Snapshot package to initialize the new Agent from (null = default template). Picking one
   * hides the two seed fields: the package carries its own skills and hooks, and the server
   * rejects the combination.
   */
  const [snapshotFile, setSnapshotFile] = useState<File | null>(null);
  const [installOpen, setInstallOpen] = useState(false);

  /** Open the create dialog: don't keep the previous draft, always start from an empty form. */
  const openCreate = () => {
    setAgentId("");
    setName("");
    setDescription("");
    setIdError(undefined);
    setCreatePlugins([]);
    setPluginsOpen(false);
    setSkillsDir("");
    setDirSkills(null);
    setDirSkillsError(null);
    setCreateDirSkills([]);
    setDirSkillsOpen(false);
    setSnapshotFile(null);
    setCreateOpen(true);
  };

  const onPickSnapshot = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSnapshotFile(file);
    // Seeding and the package are mutually exclusive; drop any picks made before.
    setCreatePlugins([]);
    setSkillsDir("");
    setCreateDirSkills([]);
    // Suggest the id from the package name (exported as <agentId>-v<n>.tar.gz) while the
    // field is still empty; the suggestion stays editable, an unusable derivation is dropped.
    if (!agentId.trim()) {
      const derived = agentIdFromSnapshotName(file.name);
      if (SEMANTIC_ID_PATTERN.test(derived)) setAgentId(derived);
    }
  };

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
  // reopen it.
  const location = useLocation();
  const createIntent = (location.state as { create?: boolean } | null)?.create === true;
  useEffect(() => {
    if (!createIntent) return;
    openCreate();
    navigate(location.pathname, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createIntent]);
  /** Agent pending delete confirmation (null = none). */
  const [deleting, setDeleting] = useState<{ agentId: string; name: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const projectId = currentProject?.projectId;

  // Re-read whenever the picked directory changes. A directory that carries no Skills answers with
  // an empty list, which the field states in place of its hint rather than treating as a failure.
  useEffect(() => {
    if (!createOpen || !skillsDir || !projectId) {
      setDirSkills(null);
      setDirSkillsError(null);
      return;
    }
    let cancelled = false;
    // The previous directory's Skills go first: keeping them would leave their rows on offer and
    // their picked names submittable against the newly picked directory.
    setDirSkills(null);
    setDirSkillsError(null);
    api
      .listDirectorySkills(projectId, skillsDir)
      .then((res) => {
        if (!cancelled) setDirSkills(res.skills);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setDirSkills(null);
        setDirSkillsError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [createOpen, projectId, skillsDir]);

  // Picked names are dropped when they are no longer on offer, so switching directories cannot
  // submit a name the new one does not carry.
  useEffect(() => {
    if (dirSkills === null) {
      setCreateDirSkills((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const available = new Set(dirSkills.map((skill) => skill.name));
    setCreateDirSkills((prev) => {
      const next = prev.filter((name) => available.has(name));
      return next.length === prev.length ? prev : next;
    });
  }, [dirSkills]);

  const create = async () => {
    if (!projectId) return;
    const id = agentId.trim();
    if (!id) {
      setIdError(S.common.requiredField);
      return;
    }
    if (!SEMANTIC_ID_PATTERN.test(id)) {
      setIdError(S.agent.idHint);
      return;
    }
    setBusy(true);
    setIdError(undefined);
    try {
      // Name defaults to the id (leave blank to let the server fill it in from the id).
      const body: AgentCreateRequest = { agentId: id };
      if (name.trim()) body.name = name.trim();
      if (description.trim()) body.description = description.trim();
      if (snapshotFile !== null) {
        // Initialize from the picked package; seeding is mutually exclusive (the package
        // carries its own skills and hooks), and picking the file already cleared those fields.
        body.dataBase64 = await fileToBase64(snapshotFile);
      } else {
        // Picked plugins are seeded server-side inside the same create call, so a failure leaves
        // no half-equipped Agent behind.
        if (createPlugins.length > 0) body.plugins = createPlugins;
        // The pair only means anything together, so it is sent only when a directory actually
        // contributed something — picking a directory and then no Skills from it is a plain Agent.
        if (skillsDir && createDirSkills.length > 0) {
          body.skillsDirectory = skillsDir;
          body.directorySkills = createDirSkills;
        }
      }
      const res = await api.createAgent(projectId, body);
      setCreateOpen(false);
      await reloadAgents();
      setCurrentAgentId(res.agent.agentId);
      navigate(`/agents/${res.agent.agentId}`);
    } catch (e) {
      setIdError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * "New Chat": enters draft state (same as sidebar group header) — the Session is only
   * actually created when the first message is sent. agentId travels via route state: when the
   * draft view restores from cache it prefers the cached agentId, but the route state explicitly
   * overrides it, ensuring that clicking "New Chat" on a given card always lands on that Agent
   * rather than the previous one from the cache.
   */
  const newChat = (agentId: string) => {
    // Typed-but-unsent draft text becomes a parked draft conversation first (draft-sessions.ts).
    if (user && projectId) parkActiveDraft(user.userId, projectId);
    setCurrentAgentId(agentId);
    navigate(`/chat/${DRAFT_SESSION_ID}`, { state: { agentId } });
  };

  /**
   * Stat icon click: same navigation as the "Settings" button plus `?tab=` so the settings
   * page lands directly on the matching tab (unknown keys fall back to Overview there, so
   * "skills" is harmless until the Skills tab ships).
   */
  const openSettingsTab = (
    agentId: string,
    tab: "overview" | "tools" | "vault" | "schedules" | "skills" | "hooks" | "memory",
  ) => {
    setCurrentAgentId(agentId);
    navigate(`/agents/${agentId}?tab=${tab}`);
  };

  const doDelete = async () => {
    if (!projectId || !deleting) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await api.deleteAgent(projectId, deleting.agentId);
      setDeleting(null);
      await reloadAgents();
    } catch (e) {
      setDeleteError(apiErrorText(e));
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

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        {/* The title row and the notice under it share one block, so the gap below the block
            (to the list) is the same whether or not the notice is showing — the models page's
            header has the same shape. */}
        <div className="mb-4">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-xl font-semibold">{S.agent.listTitle}</h1>
            <div className="flex items-center gap-2">
              <Button onClick={() => setInstallOpen(true)}>{S.agent.installFromGist}</Button>
              <Button variant="primary" onClick={openCreate}>
                {S.agent.create}
              </Button>
            </div>
          </div>

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
        </div>
        {projectId && (
          <InstallFromGistDialog
            open={installOpen}
            onClose={() => setInstallOpen(false)}
            projectId={projectId}
            onInstalled={() => void reloadAgents()}
          />
        )}

        {agentsLoading ? (
          /* Same single-column row styling as the real list (space-y-3 + px-5 py-4), with a
             three-line info column plus sparkline/button-group placeholders, so no layout shift
             occurs once the skeleton disappears */
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonCard
                key={i}
                className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4"
              >
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
        ) : agents.length === 0 ? (
          <EmptyState title={S.common.none} />
        ) : (
          /* GitHub-repo-list-style single column: separate cards with row spacing; each row is
             one horizontal band of "info | sparkline | button group", with the info column
             compressed to two lines of text (name line + combined description/stats line) to
             minimize row height */
          <div className="space-y-3">
            {agents.map((a) => {
              const builtin = BUILTIN_AGENT_IDS.has(a.agentId);
              return (
                <div
                  key={a.agentId}
                  className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-gray-200 bg-white px-5 py-4 dark:border-gray-800 dark:bg-gray-900"
                >
                  {/* Info column: once it can't fit within 14rem, everything after it
                      (sparkline/buttons) wraps as a whole. The avatar counts as the first line
                      (same line as the name); description/stats share the same left edge as the
                      avatar (the column's left edge) */}
                  <div className="min-w-[14rem] flex-1">
                    {/* Title line: small avatar + name + agentId + version badge */}
                    <div className="flex items-center gap-2">
                      <AgentAvatar
                        id={a.agentId}
                        name={agentDisplayName(a)}
                        size={18}
                        className="shrink-0 rounded"
                      />
                      {/* min-w-0: flex children don't shrink below their content by default; needed here to truncate overly long names */}
                      <span className="min-w-0 truncate text-base font-bold">
                        {agentDisplayName(a)}
                      </span>
                      <span className="hidden shrink-0 font-mono text-xs text-gray-400 md:inline dark:text-gray-500">
                        {a.agentId}
                      </span>
                      <Badge tone="gray">v{a.version}</Badge>
                      {/* Kernel-outdated pill: the card the sidebar's Agents dot leads to, so it
                          names the state in words rather than as another bare dot — a capsule in
                          the version badge's own geometry, tinted the same pale red the dots on
                          this trail carry, opening the settings overview where the update action
                          lives. */}
                      {a.kernelOutdated && (
                        <UpdatePill onClick={() => openSettingsTab(a.agentId, "overview")}>
                          {S.agent.kernelUpdateNeeded}
                        </UpdatePill>
                      )}
                    </div>
                    {/* Description truncated to one line (an empty description still takes up a line, keeping card heights equal) */}
                    <p className="mt-1.5 min-h-4 truncate text-xs text-gray-500 dark:text-gray-400">
                      {a.description ?? ""}
                    </p>
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
                        title={S.agent.sessionCount(a.sessionCount)}
                      >
                        <GlyphIcon d={CARD_ICONS.sessions} size={ICON_SIZE.inlineGlyph} />
                        {a.sessionCount}
                      </span>
                      <button
                        type="button"
                        className={STAT_LINK_CLASS}
                        title={S.agent.toolCount(a.toolCount)}
                        aria-label={S.agent.toolCount(a.toolCount)}
                        onClick={() => openSettingsTab(a.agentId, "tools")}
                      >
                        <GlyphIcon d={STAT_ICONS.toolCalls} size={ICON_SIZE.inlineGlyph} />
                        {a.toolCount}
                      </button>
                      <button
                        type="button"
                        className={STAT_LINK_CLASS}
                        title={S.skills.skillCount(a.skillCount)}
                        aria-label={S.skills.skillCount(a.skillCount)}
                        onClick={() => openSettingsTab(a.agentId, "skills")}
                      >
                        <GlyphIcon d={CARD_ICONS.skills} size={ICON_SIZE.inlineGlyph} />
                        {a.skillCount}
                      </button>
                      <button
                        type="button"
                        className={STAT_LINK_CLASS}
                        title={S.hooks.hookCount(a.hookCount)}
                        aria-label={S.hooks.hookCount(a.hookCount)}
                        onClick={() => openSettingsTab(a.agentId, "hooks")}
                      >
                        <GlyphIcon d={HOOK_ICON} size={ICON_SIZE.inlineGlyph} />
                        {a.hookCount}
                      </button>
                      <button
                        type="button"
                        className={STAT_LINK_CLASS}
                        title={S.agent.memoryCount(a.memoryCount)}
                        aria-label={S.agent.memoryCount(a.memoryCount)}
                        onClick={() => openSettingsTab(a.agentId, "memory")}
                      >
                        <GlyphIcon d={CARD_ICONS.memory} size={ICON_SIZE.inlineGlyph} />
                        {a.memoryCount}
                      </button>
                      <button
                        type="button"
                        className={STAT_LINK_CLASS}
                        title={S.agent.vaultKeyCount(a.vaultKeyCount)}
                        aria-label={S.agent.vaultKeyCount(a.vaultKeyCount)}
                        onClick={() => openSettingsTab(a.agentId, "vault")}
                      >
                        <GlyphIcon d={CARD_ICONS.vaultKeys} size={ICON_SIZE.inlineGlyph} />
                        {a.vaultKeyCount}
                      </button>
                      <button
                        type="button"
                        className={STAT_LINK_CLASS}
                        title={S.agent.scheduleCount(a.scheduleCount)}
                        aria-label={S.agent.scheduleCount(a.scheduleCount)}
                        onClick={() => openSettingsTab(a.agentId, "schedules")}
                      >
                        <GlyphIcon d={CARD_ICONS.schedules} size={ICON_SIZE.inlineGlyph} />
                        {a.scheduleCount}
                      </button>
                      <span
                        className="inline-flex shrink-0 items-center gap-1"
                        title={`${S.agent.updatedAt} ${a.updatedAt ? formatDateTime(a.updatedAt) : "—"}`}
                      >
                        <GlyphIcon d={STAT_ICONS.elapsed} size={ICON_SIZE.inlineGlyph} />
                        {a.updatedAt ? formatRelativeDays(a.updatedAt, locale) : "—"}
                      </span>
                    </div>
                  </div>

                  {/* Session activity sparkline (hidden on narrow screens first, giving the horizontal space back to content and buttons) */}
                  <ActivitySparkline
                    data={a.sessionActivity}
                    label={S.agent.activity(a.sessionActivity.length || 30)}
                    className="hidden shrink-0 md:block"
                  />

                  {/* Button group to the right of the sparkline: "New Chat" shows text, the rest are square icon buttons (tooltip shows the full name) */}
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" variant="primary" onClick={() => newChat(a.agentId)}>
                      <GlyphIcon d={CARD_ICONS.newChat} />
                      {S.chat.newSessionMenu}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setCurrentAgentId(a.agentId);
                        navigate(`/agents/${a.agentId}`);
                      }}
                    >
                      <GlyphIcon d={GEAR_ICON} />
                      {S.common.settings}
                    </Button>
                    <Button
                      size="icon"
                      title={S.nav.usage}
                      aria-label={S.nav.usage}
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
                        title={S.agent.builtinUndeletable}
                        aria-label={S.agent.builtinUndeletable}
                        className="inline-flex cursor-not-allowed items-center justify-center rounded-md border border-transparent p-1.5 text-gray-300 dark:text-gray-600"
                      >
                        <GlyphIcon d={CARD_ICONS.trash} size={15} />
                      </span>
                    ) : (
                      <Button
                        size="icon"
                        variant="danger"
                        title={S.agent.deleteAgent}
                        aria-label={S.agent.deleteAgent}
                        onClick={() =>
                          setDeleting({ agentId: a.agentId, name: agentDisplayName(a) })
                        }
                      >
                        <GlyphIcon d={CARD_ICONS.trash} size={15} />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        open={createOpen}
        title={S.agent.createTitle}
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button onClick={() => setCreateOpen(false)}>{S.common.cancel}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void create()}>
              {S.common.create}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label={S.agent.id}
            required
            size="sm"
            value={agentId}
            onChange={(e) => {
              setAgentId(e.target.value);
              setIdError(undefined);
            }}
            error={idError}
            hint={S.agent.idHint}
            autoFocus
          />
          <Input
            label={S.common.name}
            size="sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            hint={S.agent.nameHint}
          />
          <Textarea
            label={S.agent.description}
            size="sm"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {/* Optional snapshot seed: the new Agent starts from an exported package instead of
              the default template. Picking one hides the two seed fields below — the package
              carries its own skills and hooks, and the server rejects the combination. */}
          <div>
            <FieldLabel>{S.agent.createSnapshot}</FieldLabel>
            {snapshotFile === null ? (
              <label
                className={`${SNAPSHOT_BUTTON_CLASS} ${busy ? "pointer-events-none opacity-60" : ""}`}
              >
                <HiddenFileInput
                  accept={SNAPSHOT_ACCEPT}
                  disabled={busy}
                  onChange={onPickSnapshot}
                />
                {S.agent.createSnapshotPick}
              </label>
            ) : (
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 truncate rounded-md border border-gray-300 bg-gray-50 px-2.5 py-1 font-mono text-xs dark:border-gray-700 dark:bg-gray-900">
                  {snapshotFile.name}
                </span>
                <button
                  type="button"
                  title={S.agent.createSnapshotClear}
                  aria-label={S.agent.createSnapshotClear}
                  disabled={busy}
                  onClick={() => setSnapshotFile(null)}
                  className="shrink-0 rounded-md p-1 text-gray-400 transition-colors duration-150 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <CloseIcon size={12} />
                </button>
              </div>
            )}
            <FieldHint>
              {snapshotFile === null ? S.agent.createSnapshotHint : S.agent.createSnapshotSkillsOff}
            </FieldHint>
          </div>
          {snapshotFile === null && (
            <>
              {/* Seed plugins: the form-variant picker (same trigger as the schedule dialog's
              model and workspace pickers) over the shared multi-select panel, so a dialog field
              and the composer's dropdown offer one list with one set of row semantics. */}
              <div>
                <FieldLabel>{S.agent.createPlugins}</FieldLabel>
                <FormPicker
                  open={pluginsOpen}
                  setOpen={setPluginsOpen}
                  label={
                    createPlugins.length === 0
                      ? S.agent.createPluginsPlaceholder
                      : S.agent.createPluginsPicked(createPlugins.length)
                  }
                  muted={createPlugins.length === 0}
                  title={S.agent.createPlugins}
                  ariaLabel={S.agent.createPlugins}
                  disabled={busy}
                  menuClass="w-[26rem]"
                >
                  <SkillPickList
                    skills={library ?? []}
                    selected={createPlugins}
                    onToggle={(pluginName) =>
                      setCreatePlugins((prev) => toggleSkillName(prev, pluginName))
                    }
                    onSelectAll={(names) => setCreatePlugins((prev) => addSkillNames(prev, names))}
                    onSelectNone={(names) =>
                      setCreatePlugins((prev) => removeSkillNames(prev, names))
                    }
                    emptyHint={library === null ? S.common.loading : S.agent.createPluginsEmpty}
                    searchPlaceholder={S.plugins.searchPlaceholder}
                  />
                </FormPicker>
                {libraryError ? (
                  <FieldError>{libraryError}</FieldError>
                ) : (
                  <FieldHint>{S.agent.createPluginsHint}</FieldHint>
                )}
              </div>
              {/* Skills a checkout already carries: pick the project directory, then pick from what
              its .agents/skills / .claude/skills hold. Separate from the library field because a
              directory Skill may share a library plugin's Skill name and still be the one installed. */}
              <div>
                <FieldLabel>{S.agent.createDirSkills}</FieldLabel>
                <WorkspaceSelect
                  projectId={projectId ?? ""}
                  workspace={skillsDir}
                  onChange={setSkillsDir}
                  variant="form"
                  fieldLabel={S.agent.createDirSkills}
                  emptyLabel={S.agent.createDirSkillsPick}
                  menuHint={S.agent.createDirSkillsHint}
                  clearLabel={S.agent.createDirSkillsClear}
                />
                {skillsDir && dirSkills !== null && dirSkills.length > 0 && (
                  <div className="mt-2">
                    <FormPicker
                      open={dirSkillsOpen}
                      setOpen={setDirSkillsOpen}
                      label={
                        createDirSkills.length === 0
                          ? S.agent.createSkillsPlaceholder
                          : S.agent.createSkillsPicked(createDirSkills.length)
                      }
                      muted={createDirSkills.length === 0}
                      title={S.agent.createDirSkills}
                      ariaLabel={S.agent.createDirSkills}
                      disabled={busy}
                      menuClass="w-[26rem]"
                    >
                      <SkillPickList
                        skills={dirSkills}
                        selected={createDirSkills}
                        onToggle={(skillName) =>
                          setCreateDirSkills((prev) => toggleSkillName(prev, skillName))
                        }
                        onSelectAll={(names) =>
                          setCreateDirSkills((prev) => addSkillNames(prev, names))
                        }
                        onSelectNone={(names) =>
                          setCreateDirSkills((prev) => removeSkillNames(prev, names))
                        }
                        emptyHint={S.agent.createDirSkillsEmpty}
                      />
                    </FormPicker>
                  </div>
                )}
                {dirSkillsError ? (
                  <FieldError>{dirSkillsError}</FieldError>
                ) : (
                  <FieldHint>
                    {!skillsDir
                      ? S.agent.createDirSkillsHint
                      : dirSkills === null
                        ? S.common.loading
                        : dirSkills.length === 0
                          ? S.agent.createDirSkillsEmpty
                          : S.agent.createDirSkillsFound(dirSkills.length)}
                  </FieldHint>
                )}
              </div>
            </>
          )}
        </div>
      </Modal>

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
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deleting ? S.agent.deleteConfirm(deleting.name) : ""}
        </p>
        {deleteError && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{deleteError}</p>
        )}
      </ConfirmModal>
    </div>
  );
}

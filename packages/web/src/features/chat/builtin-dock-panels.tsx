/**
 * The built-in dock panels as registry definitions: the conversation's views (subagents,
 * Files, Memory, Trace, messaging, schedules) and the built-in browser. A definition names its
 * panel once — the label and glyph every surface that lists panels reads — and carries the
 * tab's body. The conversation's bodies read the chat page's state through useChatDock (the
 * page provides it around both docks); the browser needs none of it.
 *
 * Importing the module registers the seven — chat-page.tsx does, so they are in the registry
 * before any dock renders.
 */
import { EmptyState, ICONS } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { NAV_ICONS } from "../../lib/nav-icons";
import { dockPanelDefinition, panelLabel, registerDockPanel } from "../dock/panel-registry";
import type { DockPanelBodyProps, DockPanelDefinition, PanelId } from "../dock/panel-registry";
import { isBrowserOffered, subscribeBrowser } from "../builtin-browser/browser-store";
import { BuiltinBrowserPanel } from "../builtin-browser/browser-panel";
import { TracePanel } from "../traces/trace-panel";
import { MessagingPanel } from "../messaging/messaging-panel";
import { SchedulePanel } from "../schedules/schedule-panel";
import { approvalModeChoices } from "./approval-mode";
import { useChatDock } from "./chat-dock-context";
import { ChatMemoryView } from "./memory-view";
import { SubagentsView } from "./subagents-view";
import { WorkspaceBrowser } from "./workspace-browser";

/**
 * What a conversation's tab shows on the draft page, before the first send creates the
 * Session it would show.
 */
function draftPlaceholder(id: PanelId) {
  return (
    <EmptyState
      title={panelLabel(id)}
      // The schedules tab says what the first message unlocks; the other tabs share one line.
      description={id === "schedules" ? S.schedule.panelDraftEmpty : S.dock.draftEmpty}
    />
  );
}

// The conversation's bodies. Keyed by Session where the view starts over per conversation
// (agents / memory / trace / messaging / schedules); the Workspace browser instead re-binds
// through its props — its own handled-once request guard is what the conversation-switch e2e
// covers.

function AgentsPanelBody() {
  const {
    selected,
    panelModel,
    stream,
    ctx,
    subagentFocus,
    subagentTaskScope,
    models,
    onChangePermission,
    modeSaving,
    parentThinkingLevel,
  } = useChatDock();
  if (!selected) return draftPlaceholder("agents");
  return (
    <SubagentsView
      key={selected.sessionId}
      session={selected}
      // The merged view (backfilled windows included): a chip on an older turn keeps
      // its historical graph and child conversation reachable after pagination.
      model={panelModel}
      version={stream.version}
      taskRunning={stream.taskState !== "idle"}
      ctx={ctx}
      focusRequest={subagentFocus}
      taskScope={subagentTaskScope}
      subagents={stream.subagents}
      models={models?.models ?? []}
      approvalMode={selected.approvalMode}
      approvalModes={approvalModeChoices(selected.client, selected.approvalMode)}
      onChangePermission={onChangePermission}
      modeSaving={modeSaving}
      parentThinkingLevel={parentThinkingLevel}
    />
  );
}

function WorkspacePanelBody({ active }: DockPanelBodyProps) {
  const {
    selected,
    draft,
    draftWorkspace,
    projectId,
    fileOpenRequest,
    settledTurnSignal,
    addComposerReference,
  } = useChatDock();
  // The draft's Files panel browses the folder picked in the composer, addressed by the
  // directory itself; a temporary Workspace has none yet.
  if (!selected && draft && projectId) {
    return draftWorkspace !== null ? (
      <WorkspaceBrowser
        scope={{
          kind: "workspace",
          projectId,
          workspace: draftWorkspace.path,
          machineId: draftWorkspace.machineId,
        }}
        active={active}
        onAddReference={addComposerReference}
      />
    ) : (
      <EmptyState title={panelLabel("workspace")} description={S.files.draftTemporary} />
    );
  }
  if (!selected) return draftPlaceholder("workspace");
  return (
    <WorkspaceBrowser
      scope={{ kind: "session", sessionId: selected.sessionId }}
      openRequest={fileOpenRequest}
      active={active}
      reloadSignal={settledTurnSignal}
      onAddReference={addComposerReference}
    />
  );
}

function MemoryPanelBody({ active }: DockPanelBodyProps) {
  const { selected, sessionMemoryChanges, memoryListing, memoryRequest, openMemorySettings } =
    useChatDock();
  if (!selected) return draftPlaceholder("memory");
  return (
    <ChatMemoryView
      key={selected.sessionId}
      session={selected}
      changes={sessionMemoryChanges}
      scopes={memoryListing.scopes}
      listingError={memoryListing.error}
      request={memoryRequest}
      active={active}
      // Management (add / edit / delete) lives on the agent-settings memory tab.
      onOpenSettings={() => openMemorySettings(selected.agentId)}
    />
  );
}

function TracePanelBody({ active }: DockPanelBodyProps) {
  const { selected, settledTurnSignal } = useChatDock();
  if (!selected) return draftPlaceholder("trace");
  return (
    <TracePanel
      key={selected.sessionId}
      session={selected}
      active={active}
      reloadSignal={settledTurnSignal}
    />
  );
}

function MessagingPanelBody({ active }: DockPanelBodyProps) {
  const { selected } = useChatDock();
  if (!selected) return draftPlaceholder("messaging");
  return <MessagingPanel key={selected.sessionId} sessionId={selected.sessionId} active={active} />;
}

function SchedulesPanelBody({ active }: DockPanelBodyProps) {
  const { selected, prefillComposer } = useChatDock();
  if (!selected) return draftPlaceholder("schedules");
  return (
    <SchedulePanel
      key={selected.sessionId}
      session={selected}
      active={active}
      onPrefillComposer={prefillComposer}
    />
  );
}

const BUILTIN_DOCK_PANELS: readonly DockPanelDefinition[] = [
  {
    id: "agents",
    label: () => S.chat.openAgents,
    glyph: ICONS.robotPair,
    order: 10,
    Body: AgentsPanelBody,
  },
  {
    id: "workspace",
    label: () => S.chat.workspacePanel,
    glyph: ICONS.folder,
    order: 20,
    Body: WorkspacePanelBody,
  },
  {
    id: "memory",
    label: () => S.chat.memoryViewTitle,
    glyph: ICONS.brain,
    order: 30,
    Body: MemoryPanelBody,
  },
  {
    id: "trace",
    label: () => S.nav.traces,
    glyph: NAV_ICONS.traces,
    order: 40,
    Body: TracePanelBody,
  },
  {
    id: "messaging",
    label: () => S.messaging.panelTitle,
    glyph: ICONS.paperPlane,
    order: 50,
    Body: MessagingPanelBody,
  },
  {
    id: "schedules",
    label: () => S.schedule.panelTitle,
    glyph: ICONS.alarmClock,
    order: 60,
    Body: SchedulesPanelBody,
  },
  // The browser is one set of pages shared by every conversation, not a Session's view, so it
  // needs no Session and works on the draft page too. It exists only where this window can
  // host it and the server can drive it (the desktop app).
  {
    id: "builtin-browser",
    label: () => S.builtinBrowser.panelTitle,
    glyph: ICONS.globe,
    order: 70,
    offered: isBrowserOffered,
    subscribeOffered: subscribeBrowser,
    Body: BuiltinBrowserPanel,
  },
];

/**
 * Registers the built-in panels. Idempotent: a kind already registered with its very
 * definition is left alone, so a repeated call changes nothing and wakes no listener, while a
 * kind missing from the registry comes back.
 */
export function registerBuiltinDockPanels(): void {
  for (const definition of BUILTIN_DOCK_PANELS) {
    if (dockPanelDefinition(definition.id) !== definition) registerDockPanel(definition);
  }
}

registerBuiltinDockPanels();

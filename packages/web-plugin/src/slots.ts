/**
 * The slots a plugin's web half contributes to, as the data its `@Module({ contributes })` literal
 * carries and the code its `@Bind` fields hold. The Web App declares its slots with these same
 * types, so the kernel's boot check and a plugin's compiler judge one shape.
 *
 * A contribution's data half is written out in the manifest literal and checked at boot; its code
 * half is the contributor's `@Bind("<id>")` field.
 */
import type { ComponentType } from "react";

/** The data half of every slot whose contributions only need a place: ascending `order`. */
export interface Ordered {
  order: number;
}

// ------------------------------------------------------------------ WebAppModule

/**
 * `WebAppModule.serverModules`: the contributing web module's contributions are drawn only while
 * the server module of this name runs (it is in `GET /api/contributions`' `modules`). A web
 * module whose server half is built into the platform declares none.
 */
export interface ServerModuleData {
  /** The server module's class name, as its manifest names it. */
  module: string;
}

// ------------------------------------------------------------------ DockModule

/** `DockModule.panels`, data half: the panel's identity wherever it is named. */
export interface DockPanelData {
  /** The tab's stored key — stable across versions, since layouts persist it. */
  kind: string;
  /** The panel's name on its tab and in the docks' menus, in English and in Chinese. */
  title: string;
  titleZh: string;
  /** Its mark: a key of the UI package's icon registry (`ICONS`). */
  icon: string;
  /** Its place in the docks' menus, ascending. */
  order: number;
  /**
   * Listed first in an empty dock's picker, before every other offered panel (both runs by
   * `order`). A `mainDefinitions` entry that does not say it itself takes its contribution's.
   */
  lead?: boolean;
}

/** The authorized Session that a host workbench was opened for. */
export interface SessionWorkbenchScope {
  projectId: string;
  machineId: string | null;
  agentId: string;
  sessionId: string;
  workspace?: string;
}

/** A panel's body; a host workbench receives the explicit Session that owns its tools. */
export type DockPanelBody = ComponentType<{ active: boolean; scope?: SessionWorkbenchScope }>;

/**
 * `DockModule.panels`, code half: the body itself, or `{ mainDefinitions }` when the panel names
 * itself in the active language and is offered only in some places.
 */
export interface DockPanelDefinition {
  /** The panel kind: the contribution's `kind`. */
  id: string;
  /** Its name, read at call time (the language on screen). */
  label: () => string;
  /** Its glyph's path (an `ICONS` value). */
  glyph: string;
  order: number;
  /** As `DockPanelData.lead`. */
  lead?: boolean;
  /** Whether it is offered here; always when absent. */
  offered?: () => boolean;
  /** Availability in a Session directory, where no conversation has been selected yet. */
  availableFromAppCenter?: (viewer: { isAdmin: boolean }) => boolean;
  subscribeAppCenterAvailability?: (listener: () => void) => () => void;
  /** The change feed of `offered`: followed from registration for good, so it must only listen. */
  subscribeOffered?: (listener: () => void) => () => void;
  Body: DockPanelBody;
}

/** `DockModule.scopeListeners`: what a listener is told when the conversation on screen changes. */
export interface DockScopeChange {
  /**
   * The docks' new scope: the Session on screen, a draft's own scope (`<projectId>:new` or
   * `<projectId>:draft-…`), or null on a page with no conversation.
   */
  scope: string | null;
  /** The Project on screen, or null. */
  projectId: string | null;
}

/** Called synchronously, before the docks switch to the new scope. */
export type DockScopeListener = (change: DockScopeChange) => void;

/**
 * `DockModule.layoutListeners`: called after each step of a dock surface entering or leaving
 * full screen has reached the DOM — what a layer drawn over a panel by coordinates re-measures on.
 */
export type DockLayoutListener = () => void;

// ------------------------------------------------------------------ SettingsModule

/** `SettingsModule.sections`, data half: one page of the Settings dialog. */
export interface SettingsSectionData {
  /** The page's key: what `requestSettings({ section })` names. */
  key: string;
  /**
   * The rail heading it sits under: the viewer's own preferences, the whole server's, or a
   * plugin's — `plugin` joins the page of the plugin `plugin` names instead of taking a rail entry
   * of its own, in its personal part (`visibility: "everyone"`) or its server part (`"admin"`).
   */
  group: "personal" | "server" | "plugin";
  /** With `group: "plugin"`: the npm package of the plugin whose page it joins. */
  plugin?: string;
  /** Who sees it: every signed-in viewer, or admins alone. */
  visibility: "everyone" | "admin";
  /**
   * Its rail glyph: a key of the UI package's icon registry (`ICONS`). In a plugin's page, the
   * page's glyph when the plugin library has no icon for the plugin.
   */
  icon: string;
  /** Its place in the rail among every page, the Web App's own included, ascending; in a plugin's page, its place there. */
  order: number;
}

/** What the Settings dialog hands a contributed page. */
export interface SettingsPageProps {
  /**
   * Goes to another page of the same dialog — by key, the app's own (`archived`) or a contributed
   * one — through the dialog's leave guard, as the rail does. A page the viewer may not open
   * falls back to their first.
   */
  openPage: (key: string) => void;
}

/** `SettingsModule.sections`, code half. */
export interface SettingsSectionCode {
  /** The page's name on the rail and over the pane, read at render time. */
  label: () => string;
  /** The page's explanation behind the "?" beside its heading, when it has one. */
  info?: () => string;
  /** The page. */
  Body: ComponentType<SettingsPageProps>;
}

// ------------------------------------------------------------------ ChatModule

/**
 * `ChatModule.sessionHandovers`: a conversation takes a new id — a draft's first send created its
 * Session, a Session healed into a new one, or a failed first send hands the draft its own back —
 * and whatever the contributor keeps under the old one moves to the new one. Awaited in `order`.
 */
export type SessionHandover = (fromScope: string, toSessionId: string) => Promise<void>;

/** One row of a web link's context menu. */
export interface LinkRow {
  /** Its glyph's path (an `ICONS` value). */
  glyph: string;
  label: string;
  onSelect: () => void;
}

/**
 * `ChatModule.linkActions`, code half: the row a contributor offers for a web link in the stream,
 * or null when it offers none right now; `subscribe` is the feed of that answer's changes.
 * Contributed rows come before the Web App's own (open outside the app, copy the address).
 */
export interface LinkAction {
  row(href: string): LinkRow | null;
  subscribe(listener: () => void): () => void;
}

// ------------------------------------------------------------------ SessionsModule

/** `SessionsModule.userEvents`, code half: a feature's share of the user event stream. */
export interface UserEventHandler<E = unknown> {
  /** One event the session list did not keep; `source` is the machine it came from, null here. */
  event(ev: E, source: string | null): void;
  /** The stream reconnected past its replay buffer on `source`: events were lost. */
  resync?(source: string | null): void;
}

/**
 * `@prismshadow/penguin-web-plugin` — what a shipped plugin's web half may use of the Web App.
 *
 * A plugin's web half is TypeScript source the Web App compiles with itself (its package's
 * `exports["./web"]`, under `src/web/`). Besides this package it imports only
 * `@prismshadow/penguin-ui`, React and the kernel's decorators; it never imports the Web App, and
 * the Web App never imports it except through the generated list of shipped plugins. The host
 * abilities here forward to the Web App's own (bridge.ts); the slot types are the ones the Web
 * App declares its slots with (slots.ts); the string tables follow the language on screen
 * (strings.ts).
 */
export {
  ApiError,
  apiErrorText,
  apiFetch,
  currentDockScope,
  failureNode,
  failureOf,
  formatBytes,
  formatDateTime,
  formatRelativeLong,
  formatRelativeShort,
  isTabShown,
  openPanel,
  requestSettings,
  toastApiError,
  toneDot,
  toneInk,
  toneSurface,
} from "./bridge";
export type {
  ApiErrorClass,
  ApiErrorShape,
  ApiFetchOptions,
  DockPosition,
  FailureContext,
  Tone,
} from "./bridge";
export { defineStrings, webLocale } from "./strings";
export type { WebLocale } from "./strings";
export type {
  DockLayoutListener,
  DockPanelBody,
  DockPanelData,
  DockPanelDefinition,
  DockScopeChange,
  DockScopeListener,
  LinkAction,
  LinkRow,
  Ordered,
  ServerModuleData,
  SessionHandover,
  SettingsPageProps,
  SettingsSectionCode,
  SettingsSectionData,
  UserEventHandler,
} from "./slots";

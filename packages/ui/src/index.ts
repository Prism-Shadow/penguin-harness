/**
 * @prismshadow/penguin-ui — the shared UI package: token contract, themes, fonts and the
 * component set. Source-only: a consumer's `workspace:*` dependency is linked to this directory,
 * so Vite, vitest and tsc read `src/` through the `exports` map in package.json, never a build.
 *
 * Every component is exported from here, one line per module, grouped by the wave that moved it
 * in. A barrel costs no bundle bytes in a source-only package: the bundlers tree-shake it by
 * module.
 */
export * from "./hooks";
export * from "./tokens";
export * from "./strings";
export * from "./icon-scale";

// W1 — icons: the glyph registry and its renderer, the chevron, the fixed-grid marks, the
// spinner, logos and avatars.
export * from "./components/icons/icons";
export * from "./components/icons/glyph-icon/glyph-icon";
export * from "./components/icons/chevron/chevron";
export * from "./components/icons/marks/marks";
export * from "./components/icons/spinner/spinner";
export * from "./components/icons/logos/provider-logo";
export * from "./components/icons/logos/penguin-logo";
export * from "./components/icons/avatars/avatar";
export * from "./components/icons/avatars/agent-avatar";
export * from "./components/icons/avatars/user-avatar";
export * from "./components/icons/avatars/avatar-stack";

// W1 — status and feedback: the state dot, the run-state and activity marks, the update dot,
// badges, loading placeholders and empty states.
export * from "./components/icons/dot/dot";
export * from "./components/icons/status-icon/status-icon";
export * from "./components/icons/activity-icon/activity-icon";
export * from "./components/icons/update-dot/update-dot";
export * from "./components/feedback/badge/badge";
export * from "./components/feedback/skeleton/skeleton";
export * from "./components/feedback/empty-state/empty-state";

// W1 — actions.
export * from "./components/actions/close-button/close-button";
export * from "./components/actions/button/button";
export * from "./components/actions/link/link";
export * from "./components/actions/copy-button/copy-button";
export * from "./components/actions/kbd/kbd";
export * from "./components/actions/hidden-file-input/hidden-file-input";

// W2-0 — menu panel: the panel, row states and check mark every picker and menu shares.
export * from "./components/overlays/menu-panel/menu-panel";

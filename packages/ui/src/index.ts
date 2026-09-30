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

// W2-A — forms: the field scaffolding, the text controls and their search box, checkboxes and
// radios.
export * from "./components/forms/field/field";
export * from "./components/forms/input/input";
export * from "./components/forms/password-input/password-input";
export * from "./components/forms/search-input/search-input";
export * from "./components/forms/checkbox/checkbox";
export * from "./components/forms/radio/radio";

// W2-B — pickers, switches and settings rows, with the portal panel and the "?" disclosure they
// open (moved up from W3).
export * from "./components/overlays/portal-panel/use-portal-panel";
export * from "./components/overlays/info-popover/info-popover";
export * from "./components/overlays/info-popover/help-fold";
export * from "./components/forms/select/select";
export * from "./components/forms/select/option-menu";
export * from "./components/forms/picker-list/picker-list";
export * from "./components/forms/switch/switch";
export * from "./components/forms/toggle-row/toggle-row";
export * from "./components/forms/segmented/segmented";
export * from "./components/forms/swatch-picker/swatch-picker";
export * from "./components/forms/pref-row/pref-row";

// W3-A — menus and hints: the dropdown panel and the Menu rows it holds, the row context menu
// (its hook and its pure gesture rules), the form-style picker built on the dropdown, and the
// tooltip with its document-wide `data-tooltip` layer.
export * from "./components/overlays/dropdown/dropdown";
export * from "./components/overlays/menu/menu";
export * from "./components/overlays/portal-panel/context-menu";
export * from "./components/overlays/portal-panel/use-row-context-menu";
export * from "./components/forms/select/form-picker";
export * from "./components/overlays/tooltip/tooltip";

// W3-B — dialogs: the Escape-layer stack and focus rules every overlay shares, the modal family,
// the drawer and the spring sheet with their motion helpers, and the lightbox.
export * from "./components/overlays/esc-layers/esc-layers";
export * from "./components/overlays/modal/modal";
export * from "./components/overlays/confirm-modal/confirm-modal";
export * from "./components/overlays/paged-dialog/paged-dialog";
export * from "./components/overlays/drawer/drawer";
export * from "./components/overlays/drawer/sheet";
export * from "./components/overlays/lightbox/lightbox";
export * from "./motion/spring";
export * from "./motion/sheet-physics";
export * from "./motion/use-reduced-motion";

// W3-C — notices: the notice strip, and the toast stack that renders its toasts through it
// (with the `toast*` functions and their store).
export * from "./components/feedback/notice/notice-strip";
export * from "./components/overlays/toaster/toaster";

// W5 — content: Markdown as reading text and its pipeline, the code surface and block with the
// language tables, the type roles, and the diff viewer. The Shiki engine is not here: it is the
// `./highlighter` subpath, so no static import of this barrel reaches it.
export * from "./components/content/prose/prose";
export * from "./components/content/prose/markdown-plugins";
export * from "./components/content/code-block/code-block";
export * from "./components/content/code-block/code-languages";
export * from "./components/content/typography/typography";
export * from "./components/content/diff-viewer/diff-viewer";

// W4-A — navigation, notices and readings: the tab bar, the grouped list's header, folder, more
// row and pager, the create pair, the notice with its variants and the page to-do built on it,
// the progress bar, the duration slot and its live clock, the beta tag, the disclosure row, and
// the stat tile and chip.
export * from "./components/navigation/tabs/tabs";
export * from "./components/navigation/group-header/group-header";
export * from "./components/navigation/group-header/pager";
export * from "./components/actions/create-buttons/create-buttons";
export * from "./components/feedback/notice/notice";
export * from "./components/feedback/todo-notice/todo-notice";
export * from "./components/feedback/progress-bar/progress-bar";
export * from "./components/feedback/duration-slot/duration-slot";
export * from "./components/feedback/beta-badge/beta-badge";
export * from "./components/layout/disclosure-row/disclosure-row";
export * from "./components/data/stat-tile/stat-tile";
export * from "./components/data/stat-chip/stat-chip";

// W4-B — layout and data: the card, the page frame and header, the ruled and the collapsible
// section, the entity header, list rows, label/value pairs, the log well and the table family.
export * from "./components/layout/card/card";
export * from "./components/layout/page/page";
export * from "./components/layout/ruled-section/ruled-section";
export * from "./components/layout/collapsible-section/collapsible-section";
export * from "./components/layout/entity-header/entity-header";
export * from "./components/data/list-row/list-row";
export * from "./components/data/key-value/key-value";
export * from "./components/data/log-view/log-view";
export * from "./components/data/table/table";

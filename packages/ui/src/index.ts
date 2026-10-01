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

// W4-C — navigation: the nav list and its rows, the rail of a paged dialog or a settings page.
export * from "./components/navigation/nav-list/nav-list";

// W8-A — charts: the theme's chart style, the primitives every mark is drawn through, the plot
// frame with its geometry, and the charts built on them — the token donut, the sparkline, the
// ring gauge and the legend.
export * from "./components/charts/chart-style";
export * from "./components/charts/marks/geom";
export * from "./components/charts/marks/marks";
export * from "./components/charts/marks/timeline-bar";
export * from "./components/charts/chart-frame/chart-geom";
export * from "./components/charts/chart-frame/chart-frame";
export * from "./components/charts/token-donut/token-donut";
export * from "./components/charts/sparkline/sparkline";
export * from "./components/charts/ring/ring";
export * from "./components/charts/legend/legend";

// W8-B — the command palette: the search box over the caller's actions, and its filter.
export * from "./components/overlays/command-palette/command-palette";

// W6-A1 — the transcript's messages: what the person sent and the run's notice lines, the
// assistant reply with its caret and the theme-paced reveal behind it, and the changes card.
// The reveal's pacing (stream-reveal.ts) stays inside the family: its hook is the door.
export * from "./components/chat/message-bubble/message-bubble";
export * from "./components/chat/assistant-text/assistant-text";
export * from "./components/chat/assistant-text/streaming-caret";
export * from "./components/chat/assistant-text/use-stream-reveal";
export * from "./components/chat/assistant-text/stream-style";
export * from "./components/chat/changes-card/changes-card";

// W6-A2 — the transcript's work: the work group and its rows (the thinking row, the tool call and
// the approval block it holds), the process banner and the subagent row.
export * from "./components/chat/work-group/work-group";
export * from "./components/chat/thinking-block/thinking-block";
export * from "./components/chat/tool-call-card/tool-call-card";
export * from "./components/chat/approval-block/approval-block";
export * from "./components/chat/step-banner/step-banner";
export * from "./components/chat/subagent-chip/subagent-chip";

// W6-B — the composer: its card, chip row, toolbar triggers, action button and slash list, the
// toolbar select, the context ring, the model picker, and the chips with remove buttons.
export * from "./components/chat/composer/composer";
export * from "./components/chat/composer/toolbar-trigger";
export * from "./components/chat/menu-select/menu-select";
export * from "./components/chat/context-ring/context-ring";
export * from "./components/chat/model-select/model-select";
export * from "./components/forms/tag-input/tag-input";

// W6-C — the company channel: a sender's run of messages and its bubbles.
export * from "./components/chat/channel-bubble/channel-bubble";

// W7-A — files: the pointer-drag machine with the resize handle and the split pane built on it,
// the file tree and its row logic, the read-only file browser, the Files panel's tree and preview
// panes, the drop overlay, the file menu's rows, the in-place editor, the breadcrumbs and their
// fit, and the frontmatter helper the Markdown readers share.
export * from "./components/layout/resize-handle/use-pointer-drag";
export * from "./components/layout/resize-handle/resize-handle";
export * from "./components/layout/resize-handle/split-pane";
export * from "./components/files/file-tree/tree-rows";
export * from "./components/files/file-tree/file-tree";
export * from "./components/files/file-browser/file-browser";
export * from "./components/files/tree-pane/tree-pane";
export * from "./components/files/preview-pane/preview-pane";
export * from "./components/files/drop-overlay/drop-overlay";
export * from "./components/files/workspace-file-menu/workspace-file-menu";
export * from "./components/content/workspace-file-editor/workspace-file-editor";
export * from "./components/navigation/breadcrumbs/crumb-fit";
export * from "./components/navigation/breadcrumbs/breadcrumbs";
export * from "./components/content/prose/frontmatter";

// W7-C — the dock: its tab strip, its frame and header buttons, the picker of an empty dock, the
// toolbar's dock toggles, and the floating launcher's ball and fan.
export * from "./components/navigation/dock-tabs/dock-tabs";
export * from "./components/shell/dock-frame/dock-frame";
export * from "./components/shell/dock-picker/dock-picker";
export * from "./components/shell/panels-toolbar/panels-toolbar";
export * from "./components/shell/launcher/launcher";

// W7-B — the shell: the app window and its columns, the folded rail, the phone's top bar, the
// pinned sidebar's frame with its nav fold, list header and controls, and the conversation row
// with the hover actions it shares.
export * from "./components/shell/app-shell/app-shell";
export * from "./components/shell/rail/rail";
export * from "./components/shell/mobile-top-bar/mobile-top-bar";
export * from "./components/shell/sidebar-frame/sidebar-frame";
export * from "./components/shell/session-row/session-row";

// The drag image every draggable row hands the browser: an opaque, themed copy of the row.
export * from "./components/overlays/drag-preview/drag-preview";

/**
 * How a Mermaid diagram takes the app's theme: Mermaid's `base` theme for the geometry, and a
 * stylesheet in the app's own tokens laid over it.
 *
 * The colours cannot go in as theme variables. Mermaid derives most of its palette from a few
 * seed colours with colour arithmetic (darken, lighten, invert) when it initialises, and that
 * arithmetic needs a literal colour: a `var(--ui-…)` seed throws, and a colour resolved from the
 * page once would freeze the diagram in the mode it was drawn in. So the seeds stay Mermaid's
 * defaults and `themeCSS` restyles what a reader sees — shapes, lines, arrowheads and the text
 * drawn on the page — with `var(--ui-…)` references. The diagram's SVG sits inline in the page,
 * so the references resolve against whatever theme and mode the page is in, and a theme or mode
 * switch recolours a drawn diagram with no re-render. No theme id is read anywhere.
 *
 * What is restyled: flowcharts, sequence, state, class and ER diagrams — their nodes, clusters,
 * edges, markers, labels and notes — and every diagram's text that sits on the page itself
 * (titles, axes, legends, a Gantt chart's outside labels). What is left to the base theme: the
 * filled categorical shapes of pie, Gantt, journey, mindmap and timeline diagrams, whose text
 * colours Mermaid pairs with their own fills, so they stay readable in either mode.
 *
 * Mermaid deletes any configuration string containing an angle bracket, so the rules use
 * descendant selectors only — never a child combinator.
 */

/** The faces the diagram's text is measured and drawn in: the reading face. */
const FONT = "var(--ui-font-sans)";

const RULES: readonly string[] = [
  // Text drawn on the page: titles, axes, legends, labels outside a bar.
  ".titleText, .flowchartTitleText, .statediagramTitleText, .classTitleText, .pieTitleText, .sectionTitle, .legend text, .tick text, .taskTextOutsideRight, .taskTextOutsideLeft { fill: var(--ui-fg); }",
  ".grid .tick { stroke: var(--ui-line); }",
  ".today { stroke: var(--ui-tone-danger-fg); }",

  // Nodes and clusters (flowchart, state, class, ER).
  ".node rect, .node circle, .node ellipse, .node polygon, .node path, .entityBox, g.classGroup rect, g.stateGroup rect { fill: var(--ui-surface); stroke: var(--ui-line-emphasis); }",
  ".cluster rect, .statediagram-cluster rect { fill: var(--ui-surface-muted); stroke: var(--ui-line); }",
  ".statediagram-cluster .inner { fill: var(--ui-surface); }",
  ".divider, .statediagram-state .divider, g.classGroup line { stroke: var(--ui-line-emphasis); }",
  ".nodeLabel, .label, .label text, .label span, .cluster-label text, .cluster-label span, .cluster text, .cluster span, g.classGroup text, g.stateGroup text, .stateLabel text, .state-title { color: var(--ui-fg); fill: var(--ui-fg); }",
  ".node circle.state-start, .node .fork-join { fill: var(--ui-fg); stroke: var(--ui-fg); }",
  ".node circle.state-end { fill: var(--ui-fg); stroke: var(--ui-fg); }",
  ".end-state-inner { fill: var(--ui-fg); stroke: var(--ui-canvas); }",

  // Edges, their labels and their arrowheads.
  ".edgePath .path, .flowchart-link, .relation, .transition, .relationshipLine { stroke: var(--ui-fg-muted); }",
  ".arrowheadPath { fill: var(--ui-fg-muted); }",
  ".marker { fill: var(--ui-fg-muted); stroke: var(--ui-fg-muted) !important; }",
  ".edgeLabel, .edgeLabel p, .edgeLabel span, .labelBkg { background-color: var(--ui-canvas); color: var(--ui-fg); }",
  ".edgeLabel rect, .edgeLabel .label rect, .relationshipLabelBox { fill: var(--ui-canvas); }",
  ".edgeLabel .label text, .edgeLabel text { fill: var(--ui-fg); }",

  // Sequence diagrams.
  ".actor { fill: var(--ui-surface); stroke: var(--ui-line-emphasis); }",
  "text.actor, text.actor tspan, .actor-man text { fill: var(--ui-fg); }",
  ".actor-line { stroke: var(--ui-line-emphasis); }",
  ".actor-man line, .actor-man circle { fill: var(--ui-surface); stroke: var(--ui-fg-muted); }",
  ".messageLine0, .messageLine1 { stroke: var(--ui-fg-muted); }",
  ".messageText { fill: var(--ui-fg); }",
  'marker[id$="arrowhead"] path, marker[id$="crosshead"] path, marker[id$="filled-head"] path { fill: var(--ui-fg-muted); stroke: var(--ui-fg-muted); }',
  '[id$="sequencenumber"] { fill: var(--ui-fg-muted); }',
  ".sequenceNumber { fill: var(--ui-canvas); }",
  ".labelBox { fill: var(--ui-surface-muted); stroke: var(--ui-line-emphasis); }",
  ".labelText, .labelText tspan, .loopText, .loopText tspan { fill: var(--ui-fg); }",
  ".loopLine { stroke: var(--ui-line-emphasis); fill: var(--ui-line-emphasis); }",
  ".activation0, .activation1, .activation2 { fill: var(--ui-surface-muted); stroke: var(--ui-line-emphasis); }",

  // Notes, in every diagram that has them: the attention tint on the neutral line.
  ".note, .state-note, .statediagram-note rect { fill: var(--ui-tone-attention-bg); stroke: var(--ui-line); }",
  ".noteText, .noteText tspan, .state-note text, .statediagram-note text, .statediagram-note .nodeLabel { fill: var(--ui-tone-attention-fg); color: var(--ui-tone-attention-fg); }",
];

/** The stylesheet Mermaid scopes to each diagram it draws. */
export const MERMAID_THEME_CSS = RULES.join("\n");

/**
 * The configuration every diagram is drawn with. `securityLevel: "strict"` sanitises labels and
 * turns off click handlers and links, and Mermaid keeps it out of a diagram's own reach (it is
 * one of the keys a diagram's directives may not set). `startOnLoad: false`: nothing on the page
 * is rendered unless a block asks. `suppressErrorRendering`: a diagram that fails to parse
 * throws to the block, which shows its source, instead of Mermaid inserting its own error graphic
 * into the page.
 */
export const MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: "strict",
  theme: "base",
  suppressErrorRendering: true,
  fontFamily: FONT,
  themeVariables: { fontFamily: FONT },
  themeCSS: MERMAID_THEME_CSS,
} as const;

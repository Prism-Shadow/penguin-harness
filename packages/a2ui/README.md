# @prismshadow/a2ui

A2UI is how a PenguinHarness reply carries UI: a choice, a form, steps, a callout, a Mermaid diagram, a chart drawn from data, or a weather, clock, countdown, metrics or system-resource widget, each written as a fenced ```` ```a2ui ```` block (one JSON object) or ```` ```mermaid ```` block inside ordinary Markdown. This package is the grammar of those blocks: the catalog's types and limits, fence discovery, validation, the mermaid checks, a form field's answer rule, the whole-reply check with its score and self-review rubric, the reply's language, the plain-text fallback, and the texts a pick or a filled form puts in the composer together with their inverse. No runtime dependencies; runs in Node 24 and in current browsers.

PenguinHarness reads replies with it everywhere: the Web App renders the blocks with its own components (`@prismshadow/penguin-ui` bundles this package), the CLI and the messaging channels print the fallback, and the a2ui Skill's `scripts/check.mjs` is this package's checker bundled into one file.

The package is versioned with PenguinHarness. Up to 0.2.18 the same grammar shipped inside the SDK as `@prismshadow/penguin-core/a2ui`; the names it exports are unchanged.

## Check a reply

```ts
import { checkReply, parseA2ui, toFallbackMarkdown } from "@prismshadow/a2ui";

const reply = [
  "Which environment should I deploy to?",
  "",
  "```a2ui",
  '{"type":"choice","question":"Deploy to","options":[{"label":"Staging"},{"label":"Production"}]}',
  "```",
].join("\n");

const report = checkReply(reply);
report.ok; // false when any block has an error-level issue
report.score; // { l1, l2, total }, 0–100 each

parseA2ui('{"type":"callout","tone":"note","text":"Saved."}').issues; // []

toFallbackMarkdown(reply); // the same reply as readable text, for a surface that cannot render blocks
```

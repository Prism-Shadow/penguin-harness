/**
 * 内容: the type roles (every heading rung, the display title, the text roles, inline code),
 * Markdown as reading text in its two densities, a code block and a bare code surface with its
 * gutter, the diff viewer unified, side by side and read from a patch, and a reply carrying A2UI
 * blocks — all from the package. Code is highlighted by the highlighter the frame provides, as in
 * the app.
 *
 * The A2UI reply carries every block the catalog has, in each of its layouts: the four widgets
 * (weather, clock, countdown, metrics), a choice as cards, as chips and as a multi-select, a form
 * whose fields take a segmented control, toggle chips, a stepper and an input, a timeline of
 * steps, two callouts, a diagram, and a block that cannot be drawn. It is live: the clock ticks
 * and the countdown counts down, a pick or a submit shows the text the app would put in the
 * composer as a toast, in the gallery's language, and the invalid block shows the fallback every
 * surface does. The widgets' data is a fixed snapshot, as a model's would be.
 */
import { useMemo } from "react";
import {
  A2uiActionsProvider,
  CodeBlock,
  CodeSurface,
  DiffViewer,
  Heading,
  InlineCode,
  Prose,
  Text,
  toastInfo,
} from "@prismshadow/penguin-ui";
import type { A2uiActions, HeadingLevel, TextVariant } from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";
import type { GalleryStrings } from "../../strings";

const LEVELS: readonly HeadingLevel[] = [1, 2, 3, 4, 5, 6];
const TEXT_VARIANTS: readonly TextVariant[] = [
  "body",
  "small",
  "caption",
  "eyebrow",
  "mono",
  "label",
];

/** Code is the same in both languages: it is data, not copy. */
const CODE = `export function greet(name: string, excited = false): string {
  const mark = excited ? "!" : ".";
  return \`Hello, \${name}\${mark}\`;
}
`;

const BEFORE = `import { readFile } from "node:fs/promises";

export async function loadConfig(path: string) {
  const text = await readFile(path, "utf8");
  return JSON.parse(text);
}

export const DEFAULT_PATH = "config.json";
`;

const AFTER = `import { readFile } from "node:fs/promises";

export async function loadConfig(path: string, fallback = {}) {
  const text = await readFile(path, "utf8").catch(() => null);
  return text === null ? fallback : JSON.parse(text);
}

export const DEFAULT_PATH = "penguin.config.json";
`;

const PATCH = `diff --git a/src/limits.ts b/src/limits.ts
--- a/src/limits.ts
+++ b/src/limits.ts
@@ -1,4 +1,5 @@ export const LIMITS
 export const LIMITS = {
-  uploadMb: 10,
+  uploadMb: 14,
+  previewKb: 256,
   retries: 3,
 };
`;

/** A fill shows up as a toast; the empty fill of "Other…" (a cleared composer) shows nothing. */
const showFill = (text: string): void => {
  if (text !== "") toastInfo(text);
};

/** The board's A2UI actions, one stable object per language. */
const A2UI_ACTIONS: Readonly<Record<"zh" | "en", A2uiActions>> = {
  zh: { interactive: true, fill: showFill, lang: "zh" },
  en: { interactive: true, fill: showFill, lang: "en" },
};

/** A block the grammar refuses (no such type), the same in both languages. */
const INVALID_BLOCK = '{ "type": "slider", "min": 0, "max": 10 }';

const fence = (language: string, body: string) => `\`\`\`${language}\n${body}\n\`\`\``;

/** The sample reply as the model would write it: each block introduced by a sentence. */
function a2uiReply(t: GalleryStrings["library"]["content"]): string {
  return [
    ...t.a2uiReply.flatMap(({ lead, spec }) => [
      lead,
      fence("a2ui", JSON.stringify(spec, null, 2)),
    ]),
    t.a2uiDiagramLead,
    fence("mermaid", t.a2uiDiagram),
    t.a2uiInvalidLead,
    fence("a2ui", INVALID_BLOCK),
  ].join("\n\n");
}

export function ContentBoard() {
  const { S, state } = useGallery();
  const t = S.library.content;
  // One string per language, so the memoised Markdown parses it once.
  const reply = useMemo(() => a2uiReply(t), [t]);
  return (
    <div className="gf-board">
      <BoardGroup title={t.headings} aside={t.headingsHint}>
        <div className="lib-stack lib-stack-wide">
          <Heading level={1} display>
            {t.display}
          </Heading>
          {LEVELS.map((level) => (
            <Heading key={level} level={level}>
              {t.heading(level)}
            </Heading>
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.text}>
        <div className="lib-stack lib-stack-wide">
          {TEXT_VARIANTS.map((variant) => (
            <div key={variant} className="lib-row">
              <Text variant={variant}>{t.samples[variant]}</Text>
              <code className="lib-caption">{variant}</code>
            </div>
          ))}
          <div className="lib-row">
            <Text>
              {t.inline.before}
              <InlineCode>{t.inline.code}</InlineCode>
              {t.inline.after}
            </Text>
            <code className="lib-caption">InlineCode</code>
          </div>
        </div>
      </BoardGroup>
      <BoardGroup title={t.prose}>
        <div className="lib-stack lib-stack-wide">
          <Prose text={t.proseSample} className="text-base leading-relaxed text-fg" />
          <span className="lib-caption">{t.compact}</span>
          <Prose variant="compact" text={t.compactSample} className="text-sm text-fg" />
        </div>
      </BoardGroup>
      <BoardGroup title={t.code}>
        <div className="lib-stack lib-stack-wide">
          <CodeBlock language="ts" code={CODE} />
          <span className="lib-caption">{t.surface}</span>
          <div className="lib-box text-xs leading-relaxed">
            <CodeSurface language="ts" code={CODE} lineNumbers />
          </div>
        </div>
      </BoardGroup>
      <BoardGroup title={t.diff}>
        <div className="lib-stack lib-stack-wide">
          <span className="lib-caption">{t.unified}</span>
          <DiffViewer before={BEFORE} after={AFTER} language="ts" label={t.diffLabel} />
          <span className="lib-caption">{t.split}</span>
          <DiffViewer
            before={BEFORE}
            after={AFTER}
            language="ts"
            mode="split"
            label={t.diffLabel}
          />
          <span className="lib-caption">{t.patch}</span>
          <DiffViewer patch={PATCH} language="ts" label={t.patchLabel} />
        </div>
      </BoardGroup>
      <BoardGroup title={t.a2ui} aside={t.a2uiHint}>
        <div className="lib-stack lib-stack-wide">
          <A2uiActionsProvider value={A2UI_ACTIONS[state.lang]}>
            <Prose text={reply} className="text-base leading-relaxed text-fg" />
          </A2uiActionsProvider>
        </div>
      </BoardGroup>
    </div>
  );
}

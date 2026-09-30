/**
 * 内容: the type roles (every heading rung, the display title, the text roles, inline code),
 * Markdown as reading text in its two densities, a code block and a bare code surface with its
 * gutter, and the diff viewer unified, side by side and read from a patch — all from the package.
 * Code is highlighted by the highlighter the frame provides, as in the app.
 */
import {
  CodeBlock,
  CodeSurface,
  DiffViewer,
  Heading,
  InlineCode,
  Prose,
  Text,
} from "@prismshadow/penguin-ui";
import type { HeadingLevel, TextVariant } from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

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

export function ContentBoard() {
  const { S } = useGallery();
  const t = S.library.content;
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
    </div>
  );
}

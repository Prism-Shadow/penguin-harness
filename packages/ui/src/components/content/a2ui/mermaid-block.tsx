/**
 * A ```mermaid fence drawn as a diagram.
 *
 * Mermaid is large, so it is not part of any bundle that does not draw a diagram: the first
 * diagram imports it, and every later one reuses that load. The source is checked against the
 * grammar's rules first (an allowed diagram type, no directives, no links), and a source that
 * breaks one is never handed to Mermaid. Mermaid then runs strict (mermaid-theme.ts): no
 * scripts, no click handlers, labels sanitised.
 *
 * Each render takes an id of its own — Mermaid builds the SVG in a scratch element under that id
 * and scopes the diagram's stylesheet to it, so two diagrams, or one drawn twice, never share
 * one. A diagram that fails to draw falls back to its source with a notice naming the error, the
 * way an invalid block does. A drawn diagram keeps a toggle that shows its source under it.
 *
 * While the reply streams the block is the quiet placeholder; it draws once, on the settle.
 */
import { useEffect, useMemo, useState } from "react";
import { checkMermaid } from "@prismshadow/penguin-core/a2ui";
import { useUiStrings } from "../../../strings";
import { Button } from "../../actions/button/button";
import { CodeBlock } from "../code-block/code-block";
import { MERMAID_CONFIG } from "./mermaid-theme";
import { A2uiInvalid, A2uiPending, oneLine } from "./parts";

/** The library's API, named from its default export so no named type export is relied on. */
type Mermaid = (typeof import("mermaid"))["default"];

let loading: Promise<Mermaid> | null = null;

/** Mermaid, imported and configured on first use; a failed import is retried next time. */
function loadMermaid(): Promise<Mermaid> {
  loading ??= import("mermaid").then(
    ({ default: mermaid }) => {
      // A copy: `initialize` writes the computed theme back into the object it is handed.
      mermaid.initialize({
        ...MERMAID_CONFIG,
        themeVariables: { ...MERMAID_CONFIG.themeVariables },
      });
      return mermaid;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

let renders = 0;

/** The diagram's SVG markup; rejects with Mermaid's own error when the source does not draw. */
async function renderMermaid(source: string): Promise<string> {
  const mermaid = await loadMermaid();
  renders += 1;
  const id = `a2ui-mermaid-${renders}`;
  try {
    const { svg } = await mermaid.render(id, source);
    return svg;
  } finally {
    // A failed render can leave its scratch element behind under the page's body.
    if (typeof document !== "undefined") {
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
    }
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return oneLine(error.message);
  return oneLine(String(error));
}

type DrawState = { source: string; svg: string } | { source: string; error: string };

function MermaidDiagram({ source }: { source: string }) {
  const strings = useUiStrings().a2ui;
  const ruleError = useMemo(
    () => checkMermaid(source).find((issue) => issue.level === "error"),
    [source],
  );
  const [drawn, setDrawn] = useState<DrawState>();
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    if (ruleError !== undefined) return;
    let alive = true;
    renderMermaid(source).then(
      (svg) => {
        if (alive) setDrawn({ source, svg });
      },
      (error: unknown) => {
        if (alive) setDrawn({ source, error: messageOf(error) });
      },
    );
    return () => {
      alive = false;
    };
  }, [source, ruleError]);

  // Only this source's drawing counts; a stale one from before a source change is not shown.
  const current = drawn?.source === source ? drawn : undefined;
  const svg = current !== undefined && "svg" in current ? current.svg : undefined;
  // The markup is Mermaid's, from a source the model wrote: under `securityLevel: "strict"`
  // Mermaid passes its SVG through DOMPurify before returning it, so it carries no script, no
  // event handler and no link, and the source never reached Mermaid with a directive or a click.
  // Held stable: React compares this prop by identity and rebuilds the SVG whenever it changes,
  // which would drop a selection inside the diagram on any re-render around it.
  const html = useMemo(() => (svg === undefined ? undefined : { __html: svg }), [svg]);

  if (ruleError !== undefined) {
    return <A2uiInvalid language="mermaid" source={source} reason={oneLine(ruleError.message)} />;
  }
  if (current !== undefined && "error" in current) {
    return <A2uiInvalid language="mermaid" source={source} reason={current.error} />;
  }
  if (html === undefined) return <A2uiPending label={strings.diagram} />;
  return (
    <figure className="a2ui-block my-3" data-a2ui="mermaid" aria-label={strings.diagram}>
      <div
        className="overflow-x-auto rounded-lg border border-line px-4 py-3 [&>svg]:mx-auto"
        dangerouslySetInnerHTML={html}
      />
      <div className="mt-1 flex justify-end">
        <Button
          variant="ghost"
          size="xs"
          aria-pressed={showSource}
          onClick={() => setShowSource((shown) => !shown)}
        >
          {strings.showSource}
        </Button>
      </div>
      {showSource && <CodeBlock language="mermaid" code={source} />}
    </figure>
  );
}

export interface MermaidBlockProps {
  /** The fence's body: the diagram's source. */
  source: string;
  /** The reply is still arriving: show the placeholder, draw nothing. */
  streaming?: boolean;
}

export function MermaidBlock({ source, streaming = false }: MermaidBlockProps) {
  if (streaming) return <A2uiPending />;
  return <MermaidDiagram source={source} />;
}

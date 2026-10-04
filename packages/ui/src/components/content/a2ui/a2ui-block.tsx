/**
 * A ```a2ui fence: one JSON object naming a component from the catalog and filling its fields,
 * drawn by the renderer registered for its type.
 *
 * The grammar (`parseA2ui`) is the one judge of a block: it parses the JSON and checks it against
 * the catalog's rules, and only a block with no error reaches a renderer. Anything else — broken
 * JSON, an unknown type, a field over its limit, a type no renderer draws — shows its source with
 * one line naming the first error, so a reader never loses what the model wrote and never sees
 * an empty box. A renderer that throws is caught the same way.
 *
 * While the reply streams the block is a quiet placeholder: a half-written fence is not JSON yet,
 * and parsing it on every frame would flash errors at the reader. It parses once, on the settle,
 * and a block that draws arrives under `data-reveal`, the theme's entrance for content appearing
 * in a settled surface, so it never pops in where the placeholder stood. The fallback for a block
 * that cannot be drawn takes no entrance: it is a notice, not the block.
 */
import { Component, useMemo } from "react";
import type { ReactNode } from "react";
import { parseA2ui } from "@prismshadow/penguin-core/a2ui";
import { A2uiInvalid, A2uiPending, oneLine } from "./parts";
import { useA2uiRenderer } from "./registry";

export interface A2uiBlockProps {
  /** The fence's body: the JSON the model wrote. */
  source: string;
  /** The reply is still arriving: show the placeholder, parse nothing. */
  streaming?: boolean;
}

/** Catches a renderer that throws and shows the block's source in its place. */
class RenderGuard extends Component<
  { source: string; fallback: (reason: string) => ReactNode; children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: oneLine(error instanceof Error ? error.message : String(error)) };
  }

  componentDidUpdate(previous: { source: string }) {
    // A new source is a new block: give the renderer another chance.
    if (previous.source !== this.props.source && this.state.error !== null) {
      this.setState({ error: null });
    }
  }

  render() {
    return this.state.error === null ? this.props.children : this.props.fallback(this.state.error);
  }
}

function ParsedBlock({ source }: { source: string }) {
  const parsed = useMemo(() => parseA2ui(source), [source]);
  const Renderer = useA2uiRenderer(parsed.spec?.type ?? "");
  const invalid = (reason: string) => (
    <A2uiInvalid language="a2ui" source={source} reason={reason} />
  );

  if (parsed.spec === undefined) {
    const first = parsed.issues.find((issue) => issue.level === "error") ?? parsed.issues[0];
    // The grammar names an error whenever it returns no spec; the fence's language stands in
    // only if it ever does not.
    return invalid(first !== undefined ? oneLine(first.message) : "a2ui");
  }
  if (Renderer === undefined) return invalid(parsed.spec.type);
  return (
    <RenderGuard source={source} fallback={invalid}>
      <div data-reveal>
        <Renderer spec={parsed.spec} />
      </div>
    </RenderGuard>
  );
}

export function A2uiBlock({ source, streaming = false }: A2uiBlockProps) {
  if (streaming) return <A2uiPending />;
  return <ParsedBlock source={source} />;
}

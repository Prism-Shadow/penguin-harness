/**
 * The one Markdown renderer: every surface that shows Markdown — a chat message, a Trace event, a
 * benchmark case, a Workspace file preview — goes through here, so they cannot drift apart on the
 * pipeline (lib/markdown-plugins.ts) and none of them has to know that the math stage is loaded on
 * demand. `useRehypeStage` is called here and nowhere else: a hook cannot sit inside the `.map`
 * a Trace row renders its parts from, but a component can.
 *
 * `streaming` is the chat renderer's flag — the body is still receiving deltas, so the expensive
 * stage stays off until it settles (see NO_REHYPE_PLUGINS). `components` is react-markdown's own
 * element map, passed through as-is; a caller that builds one must build it once at module scope
 * (a fresh map per render is a new element type per commit, which remounts every code block).
 */
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { REMARK_PLUGINS, useRehypeStage } from "../../lib/markdown-plugins";

export function Markdown({
  text,
  streaming = false,
  components,
}: {
  text: string;
  streaming?: boolean;
  components?: Components;
}) {
  const rehypePlugins = useRehypeStage(text, streaming);
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
}

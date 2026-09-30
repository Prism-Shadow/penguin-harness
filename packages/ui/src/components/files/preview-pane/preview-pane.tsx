/**
 * PreviewPane: the Files panel's right-hand column — what a chosen file looks like. An image
 * (click to zoom), a PDF in the browser's own viewer, Markdown as reading text, source as the
 * highlighted code surface, a note for a file it cannot draw; an empty state while nothing is
 * chosen, and a skeleton while the file is on its way.
 *
 * The caller decides what the file is and fetches it; this draws the `view` it is handed. An
 * embedded page (the panel's sandboxed HTML preview) arrives as an `embed` node, because the
 * sandbox and the page's origin are the caller's security decision, not a drawing one.
 *
 * Two things float with the body. `actions` is a small pill pinned over its top-right corner —
 * the controls that act on the text underneath (wrap, copy, edit) rather than on the file —
 * always drawn, never hover-revealed, since a hover-only control is no control on a touch screen.
 * `editor` replaces the body while the file is being edited; the pill stays, because the editor
 * lays its text over the same surface and still wraps by the same toggle.
 *
 * The body is the scroll box, and `bodyRef` / `bodyProps` reach it: the caller's context menu
 * hangs off it (the gestures, the keyboard chord, the anchor it returns focus to). It is focusable
 * only programmatically (`tabIndex={-1}`), so Escape has somewhere to hand focus back to.
 */
import type { HTMLAttributes, Key, ReactNode, Ref } from "react";
import type { Components } from "react-markdown";
import { CodeSurface } from "../../content/code-block/code-block";
import { Prose } from "../../content/prose/prose";
import { EmptyState } from "../../feedback/empty-state/empty-state";
import { SkeletonList } from "../../feedback/skeleton/skeleton";
import { ZoomableImage } from "../../overlays/lightbox/lightbox";

/** What the pane draws. */
export type PreviewView =
  /** Nothing chosen: an empty state, with an action (showing a hidden tree) when there is one. */
  | { kind: "empty"; title: string; action?: ReactNode }
  /** A file is chosen and on its way: the whole pane waits. */
  | { kind: "opening" }
  /** Part of the file's view is still loading (a page's source fetched on demand). */
  | { kind: "loading" }
  | { kind: "error"; message: string }
  /** `reloadKey` remounts the image when the file is re-read under the same URL. */
  | { kind: "image"; src: string; alt: string; reloadKey?: Key }
  | { kind: "pdf"; src: string; title: string; reloadKey?: Key }
  /** An embedded page the caller frames itself, with its own sandbox. */
  | { kind: "embed"; node: ReactNode }
  /**
   * Markdown as reading text. `components` swaps element adapters (images and links that know
   * where the file lives); `truncatedNote` says the file was cut short.
   */
  | { kind: "markdown"; text: string; components?: Components; truncatedNote?: string }
  /** Source on the code surface — the same surface the editor lays its textarea over. */
  | {
      kind: "source";
      code: string;
      language: string;
      wrap: boolean;
      truncatedNote?: string;
    }
  | { kind: "unsupported"; message: string };

export interface PreviewPaneProps {
  view: PreviewView;
  /** The pill over the body's top-right corner; omitted, no pill. */
  actions?: ReactNode;
  /** The editor, drawn in place of the body while the file is edited. */
  editor?: ReactNode;
  /** The body's context menu (its portal), drawn after the body. */
  menu?: ReactNode;
  bodyRef?: Ref<HTMLDivElement>;
  /** Handlers on the body — the caller's context-menu gestures. */
  bodyProps?: Omit<HTMLAttributes<HTMLDivElement>, "className" | "tabIndex" | "children">;
  className?: string;
}

/** Whether a slot was given something to draw: `cond && node` hands over `false` when it was not. */
const given = (node: ReactNode): boolean => node !== undefined && node !== null && node !== false;

/** The small print under a preview that stopped short of the whole file. */
function TruncatedNote({ note, source }: { note: string | undefined; source: boolean }) {
  if (note === undefined) return null;
  return <p className={`text-xs text-fg-subtle ${source ? "px-3 pb-2" : "mt-1"}`}>… {note}</p>;
}

/** The body's content for a view that has one. */
function viewBody(view: PreviewView): ReactNode {
  switch (view.kind) {
    case "loading":
      return <SkeletonList rows={6} />;
    case "error":
      return <p className="text-sm text-tone-danger-fg">{view.message}</p>;
    case "image":
      return (
        <ZoomableImage
          key={view.reloadKey}
          src={view.src}
          alt={view.alt}
          className="max-w-full rounded-md border border-line"
        />
      );
    case "pdf":
      return (
        <iframe
          key={view.reloadKey}
          src={view.src}
          title={view.title}
          className="h-full min-h-[60vh] w-full rounded-md border border-line"
        />
      );
    case "embed":
      return view.node;
    case "markdown":
      return (
        <>
          <Prose
            text={view.text}
            className="text-base leading-relaxed text-fg"
            components={view.components}
          />
          <TruncatedNote note={view.truncatedNote} source={false} />
        </>
      );
    case "source":
      return (
        <>
          <CodeSurface
            language={view.language}
            code={view.code}
            highlight
            lineNumbers
            wrap={view.wrap}
            className="text-xs leading-relaxed"
          />
          <TruncatedNote note={view.truncatedNote} source />
        </>
      );
    case "unsupported":
      return <p className="text-sm text-fg-muted">{view.message}</p>;
    default:
      return null;
  }
}

export function PreviewPane({
  view,
  actions,
  editor,
  menu,
  bodyRef,
  bodyProps,
  className = "",
}: PreviewPaneProps) {
  const pill = given(actions) && (
    <div className="absolute right-4 top-2.5 z-10 flex items-center gap-1 rounded-md border border-line bg-surface p-1 shadow-sm">
      {actions}
    </div>
  );

  let content: ReactNode;
  if (view.kind === "empty") {
    content = <EmptyState title={view.title} action={view.action} />;
  } else if (view.kind === "opening") {
    content = <SkeletonList rows={6} />;
  } else if (given(editor)) {
    content = (
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">{editor}</div>
        {pill}
      </div>
    );
  } else {
    content = (
      <>
        {/* The pill's containing block. A positioned ancestor is required here and not
            optional: an absolute box inside a `static` scroller escapes to the initial
            containing block and gives the whole shell a second scrollbar. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* scrollbar-gutter: an SVG carries no pixel size, so its height is whatever its width
              divides to — which makes the content height a function of the scrollbar's
              presence. Without a reserved gutter that closes a loop: content overflows ->
              scrollbar takes width -> the image shrinks -> content fits -> scrollbar goes ->
              repeat, forever, as a visible shake. Reserving it always breaks the feedback path
              (and is inert where scrollbars are overlays). The source view brings its own
              padding, and has to: the editor's textarea lies on top of it, and only padding the
              two layers share keeps the typed text over the highlighted text. */}
          <div
            {...bodyProps}
            ref={bodyRef}
            tabIndex={-1}
            className={`min-h-0 flex-1 overflow-auto outline-none [scrollbar-gutter:stable] ${
              view.kind === "source" ? "" : "p-3"
            }`}
          >
            {viewBody(view)}
          </div>
          {pill}
        </div>
        {menu}
      </>
    );
  }

  return <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${className}`}>{content}</div>;
}

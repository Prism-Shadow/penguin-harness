/**
 * The file panel beside a proposal: one file of the scope or the tests, read-only, served by the
 * company-proposals plugin from the organization's own server (`GET …/:number/file`) and
 * confined there to the proposal's base. The page never navigates for it — the panel sits to the
 * right of the proposal on a wide window (a drag divider between them) and covers the page as a
 * full-height sheet on a narrow one.
 *
 * A row with a name pattern marks every line the pattern matches — the line gets a wash and the
 * first capture group (or the whole match) is painted with the CSS Custom Highlight API, which
 * leaves the highlighter's markup untouched — and the code scrolls to the first match.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { ProposalFileResponse } from "@prismshadow/penguin-server/api";
import {
  Button,
  CloseIcon,
  CodeSurface,
  CopyButton,
  SkeletonList,
  isTopEscLayer,
  languageForExtension,
  popEscLayer,
  pushEscLayer,
  usePointerDrag,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { matchingLines } from "./proposals-model";
import type { ProposalFileRef } from "./proposals-model";

/** The panel never gets narrower than this, and leaves the proposal at least as much. */
export const FILE_PANEL_MIN_PX = 360;
/** The Custom Highlight registry name `styles.css` paints (`::highlight(proposal-match)`). */
const MATCH_HIGHLIGHT = "proposal-match";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; file: ProposalFileResponse };

/**
 * The drag divider and the panel's width. `null` width = the default share (45% of the row);
 * a drag sets pixels, clamped so neither side drops under FILE_PANEL_MIN_PX.
 */
export function useFilePanelWidth(rowRef: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const dividerProps = usePointerDrag<object>({
    threshold: 0,
    begin: (event) => {
      event.preventDefault(); // no text selection while dragging the boundary
      setResizing(true);
      return {};
    },
    onMove: (event) => {
      const row = rowRef.current?.getBoundingClientRect();
      if (!row) return;
      const max = Math.max(FILE_PANEL_MIN_PX, row.width - FILE_PANEL_MIN_PX);
      setWidth(Math.min(max, Math.max(FILE_PANEL_MIN_PX, row.right - event.clientX)));
    },
    onEnd: () => setResizing(false),
    onCancel: () => setResizing(false),
  });
  const style = {
    "--proposal-file-w": width === null ? "45%" : `${width}px`,
  } as CSSProperties;
  return { style, resizing, dividerProps };
}

export function ProposalFilePanel({
  projectId,
  orgId,
  number,
  target,
  onClose,
}: {
  projectId: string;
  orgId: string;
  number: number;
  target: ProposalFileRef;
  onClose: () => void;
}) {
  const t = S.company.proposals.filePanel;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const codeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    setLoad({ state: "loading" });
    api
      .getOrgProposalFile(projectId, orgId, number, target.file)
      .then((file) => alive && setLoad({ state: "ready", file }))
      .catch((e: unknown) => alive && setLoad({ state: "error", message: apiErrorText(e) }));
    return () => {
      alive = false;
    };
  }, [projectId, orgId, number, target.file]);

  // Esc closes the panel — only when nothing above it (a dialog, a menu) owns the key, and not
  // from inside a text field, whose own Esc (cancel a comment) comes first.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const layer = pushEscLayer();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || !isTopEscLayer(layer)) return;
      const el = event.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable='true']")) return;
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      popEscLayer(layer);
    };
  }, []);

  const content = load.state === "ready" ? load.file.content : null;
  const matches = useMemo(
    () =>
      content === null || target.name === undefined ? null : matchingLines(content, target.name),
    [content, target.name],
  );

  // Mark the matched lines on whatever the surface rendered — the plain fallback first, then
  // the highlighted markup that replaces it — and scroll to the first match once.
  useEffect(() => {
    const host = codeRef.current;
    if (host === null || matches === null || matches.length === 0) return;
    let scrolled = false;
    const apply = () => {
      const lines = host.querySelectorAll<HTMLElement>(".line");
      if (lines.length === 0) return;
      const ranges: Range[] = [];
      for (const m of matches) {
        const el = lines[m.line];
        if (el === undefined) continue;
        el.dataset.match = "";
        const range = textRange(el, m.start, m.end);
        if (range !== null) ranges.push(range);
      }
      paintMatches(ranges);
      if (!scrolled) {
        lines[matches[0]!.line]?.scrollIntoView({ block: "center" });
        scrolled = true;
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(host, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      paintMatches([]);
      // The surface reuses its line elements for the next file; the marks must not carry over.
      for (const el of host.querySelectorAll<HTMLElement>(".line[data-match]")) {
        delete el.dataset.match;
      }
    };
  }, [matches]);

  const name = target.file.split("/").at(-1) ?? target.file;
  return (
    <aside
      aria-label={`${t.label}: ${target.file}`}
      className="flex h-full min-h-0 flex-col bg-white dark:bg-gray-950"
    >
      <header className="flex items-start gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-800">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 font-mono text-sm" data-tooltip={target.file}>
            {/* The directory gives way first, so the file name always shows. */}
            <span className="min-w-0 truncate text-gray-400 dark:text-gray-500">
              {target.file.slice(0, target.file.length - name.length)}
            </span>
            <span className="shrink-0 font-medium">{name}</span>
          </div>
          {target.name !== undefined && (
            <div className="mt-0.5 font-mono text-xs break-all text-gray-500 dark:text-gray-400">
              {target.name}
              {matches !== null && matches.length > 0 && (
                <span className="ml-2 font-sans break-normal whitespace-nowrap">
                  {t.matches(matches.length)}
                </span>
              )}
            </div>
          )}
        </div>
        <CopyButton text={target.file} label={t.copyPath} />
        <Button size="icon" variant="ghost" title={t.close} aria-label={t.close} onClick={onClose}>
          <CloseIcon />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {load.state === "loading" ? (
          <div className="p-3">
            <SkeletonList rows={8} />
          </div>
        ) : load.state === "error" ? (
          <p className="p-3 text-sm text-gray-500 dark:text-gray-400">
            {t.loadFailed}: {load.message}
          </p>
        ) : load.file.content === null ? (
          <p className="p-3 text-sm text-gray-500 dark:text-gray-400">{t.binary}</p>
        ) : (
          <>
            {target.name !== undefined && (matches === null || matches.length === 0) && (
              <p className="px-3 pt-2 text-xs text-gray-400 dark:text-gray-500">{t.noMatch}</p>
            )}
            <div ref={codeRef} className="proposal-file py-2">
              <CodeSurface
                language={languageForExtension(load.file.extension)}
                code={load.file.content}
                lineNumbers
                wrap
                className="text-xs leading-relaxed"
              />
            </div>
            {load.file.truncated && (
              <p className="px-3 pb-2 text-xs text-gray-400 dark:text-gray-500">… {t.truncated}</p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

/** A Range over `[start, end)` of an element's text, walking its text nodes; null past its end or when empty. */
function textRange(el: HTMLElement, start: number, end: number): Range | null {
  if (end <= start) return null;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let started = false;
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    const length = node.textContent?.length ?? 0;
    if (!started && start < offset + length) {
      range.setStart(node, start - offset);
      started = true;
    }
    if (started && end <= offset + length) {
      range.setEnd(node, end - offset);
      return range;
    }
    offset += length;
  }
  return null;
}

/** Paint the spans through the Custom Highlight registry where the browser has one; the line wash stands alone where not. */
function paintMatches(ranges: Range[]): void {
  const registry = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
  const Ctor = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (registry === undefined || Ctor === undefined) return;
  if (ranges.length === 0) registry.delete(MATCH_HIGHLIGHT);
  else registry.set(MATCH_HIGHLIGHT, new Ctor(...ranges));
}

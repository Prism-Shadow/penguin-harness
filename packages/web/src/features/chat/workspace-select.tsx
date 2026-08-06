/**
 * Workspace picker, extracted from draft-view.tsx so the Project settings dialog's
 * "new chat defaults" section can offer the same dir-browser popover the chat draft uses.
 * Two trigger variants, one menu:
 * - "pill" (default): the draft page's pill trigger with viewport-docked in-flow menu —
 *   moved verbatim, unchanged markup/classes/behavior;
 * - "form": a full-width trigger styled like the dialog's Input/Select (controlBase +
 *   the sm size tier), with the SAME menu portaled to body — a dialog's overflow-y-auto
 *   content area would clip an in-flow panel, and the portal tier (z-[60]) clears the
 *   Modal overlay.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { DirListResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { Chevron } from "../../components/ui/chevron";
import { Dropdown } from "../../components/ui/dropdown";
import { controlBase } from "../../components/ui/field";
import { ChevronDown } from "../../components/ui/icons";
import { noAutofill, sizeClass } from "../../components/ui/input";
import { toastError } from "../../components/ui/toast";

/** Shared style for pill trigger buttons (ChatGPT project button style: small rounded pill + icon + short name + collapse arrow). */
export const pillClass =
  "flex max-w-64 items-center gap-1.5 rounded-full border border-gray-300 bg-white py-1 pl-1.5 pr-2 " +
  "text-xs text-gray-600 transition-colors duration-150 hover:bg-gray-50 hover:text-gray-900 " +
  "dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100";

/**
 * Workspace selection (pill dropdown): the button shows the selected directory name (empty =
 * auto temporary directory). The menu browses server-side directories: **the current path can be
 * edited directly** at the top (Enter/blur commits it, an invalid directory toasts and reverts
 * to the previous path), the list omits hidden directories, and the hint text sits at the bottom
 * of the menu; only loads on first expand. On narrow screens the menu docks to whichever side
 * of the pill keeps it inside the viewport (measured on open — see menuDock).
 */
export function WorkspaceSelect({
  projectId,
  workspace,
  onChange,
  variant = "pill",
}: {
  projectId: string;
  workspace: string;
  onChange: (path: string) => void;
  /** Trigger style: the draft page's pill (default), or a dialog form control (see the header comment). */
  variant?: "pill" | "form";
}) {
  const [open, setOpen] = useState(false);
  /**
   * Menu docking, measured on each open: the pill follows the agent pill in a wrapping row, so
   * its left offset varies with the agent's name — a statically left-anchored 20rem panel can
   * cross the viewport's right edge on phones (measured ~143px past a 390px viewport). Keep the
   * desktop left anchoring whenever the panel fits; otherwise dock to whichever side of the
   * pill has more room, capping the width to that room via menuStyle. On desktop the panel
   * always fits, so nothing changes there.
   */
  const [menuDock, setMenuDock] = useState<{ right: boolean; maxWidth?: number }>({
    right: false,
  });
  const browsedRef = useRef(false);

  const [dir, setDir] = useState<DirListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Edit draft for the path row: synced with the browsing position, reverts on a failed commit. */
  const [pathDraft, setPathDraft] = useState("");

  useEffect(() => {
    setPathDraft(dir?.path ?? "");
  }, [dir]);

  /**
   * Monotonic id of the newest loadDir request. Only the newest request may publish its
   * result: navigations race (rows stay visible while a fetch is in flight, and the path row
   * accepts commits at any time), and without the guard a slow older response would overwrite
   * a newer one — silently relocating the browsing position — or clear `loading` while the
   * newer request is still in flight.
   */
  const loadSeq = useRef(0);

  /**
   * Browses level by level (clicking a directory/parent); an empty string means the server's
   * home directory (the default starting point). `onError` overrides the default error-row
   * handling (the path-edit commit toasts and reverts instead); it only ever fires for the
   * newest request, like every other outcome.
   */
  const loadDir = useCallback(
    (abs: string, opts?: { onError?: () => void }) => {
      const seq = ++loadSeq.current;
      setLoading(true);
      setError(null);
      api
        .listDirs(projectId, abs)
        .then((res) => {
          if (seq === loadSeq.current) setDir(res);
        })
        .catch((e: unknown) => {
          if (seq !== loadSeq.current) return;
          if (opts?.onError) opts.onError();
          else setError(apiErrorText(e));
        })
        .finally(() => {
          if (seq === loadSeq.current) setLoading(false);
        });
    },
    [projectId],
  );

  const toggle = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const next = !open;
    // The dock measurement steers the in-flow (pill) panel only; the form variant portals,
    // and Dropdown's own viewport clamping takes over.
    if (next && variant === "pill") {
      const r = e.currentTarget.getBoundingClientRect();
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const margin = 12; // breathing room against the viewport edge
      // The panel's effective width: w-80 capped by its max-w-[calc(100vw-2rem)] class
      // (rem-derived — the root font size is not 16px here).
      const width = Math.min(20 * rem, window.innerWidth - 2 * rem);
      const roomRight = window.innerWidth - margin - r.left; // room for a left-anchored panel
      const roomLeft = r.right - margin; // room for a right-anchored panel
      if (roomRight >= width) setMenuDock({ right: false });
      else if (roomLeft > roomRight)
        setMenuDock({ right: true, ...(roomLeft < width ? { maxWidth: roomLeft } : {}) });
      else setMenuDock({ right: false, maxWidth: roomRight });
    }
    setOpen(next);
    // Only loads on first expand: an already-filled absolute path is used as the starting point, otherwise the server falls back to the home directory.
    if (next && !browsedRef.current) {
      browsedRef.current = true;
      const ws = workspace.trim();
      loadDir(ws.startsWith("/") ? ws : "");
    }
  };

  /**
   * Commits the edited path: navigates to it if it exists, otherwise toasts and reverts to
   * the current browsing position. Routed through loadDir so the commit shows the loading
   * row and participates in the same request sequencing as row clicks — a raw listDirs here
   * used to race them and could land after (and clobber) a newer navigation.
   */
  const commitPathEdit = () => {
    const p = pathDraft.trim();
    if (!p || p === dir?.path) {
      setPathDraft(dir?.path ?? "");
      return;
    }
    loadDir(p, {
      onError: () => {
        toastError(S.chat.workspaceDirInvalid);
        setPathDraft(dir?.path ?? "");
      },
    });
  };

  const trimmed = workspace.trim();
  // Pill short name: the last segment of the directory name (root gives "/"); shows "auto temp directory" when empty.
  const label = trimmed ? (trimmed.split("/").filter(Boolean).pop() ?? "/") : S.chat.workspaceAuto;
  const parentPath = dir?.parent ?? null;
  // Hidden directories (starting with .) are excluded from the list.
  const entries = (dir?.entries ?? []).filter((e) => !e.name.startsWith("."));
  /** Folder glyph shared by both triggers. */
  const folderIcon = (extraClass: string) => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      className={`shrink-0 text-gray-400 ${extraClass}`}
      aria-hidden
    >
      <path
        d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      {...(variant === "form"
        ? // Portaled menu (size classes only; placement is measured from the trigger).
          { menuClass: "w-80", portal: { direction: "down" as const, align: "left" as const } }
        : {
            menuClass: `top-full mt-1 w-80 max-w-[calc(100vw-2rem)] ${
              menuDock.right ? "right-0 origin-top-right" : "left-0 origin-top-left"
            }`,
            ...(menuDock.maxWidth !== undefined
              ? { menuStyle: { maxWidth: menuDock.maxWidth } }
              : {}),
          })}
      button={
        variant === "form" ? (
          // Dialog form control: full width, same border/height/typography as Input/Select (sm tier).
          <button
            type="button"
            title={trimmed ? `${S.chat.workspace}：${trimmed}` : S.chat.workspaceHint}
            aria-label={S.chat.workspace}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={toggle}
            className={`flex w-full items-center gap-2 text-left ${controlBase} ${sizeClass.sm}`}
          >
            {folderIcon("")}
            <span className={`min-w-0 flex-1 truncate ${trimmed ? "font-mono" : ""}`}>{label}</span>
            <ChevronDown className="text-gray-400" />
          </button>
        ) : (
          <button
            type="button"
            title={trimmed ? `${S.chat.workspace}：${trimmed}` : S.chat.workspaceHint}
            aria-label={S.chat.workspace}
            onClick={toggle}
            className={pillClass}
          >
            {folderIcon("ml-0.5")}
            <span className={`min-w-0 truncate ${trimmed ? "font-mono" : ""}`}>{label}</span>
            <Chevron open={open} size={12} className="shrink-0 text-gray-400" />
          </button>
        )
      }
    >
      <div className="space-y-1.5 px-2.5 pb-2.5 pt-2">
        <div className="rounded-md border border-gray-200 dark:border-gray-800">
          {/* Current path (editable: Enter/blur commits, Escape discards) + "Use this directory" (closes the menu once selected) */}
          <div className="flex items-center gap-1.5 border-b border-gray-100 px-1.5 py-1 dark:border-gray-800">
            <input
              value={pathDraft}
              placeholder="…"
              aria-label={S.chat.workspace}
              {...noAutofill}
              onChange={(e) => setPathDraft(e.target.value)}
              onBlur={commitPathEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  commitPathEdit();
                } else if (e.key === "Escape") {
                  // Discard the edit: only reverts the draft; Escape bubbles up to Dropdown, which closes the menu.
                  setPathDraft(dir?.path ?? "");
                }
              }}
              className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-xs text-gray-600 focus:border-gray-300 focus:outline-none dark:text-gray-300 dark:focus:border-gray-600"
            />
            <button
              type="button"
              disabled={!dir}
              onClick={() => {
                if (!dir) return;
                onChange(dir.path);
                setOpen(false);
              }}
              className="shrink-0 rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-700 transition-colors duration-150 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {S.chat.workspaceUseThis}
            </button>
          </div>
          {/* Directory list (excludes hidden directories) */}
          <ul className="max-h-40 overflow-y-auto py-1">
            {/* Rows are disabled while a load is in flight: they still show the PREVIOUS
                directory until the response lands, so clicks during the window would resend
                stale targets (N clicks on "parent" all resending the same dir.parent). */}
            {parentPath !== null && (
              <li>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => loadDir(parentPath)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  ↰ {S.chat.workspaceUp}
                </button>
              </li>
            )}
            {entries.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => loadDir(entry.path)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-xs text-gray-700 transition-colors duration-150 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    className="shrink-0 text-gray-400"
                    aria-hidden
                  >
                    <path
                      d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                </button>
              </li>
            ))}
            {dir && entries.length === 0 && (
              <li className="px-2.5 py-1.5 text-xs text-gray-400">{S.chat.workspaceNoSubdirs}</li>
            )}
            {loading && <li className="px-2.5 py-1.5 text-xs text-gray-400">{S.common.loading}</li>}
            {/* Load failure (e.g. the cached starting directory was deleted): provide "retry" to fall back to the home directory, avoiding getting stuck in an error state. */}
            {error && (
              <li className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs text-red-500">
                <span className="min-w-0 flex-1 truncate" title={error}>
                  {error}
                </span>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => loadDir("")}
                  className="shrink-0 rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-700 transition-colors duration-150 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {S.common.retry}
                </button>
              </li>
            )}
          </ul>
        </div>
        {/* When a directory has been specified, offer a one-click way back to the auto temp directory */}
        {trimmed && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className="text-xs text-gray-500 underline decoration-gray-300 underline-offset-2 transition-colors duration-150 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {S.chat.workspaceClear}
          </button>
        )}
        {/* Hint text (bottom of the menu) */}
        <p className="px-0.5 text-xs leading-5 text-gray-400 dark:text-gray-500">
          {S.chat.workspaceHint}
        </p>
      </div>
    </Dropdown>
  );
}

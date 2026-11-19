import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import {
  GlyphIcon,
  IconButton,
  ICONS,
  ICON_SIZE,
  useEscLayer,
  useWindowShown,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { folderPanelId, folderTriggerId } from "./app-tile";
import type { GridFolder } from "./arrangement";
import "./folder-panel.css";

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, max));

/** Keep the expanded surface around its folder icon and inside the visible part of the grid.
 * The home grid stays laid out, so neither a last-row folder nor a long folder moves the page.
 * Each visible preview and its full-size icon have their own shared endpoints. */
function place(panel: HTMLElement, trigger: HTMLElement) {
  const area = panel.parentElement!.getBoundingClientRect();
  const viewport = panel.closest("[data-app-center-scroll]")!.getBoundingClientRect();
  const preview = trigger.querySelector<HTMLElement>("[data-folder-icon]")!;
  const origin = preview.getBoundingClientRect();
  const top = Math.max(area.top, viewport.top + 8);
  const bottom = viewport.bottom - 8;
  panel.style.maxHeight = `${Math.max(0, bottom - top)}px`;
  const x = clamp(
    origin.left + origin.width / 2 - panel.offsetWidth / 2,
    area.left,
    area.right - panel.offsetWidth,
  );
  const y = clamp(origin.top - 12, top, bottom - panel.offsetHeight);
  panel.style.left = `${x - area.left}px`;
  panel.style.top = `${y - area.top}px`;
  const box = panel.getBoundingClientRect();
  panel.style.setProperty(
    "--folder-preview-clip",
    `inset(${origin.top - box.top}px ${box.right - origin.right}px ${box.bottom - origin.bottom}px ${origin.left - box.left}px round ${getComputedStyle(preview).borderTopLeftRadius || "0px"})`,
  );
  const miniatures = new Map(
    Array.from(preview.querySelectorAll<HTMLElement>("[data-preview-app]"), (mini) => [
      mini.dataset.previewApp,
      mini.getBoundingClientRect(),
    ]),
  );
  for (const tile of panel.querySelectorAll<HTMLElement>("[data-app]")) {
    const mini = miniatures.get(tile.dataset.app);
    const icon = tile.querySelector<HTMLElement>("[data-app-icon]")!;
    icon.toggleAttribute("data-preview", !!mini);
    const dest = icon.getBoundingClientRect();
    if (mini && dest.width)
      icon.style.setProperty(
        "--folder-icon-transform",
        `translate(${mini.left - dest.left}px,${mini.top - dest.top}px) scale(${mini.width / dest.width})`,
      );
  }
}

export function FolderPanel({
  folder,
  open,
  onClose,
  onExited,
  draggingOut,
  onTakeOut,
  children,
}: {
  folder: GridFolder;
  open: boolean;
  onClose: () => void;
  onExited: () => void;
  draggingOut: boolean;
  onTakeOut: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  const shown = useWindowShown();
  const trigger = () => document.getElementById(folderTriggerId(folder.id));
  const events = useRef({ onClose, onExited, onTakeOut });
  useLayoutEffect(() => {
    events.current = { onClose, onExited, onTakeOut };
  });

  useLayoutEffect(() => {
    const root = panel.current!;
    const button = trigger();
    if (!button) return;
    button.setAttribute("data-folder-origin", "");
    const position = () => place(root, button);
    position();
    // Establish the collapsed clip and every translated icon before enabling transitions. A
    // style read on the panel alone can leave the last thumbnail at its unmeasured position.
    if (!root.hasAttribute("data-ready")) {
      getComputedStyle(root).clipPath;
      for (const image of root.querySelectorAll("[data-app-icon] > span:first-child"))
        getComputedStyle(image).transform;
      root.setAttribute("data-ready", "");
    }
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    observer?.observe(root.parentElement!);
    observer?.observe(root);
    observer?.observe(root.closest("[data-app-center-scroll]")!);
    return () => {
      observer?.disconnect();
      button.removeAttribute("data-folder-origin");
    };
  }, [folder, shown]);

  useLayoutEffect(() => {
    const root = panel.current!;
    root.toggleAttribute("data-open", open);
    if (open) {
      if (shown) root.focus({ preventScroll: true });
      return;
    }
    if (root.contains(document.activeElement) || document.activeElement === document.body)
      trigger()?.focus({ preventScroll: true });
    let current = true;
    // No running CSS transition in reduced motion (or if the user left before first paint).
    const transitions = root.getAnimations?.() ?? [];
    void Promise.allSettled(transitions.map((transition) => transition.finished)).then(() => {
      if (current) events.current.onExited();
    });
    return () => {
      current = false;
    };
  }, [open, shown]);

  const goBack = () => {
    trigger()?.focus({ preventScroll: true });
    events.current.onClose();
  };
  useEscLayer(open && shown, goBack);

  useEffect(() => {
    if (!open || !shown) return;
    let dismissed = false;
    const dismiss = (event: PointerEvent | FocusEvent) => {
      const node = event.target;
      if (
        !panel.current ||
        !(node instanceof Element) ||
        panel.current.contains(node) ||
        trigger()?.contains(node)
      )
        return;
      // Tile menus and their associated dialogs use the shared portal.
      if (dismissed || node.closest('[role="menu"], [role="dialog"], [data-folder]')) return;
      dismissed = true;
      events.current.onClose();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
    };
  }, [open, shown, folder.id]);

  useEffect(() => {
    if (!draggingOut) return;
    const outside = (event: DragEvent) => {
      if (panel.current?.contains(event.target as Node)) return;
      // Capture before a home tile can interpret this as a drop into another folder.
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      if (event.type === "drop") events.current.onTakeOut();
    };
    window.addEventListener("dragover", outside, true);
    window.addEventListener("drop", outside, true);
    return () => {
      window.removeEventListener("dragover", outside, true);
      window.removeEventListener("drop", outside, true);
    };
  }, [draggingOut]);

  const id = folderPanelId(folder.id);
  return (
    <section
      ref={panel}
      id={id}
      aria-labelledby={`${id}-title`}
      inert={!open}
      tabIndex={-1}
      data-context-menu
      onDragOver={(event) => event.stopPropagation()}
      onDrop={(event) => event.stopPropagation()}
      data-clip-surface
      data-layout-motion="shared-bounds"
      className="app-center-folder absolute z-raised flex w-full max-w-sm flex-col rounded-xl border border-line bg-surface shadow-lg outline-none"
    >
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        <header className="sticky top-0 z-raised flex items-center gap-2 bg-surface px-3 pt-3">
          <IconButton label={S.appCenter.menu.back} variant="ghost" size="sm" onClick={goBack}>
            <GlyphIcon d={ICONS.arrowLeftCentered} size={ICON_SIZE.iconButton} />
          </IconButton>
          <h2 id={`${id}-title`} className="truncate font-semibold text-fg">
            {folder.name}
          </h2>
        </header>
        <ul aria-label={folder.name} className="grid grid-cols-3 gap-1 p-2 sm:gap-2 sm:p-3">
          {children}
        </ul>
      </div>
    </section>
  );
}

/**
 * The app's command palette: which actions exist, the shortcut that opens it, and its words.
 * Mounted once in AppLayout. The UI package's CommandPalette is the mechanism; this file is the
 * registry: an action here, never a new global shortcut. An action opens an overlay over the
 * current page rather than navigating — closing it leaves the user exactly where they were.
 */
import { useEffect, useMemo, useState } from "react";
import { CommandPalette } from "@prismshadow/penguin-ui";
import type { PaletteAction } from "@prismshadow/penguin-ui";
import { isCommandPaletteShortcut } from "../../lib/command-palette";
import { S } from "../../lib/strings";
import { HarnessHistoryOverlay } from "../harness/harness-history-overlay";

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}

/** A mount point with nothing to add shares one empty list, so the action memo stays put. */
const NO_EXTRA: readonly PaletteAction[] = [];

/**
 * `extra` is what the mount point adds ahead of the standing actions — the full-page
 * workflow route registers its way out here, which is why it exists at all on that route.
 */
export function AppPalette({ extra = NO_EXTRA }: { extra?: readonly PaletteAction[] }) {
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Global shortcut, registered once (a functional update reads the latest `open`).
  // preventDefault on every match — otherwise the browser's print dialog opens underneath.
  useEffect(() => {
    const isMac = isMacPlatform();
    const onKey = (e: KeyboardEvent) => {
      if (!isCommandPaletteShortcut(e, isMac)) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const actions = useMemo<PaletteAction[]>(
    () => [
      ...extra,
      {
        id: "harness-history",
        label: S.commandPalette.harnessHistory,
        keywords: ["harness history", "version", "hmr", "ifaces"],
        run: () => setHistoryOpen(true),
      },
    ],
    [extra],
  );
  return (
    <>
      <CommandPalette
        open={open}
        onClose={() => setOpen(false)}
        actions={actions}
        title={S.commandPalette.title}
        placeholder={S.commandPalette.placeholder}
        emptyText={S.commandPalette.noResults}
        hint={S.commandPalette.hint}
      />
      <HarnessHistoryOverlay open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  );
}

/**
 * The app's command palette and its actions. Mounted once in AppLayout; the palette is
 * the mechanism, this file is the registry: an action here, never a new global shortcut.
 * An action opens an overlay over the current page rather than navigating — closing it
 * leaves the user exactly where they were.
 */
import { useMemo, useState } from "react";
import type { PaletteAction } from "../../lib/command-palette";
import { S } from "../../lib/strings";
import { HarnessHistoryOverlay } from "../harness/harness-history-overlay";
import { CommandPalette } from "./command-palette";

/**
 * `extra` is what the mount point adds ahead of the standing actions — the full-page
 * workflow route registers its way out here, which is why it exists at all on that route.
 */
export function AppPalette({ extra = [] }: { extra?: readonly PaletteAction[] }) {
  const [historyOpen, setHistoryOpen] = useState(false);
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
      <CommandPalette actions={actions} />
      <HarnessHistoryOverlay open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  );
}

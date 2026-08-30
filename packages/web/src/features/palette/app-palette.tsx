/**
 * The app's command palette and its actions. Mounted once in AppLayout; the palette is
 * the mechanism, this file is the registry: an action here, never a new global shortcut.
 */
import { useMemo, useState } from "react";
import type { PaletteAction } from "../../lib/command-palette";
import { S } from "../../lib/strings";
import { CommandPalette } from "./command-palette";
import { HarnessHistoryDialog } from "./harness-history";

export function AppPalette() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const actions = useMemo<PaletteAction[]>(
    () => [
      {
        id: "harness-history",
        label: S.commandPalette.harnessHistory,
        keywords: ["harness history", "version", "hmr"],
        run: () => setHistoryOpen(true),
      },
    ],
    [],
  );
  return (
    <>
      <CommandPalette actions={actions} />
      <HarnessHistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  );
}

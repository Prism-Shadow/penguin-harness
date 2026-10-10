/**
 * The app's command palette: which actions exist, the shortcut that opens it (the
 * `palette.toggle` command, ⌥⌘P / Ctrl+Alt+P by default), and its words. Mounted once in
 * AppLayout. The UI package's CommandPalette is the mechanism; this file is the registry: an
 * action here, never a new global shortcut. An action opens an overlay over the current page
 * rather than navigating — closing it leaves the user exactly where they were.
 */
import { useEffect, useMemo, useState } from "react";
import { CommandPalette } from "@prismshadow/penguin-ui";
import type { PaletteAction } from "@prismshadow/penguin-ui";
import { onCommand } from "../../lib/shortcuts/dispatcher";
import { useShortcutLabel } from "../../lib/shortcuts/use-keymap";
import { S } from "../../lib/strings";
import { HarnessHistoryOverlay } from "../harness/harness-history-overlay";

/** A mount point with nothing to add shares one empty list, so the action memo stays put. */
const NO_EXTRA: readonly PaletteAction[] = [];

/**
 * `extra` is what the mount point adds ahead of the standing actions — the full-page
 * workflow route registers its way out here, which is why it exists at all on that route.
 */
export function AppPalette({ extra = NO_EXTRA }: { extra?: readonly PaletteAction[] }) {
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // The chord is the keymap's (lib/shortcuts): the window dispatcher matches it, calls this
  // handler and prevents the browser default once it is handled. A functional update reads
  // the latest `open`, so the handler registers once.
  useEffect(
    () =>
      onCommand("palette.toggle", () => {
        setOpen((o) => !o);
      }),
    [],
  );
  const toggleShortcut = useShortcutLabel("palette.toggle");

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
        hint={S.commandPalette.hint(toggleShortcut)}
      />
      <HarnessHistoryOverlay open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  );
}

/**
 * The app-root mount point for the developer tooling pair: the Ctrl+P command palette
 * (the only global shortcut) and the developer console it can open. Action registry
 * lives here — future capabilities (e.g. workflow operations) add an entry instead of
 * claiming another shortcut.
 */
import { useMemo, useState } from "react";
import { CommandPalette } from "./command-palette";
import type { PaletteAction } from "./command-palette";
import { DevConsole } from "./dev-console";
import { S } from "../../lib/strings";

export function DevTools() {
  const [consoleOpen, setConsoleOpen] = useState(false);

  const actions = useMemo<PaletteAction[]>(
    () => [
      {
        id: "open-dev-console",
        label: S.commandPalette.openDevConsole,
        run: () => setConsoleOpen(true),
      },
      {
        id: "reload-page",
        label: S.commandPalette.reloadPage,
        run: () => window.location.reload(),
      },
    ],
    [],
  );

  return (
    <>
      <CommandPalette actions={actions} />
      <DevConsole open={consoleOpen} onClose={() => setConsoleOpen(false)} />
    </>
  );
}

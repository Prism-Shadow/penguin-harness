/**
 * The app's command palette and its actions. Mounted once in AppLayout; the palette is
 * the mechanism, this file is the registry: an action here, never a new global shortcut.
 */
import { useMemo } from "react";
import { useNavigate } from "react-router";
import type { PaletteAction } from "../../lib/command-palette";
import { S } from "../../lib/strings";
import { CommandPalette } from "./command-palette";

export function AppPalette() {
  const navigate = useNavigate();
  const actions = useMemo<PaletteAction[]>(
    () => [
      {
        id: "harness-history",
        label: S.commandPalette.harnessHistory,
        keywords: ["harness history", "version", "hmr", "ifaces"],
        run: () => void navigate("/harness/history"),
      },
    ],
    [navigate],
  );
  return <CommandPalette actions={actions} />;
}

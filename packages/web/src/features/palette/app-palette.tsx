/**
 * The app's command palette and its actions. Mounted once in AppLayout; the palette is
 * the mechanism, this file is the registry: an action here, never a new global shortcut.
 * An action opens an overlay over the current page rather than navigating — closing it
 * leaves the user exactly where they were.
 *
 * Under the desktop shell the palette also carries the shell's native actions — install
 * the bundled `penguin` command, check for a desktop update — which used to live only in
 * the application menu. The menu bar is hidden there (a lone Alt used to take the
 * keyboard), so the palette is where a person finds them. They exist only for the shell's
 * own window: a browser signed into the same server is not the machine they act on.
 */
import { useEffect, useMemo, useState } from "react";
import type { DesktopShellInfo } from "@prismshadow/penguin-server/api";
import type { PaletteAction } from "../../lib/command-palette";
import { S } from "../../lib/strings";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { useAuth } from "../../state/auth";
import { toastError, toastInfo } from "../../components/ui/toast";
import { HarnessHistoryOverlay } from "../harness/harness-history-overlay";
import { CommandPalette } from "./command-palette";

const REPO_URL = "https://github.com/Prism-Shadow/penguin-harness";

/**
 * `extra` is what the mount point adds ahead of the standing actions — the full-page
 * workflow route registers its way out here, which is why it exists at all on that route.
 */
export function AppPalette({ extra = [] }: { extra?: readonly PaletteAction[] }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const { sessionVia } = useAuth();
  const inShell = sessionVia === "desktop";
  const [shell, setShell] = useState<DesktopShellInfo | null>(null);
  useEffect(() => {
    if (!inShell) return;
    let cancelled = false;
    void api
      .getDesktopShell()
      .then((res) => {
        if (!cancelled) setShell(res.info);
      })
      .catch(() => {
        // A shell that has not pushed yet, or an older server: the actions simply stay out.
      });
    return () => {
      cancelled = true;
    };
  }, [inShell]);

  const actions = useMemo<PaletteAction[]>(() => {
    const desktop: PaletteAction[] = inShell
      ? [
          ...(shell?.cliInstall
            ? [
                {
                  id: "desktop-install-cli",
                  label: S.commandPalette.installCli,
                  keywords: ["penguin", "cli", "command", "install", "path"],
                  run: () => {
                    void api.desktopInstallCli().catch((err) => toastError(apiErrorText(err)));
                  },
                },
              ]
            : []),
          {
            id: "desktop-check-updates",
            label: S.commandPalette.checkUpdates,
            keywords: ["update", "upgrade", "version", "desktop"],
            run: () => {
              void api
                .desktopUpdateCheck()
                .then(() => toastInfo(S.commandPalette.checkingUpdates))
                .catch((err) => toastError(apiErrorText(err)));
            },
          },
        ]
      : [];
    return [
      ...extra,
      {
        id: "harness-history",
        label: S.commandPalette.harnessHistory,
        keywords: ["harness history", "version", "hmr", "ifaces"],
        run: () => setHistoryOpen(true),
      },
      ...desktop,
      {
        id: "project-on-github",
        label: S.commandPalette.projectOnGitHub,
        keywords: ["github", "repo", "source", "issue"],
        run: () => {
          window.open(REPO_URL, "_blank", "noopener");
        },
      },
    ];
  }, [extra, inShell, shell]);

  return (
    <>
      <CommandPalette actions={actions} />
      <HarnessHistoryOverlay open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  );
}

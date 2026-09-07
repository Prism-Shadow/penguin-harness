/**
 * The app's command palette and its actions. Mounted once in AppLayout; the palette is
 * the mechanism, this file is the registry: an action here, never a new global shortcut.
 * An action opens an overlay over the current page rather than navigating — closing it
 * leaves the user exactly where they were.
 *
 * The palette also carries the host's commands — what the process hosting the server can do
 * on the page's behalf. Under the desktop shell that is installing the bundled `penguin`
 * command, checking for a desktop update, and opening DevTools — all of them application-menu
 * items; the menu bar is hidden there (a lone Alt used to take the keyboard), so the palette
 * is where a person finds them. The server says which commands the host offers; a plain
 * server offers none, and a non-admin is told nothing.
 */
import { useEffect, useMemo, useState } from "react";
import type { HostCommand } from "@prismshadow/penguin-server/api";
import type { PaletteAction } from "../../lib/command-palette";
import { S } from "../../lib/strings";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { useAuth } from "../../state/auth";
import { toastError, toastInfo } from "../../components/ui/toast";
import { HarnessHistoryOverlay } from "../harness/harness-history-overlay";
import { CommandPalette } from "./command-palette";

const REPO_URL = "https://github.com/Prism-Shadow/penguin-harness";

/** One host command's words, and what to say once it is handed over. */
interface HostAction {
  label: () => string;
  keywords: string[];
  after?: () => string;
}

/** The palette action for each host command. */
const HOST_ACTIONS: Record<HostCommand, HostAction> = {
  "install-cli": {
    label: () => S.commandPalette.installCli,
    keywords: ["penguin", "cli", "command", "install", "path"],
  },
  "check-updates": {
    label: () => S.commandPalette.checkUpdates,
    keywords: ["update", "upgrade", "version", "desktop"],
    after: () => S.commandPalette.checkingUpdates,
  },
  "open-devtools": {
    label: () => S.commandPalette.openDevTools,
    // English words for a person hunting an error message, whichever language the app is in.
    keywords: ["devtools", "developer", "console", "inspect", "debug", "error"],
  },
};

/**
 * The commands to offer, paired with their words. A command this build has no words for is
 * SKIPPED — the host is a separate program on its own schedule (it reaches users through an
 * installer, the page through a hot push), so a shell newer than the page it serves is
 * ordinary, and `open-devtools` made it real. Reading its words unchecked was not ordinary:
 * the actions are built in a `useMemo`, and a throw there takes the whole App down to a
 * blank page — which is what a shell carrying this command did to a page that predated it.
 */
export function knownHostActions(
  commands: readonly HostCommand[],
): { command: HostCommand; action: HostAction }[] {
  return commands.flatMap((command) => {
    const action: HostAction | undefined = HOST_ACTIONS[command];
    return action === undefined ? [] : [{ command, action }];
  });
}

/**
 * `extra` is what the mount point adds ahead of the standing actions — the full-page
 * workflow route registers its way out here, which is why it exists at all on that route.
 */
export function AppPalette({ extra = [] }: { extra?: readonly PaletteAction[] }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const { user } = useAuth();
  const isAdmin = user?.isAdmin === true;
  const [commands, setCommands] = useState<HostCommand[]>([]);
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void api
      .getHostCommands()
      .then((res) => {
        if (!cancelled) setCommands(res.commands);
      })
      .catch(() => {
        // An older server without the route: the host's commands simply stay out.
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const actions = useMemo<PaletteAction[]>(
    () => [
      ...extra,
      {
        id: "harness-history",
        label: S.commandPalette.harnessHistory,
        keywords: ["harness history", "version", "hmr", "ifaces"],
        run: () => setHistoryOpen(true),
      },
      ...knownHostActions(commands).map(({ command, action }): PaletteAction => {
        return {
          id: `host-${command}`,
          label: action.label(),
          keywords: action.keywords,
          run: () => {
            void api
              .runHostCommand(command)
              .then(() => {
                if (action.after) toastInfo(action.after());
              })
              .catch((err) => toastError(apiErrorText(err)));
          },
        };
      }),
      {
        id: "project-on-github",
        label: S.commandPalette.projectOnGitHub,
        keywords: ["github", "repo", "source", "issue"],
        run: () => {
          window.open(REPO_URL, "_blank", "noopener");
        },
      },
    ],
    [extra, commands],
  );

  return (
    <>
      <CommandPalette actions={actions} />
      <HarnessHistoryOverlay open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  );
}

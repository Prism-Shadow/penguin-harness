/**
 * The app's command palette: which actions exist, the shortcut that opens it (the
 * `palette.toggle` command, ⌥⌘P / Ctrl+Alt+P by default), and its words. Mounted once in
 * AppLayout. The UI package's CommandPalette is the mechanism; this file is the registry: an
 * action here, never a new global shortcut. An action opens an overlay over the current page
 * rather than navigating — closing it leaves the user exactly where they were.
 *
 * The palette also carries the host's commands — what the process hosting the server can do
 * on the page's behalf. Under the desktop shell that is installing the bundled `penguin`
 * command and checking for a desktop update, which used to live only in the application
 * menu; the menu bar is hidden there (a lone Alt used to take the keyboard), so the palette
 * is where a person finds them. The server says which commands the host offers; a plain
 * server offers none, and a non-admin is told nothing.
 */
import { useEffect, useMemo, useState } from "react";
import type { HostCommand } from "@prismshadow/penguin-server/api";
import { CommandPalette, toastError, toastInfo } from "@prismshadow/penguin-ui";
import type { PaletteAction } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { offersNewWindow } from "../../lib/desktop-window";
import { onCommand } from "../../lib/shortcuts/dispatcher";
import { useShortcutLabel } from "../../lib/shortcuts/use-keymap";
import { S } from "../../lib/strings";
import { useAuth } from "../../state/auth";
import { HarnessHistoryOverlay } from "../harness/harness-history-overlay";

/** A mount point with nothing to add shares one empty list, so the action memo stays put. */
const NO_EXTRA: readonly PaletteAction[] = [];

const REPO_URL = "https://github.com/Prism-Shadow/penguin-harness";

/** The palette action for each host command: its words, and what to say once it is handed over. */
const HOST_ACTIONS: Record<
  HostCommand,
  { label: () => string; keywords: string[]; after?: () => string }
> = {
  "install-cli": {
    label: () => S.commandPalette.installCli,
    keywords: ["penguin", "cli", "command", "install", "path"],
  },
  "check-updates": {
    label: () => S.commandPalette.checkUpdates,
    keywords: ["update", "upgrade", "version", "desktop"],
    after: () => S.commandPalette.checkingUpdates,
  },
};

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

  const { desktopMode, sessionVia, user } = useAuth();
  const newWindow = offersNewWindow({ desktopMode, sessionVia });
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
      // The shell opens the window; the page only asks (see lib/desktop-window.ts).
      ...(newWindow
        ? [
            {
              id: "new-window",
              label: S.commandPalette.newWindow,
              keywords: ["new window", "open window", "second window"],
              run: () => {
                void api.openDesktopWindow().catch((err: unknown) => toastError(apiErrorText(err)));
              },
            },
          ]
        : []),
      {
        id: "harness-history",
        label: S.commandPalette.harnessHistory,
        keywords: ["harness history", "version", "hmr", "ifaces"],
        run: () => setHistoryOpen(true),
      },
      ...commands.map((command): PaletteAction => {
        const action = HOST_ACTIONS[command];
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
    [extra, commands, newWindow],
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

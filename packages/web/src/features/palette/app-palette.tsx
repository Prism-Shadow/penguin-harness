/**
 * The app's command palette: which actions exist, the shortcut that opens it (the
 * `palette.toggle` command, ⌥⌘P / Ctrl+Alt+P by default), and its words. Mounted once in
 * AppLayout. The UI package's CommandPalette is the mechanism; this file is the registry: an
 * action here, never a new global shortcut. An action opens an overlay over the current page
 * rather than navigating — closing it leaves the user exactly where they were.
 *
 * The palette also carries the host's commands — what the process hosting the server can do
 * on the page's behalf. Under the desktop shell that is installing the bundled `penguin`
 * command, checking for a desktop update, and opening DevTools — all of them application-menu
 * items; the menu bar is hidden there (a lone Alt used to take the keyboard), so the palette
 * is where a person finds them. The host says what it offers AND what to call it, so it can
 * offer something this build has never heard of; a plain server offers none, and a non-admin
 * is told nothing.
 */
import { useEffect, useMemo, useState } from "react";
import type { HostCommand, HostCommandOffer } from "@prismshadow/penguin-server/api";
import { CommandPalette, toastError, toastInfo } from "@prismshadow/penguin-ui";
import type { PaletteAction } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { offersNewWindow } from "../../lib/desktop-window";
import { onCommand } from "../../lib/shortcuts/dispatcher";
import { useShortcutLabel } from "../../lib/shortcuts/use-keymap";
import { S } from "../../lib/strings";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { HarnessHistoryOverlay } from "../harness/harness-history-overlay";

/** A mount point with nothing to add shares one empty list, so the action memo stays put. */
const NO_EXTRA: readonly PaletteAction[] = [];

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
 * What the palette shows for the host's commands.
 *
 * The host is a separate program on its own schedule — it reaches users through an installer,
 * this page through a hot push — so a host offering a command this build has never heard of
 * is the ordinary case, not the exception. It is therefore RENDERED, in the words the host
 * sent with it. A list of ids alone would have made the whole exchange pointless: the host
 * could never offer anything the page did not already carry, and reading words the page did
 * not have threw inside the actions `useMemo`, which blanked the App.
 *
 * A command this build DOES know keeps this file's words: they are translated properly and
 * carry search terms, and the page can improve them without waiting for an installer. The
 * host's words are the floor, not an instruction.
 *
 * An offer with no words at all — an older host, which sends bare ids — is shown only if this
 * build knows it. Such a host has nothing else to offer.
 */
export function hostCommandActions(
  offers: readonly HostCommandOffer[],
  locale: "en" | "zh",
): { command: string; action: HostAction }[] {
  return offers.flatMap(({ command, label, labelZh }) => {
    const known: HostAction | undefined = HOST_ACTIONS[command as HostCommand];
    if (known !== undefined) return [{ command, action: known }];
    const words = (locale === "zh" ? labelZh : label) || label || labelZh;
    if (words === "") return [];
    // The id doubles as search terms: "open-devtools" finds it typed either way.
    return [{ command, action: { label: () => words, keywords: command.split(/[-_.]/) } }];
  });
}

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
  const { locale } = useLocale();
  const [offers, setOffers] = useState<HostCommandOffer[]>([]);
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void api
      .getHostCommands()
      .then((res) => {
        if (cancelled) return;
        // A server older than `offers` answers with ids alone; this build has words for
        // every command such a server's host can offer.
        setOffers(
          res.offers ?? res.commands.map((command) => ({ command, label: "", labelZh: "" })),
        );
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
      ...hostCommandActions(offers, locale).map(({ command, action }): PaletteAction => {
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
    [extra, offers, locale, newWindow],
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

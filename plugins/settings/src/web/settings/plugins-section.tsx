import * as api from "@prismshadow/penguin-web/internal";
import { S } from "@prismshadow/penguin-web/internal";
import { useLocale } from "@prismshadow/penguin-web/internal";
import { localizedText } from "@prismshadow/penguin-web/internal";
import { apiErrorText } from "@prismshadow/penguin-web/internal";
import { useSessions } from "@prismshadow/penguin-web/internal";
import { useProject } from "@prismshadow/penguin-web/internal";

import {
  THIS_SERVER_KEY,
  backendToOffer,
  dismissBackendPrompt,
  installInOrder,
} from "@prismshadow/penguin-web/internal";
import { SETTINGS_SCOPE } from "@prismshadow/penguin-web/internal";
import { MachinePicker } from "@penguinharness/plugin-machines/web";
import {
  usePluginsIncompatibleOnly,
  writePluginsIncompatibleOnly,
} from "@prismshadow/penguin-web/internal";
import { PluginCard } from "./plugin-config-card";
import { withLiveParts } from "./plugin-config-live";
import { SandboxBackendPrompt } from "./sandbox-backend-prompt";
import {
  ConfirmModal,
  NoticeStrip,
  SettingsGroup,
  SettingsSection,
  ToggleRow,
  guardLeave,
  toastError,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import { toastApiError } from "../../lib/toast-api-error";

/**
 * Brings one card into view once the list has loaded — an opening that names a card (the
 * composer's permission menu names `sandbox`) lands on it rather than on the top of the page.
 * Once per opening: scrolling away afterwards is the person's choice.
 */
function FocusCard({ focus, ready }: { focus: string | undefined; ready: boolean }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const done = useRef(false);
  useEffect(() => {
    if (focus === undefined || !ready || done.current) return;
    const card = anchor.current?.parentElement?.querySelector(
      `[data-plugin-config="${CSS.escape(focus)}"]`,
    );
    if (card) {
      card.scrollIntoView({ block: "start" });
      done.current = true;
    }
  }, [focus, ready]);
  return <span ref={anchor} hidden />;
}

/**
 * The page's machine switch. Picking another machine replaces every card with that machine's,
 * so while a card holds unsaved edits it asks first — like leaving the page.
 */
export function ConfigMachinePicker({
  machine,
  machineIds,
  nameOf,
  disabled,
  onPick,
}: {
  machine: string | null;
  machineIds: readonly string[];
  nameOf: (id: string) => string;
  disabled: boolean;
  onPick: (machine: string | null) => void;
}) {
  return (
    <div className="flex justify-end">
      <MachinePicker
        aria-label={S.settings.pluginConfigMachine}
        choices={[
          { value: THIS_SERVER_KEY, label: S.plugins.thisServer },
          ...machineIds.map((id) => ({ value: id, label: nameOf(id) })),
        ]}
        value={machine ?? THIS_SERVER_KEY}
        onChange={(v) => {
          if (disabled) return;
          void guardLeave(() => onPick(v === THIS_SERVER_KEY ? null : v), SETTINGS_SCOPE);
        }}
      />
    </div>
  );
}

/** The server's part of the page: the machine picker and the cards, under a rule. */
const SERVER_PART = "space-y-4 border-t border-line-muted pt-4";

export function PluginsSection({ focus }: { focus?: string } = {}) {
  const { locale } = useLocale();
  const localized = (en: string | undefined, zhText: string | undefined) =>
    en === undefined ? undefined : localizedText(locale, en, zhText);
  /** Every entry as stored on the machine on screen; each card holds its own draft (PluginCard). */
  const [entries, setEntries] = useState<PluginConfigEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /**
   * A group action awaiting confirmation, with its own title. A plugin cannot mark an action
   * as dangerous, so every one asks before it runs on the machine.
   */
  const [pendingAction, setPendingAction] = useState<{
    entry: PluginConfigEntry;
    id: string;
    title: string;
  } | null>(null);
  const { machineIds, machineLabels } = useSessions();
  /** The machine whose settings the page shows and saves: null for this server. */
  const [machine, setMachine] = useState<string | null>(null);
  /** Why the picked machine's settings could not be read, when they could not. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const nameOf = (id: string) => machineLabels.get(id) ?? id;
  const projectId = useProject().currentProject?.projectId ?? null;
  /** The backend package the install prompt offers, while it is open. */
  const [offered, setOffered] = useState<string[] | null>(null);
  const [installing, setInstalling] = useState(false);
  const incompatibleOnly = usePluginsIncompatibleOnly();

  /** The machine's answer becomes what every card shows; a card with unsaved edits keeps them. */
  const adopt = (list: PluginConfigEntry[]) => setEntries(list);

  /** One entry's stored state changed; every other entry stays as it is. */
  const adoptOne = (stored: PluginConfigEntry) =>
    setEntries((prev) => (prev ?? []).map((e) => (e.name === stored.name ? stored : e)));

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setLoadError(null);
    void api.adminGetPluginConfig(machine).then(
      (config) => {
        if (!cancelled) adopt(config.plugins);
      },
      (e: unknown) => {
        if (cancelled) return;
        if (machine === null) {
          toastApiError(e);
          return;
        }
        // A machine that cannot answer — no connection, or a build without these routes —
        // shows an empty page with the reason, not this server's settings under its name.
        adopt([]);
        setLoadError(apiErrorText(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [machine]);

  /**
   * While any group reports work in progress (an install it started), its notices and actions
   * are read again every few seconds — only those: a draft being typed elsewhere on the page is
   * not replaced, and a group that finished gets its new notices and buttons the same way.
   */
  const inProgress = (entries ?? []).some((e) =>
    (e.notices ?? []).some((n) => n.tone === "progress"),
  );
  useEffect(() => {
    if (!inProgress) return;
    let cancelled = false;
    // The machine whose settings are on screen: an install started over there reports its
    // progress over there.
    const timer = setTimeout(() => {
      void api.adminGetPluginConfig(machine).then(
        (config) => {
          if (cancelled) return;
          setEntries((prev) =>
            (prev ?? []).map((e) => {
              const next = config.plugins.find((p) => p.name === e.name);
              if (next === undefined) return e;
              const { notices: _n, actions: _a, ...rest } = e;
              return {
                ...rest,
                ...(next.notices !== undefined ? { notices: next.notices } : {}),
                ...(next.actions !== undefined ? { actions: next.actions } : {}),
              };
            }),
          );
        },
        () => {
          // A failed read leaves the card as it was; the next change of `entries` does not
          // come, so try again on the same schedule.
          if (!cancelled) setEntries((prev) => (prev === null ? prev : [...prev]));
        },
      );
    }, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [entries, inProgress, machine]);

  /**
   * Runs a group's action: what the deployment must DO once on the machine (the Windows
   * sandbox's local accounts). The result's own words are what the person sees — the module
   * knows what happened, this page does not — and the groups it answers with replace ours,
   * because a setup that worked changes what the card says about itself.
   */
  /** A group action's button: asks first, with the action's own title (see pendingAction). */
  const askAction = (entry: PluginConfigEntry, id: string) => {
    const action = entry.actions?.find((a) => a.id === id);
    setPendingAction({
      entry,
      id,
      title: (action && localized(action.title, action.titleZh)) ?? action?.title ?? id,
    });
  };

  const runAction = async (entry: PluginConfigEntry, action: string) => {
    setBusy(`${entry.name}\0${action}`);
    try {
      const res = await api.adminRunPluginConfigAction({ name: entry.name, action }, machine);
      adopt(res.plugins);
      const message = localized(res.message, res.messageZh) ?? res.message;
      if (res.ok) toastSuccess(message);
      else toastError(message);
    } catch (e) {
      toastApiError(e);
    } finally {
      setBusy(null);
    }
  };

  /**
   * The switch was turned on (and stored): if the machine reports no sandbox backend for its
   * OS, ask whether to install its default ones. The switch stays on whatever the answer.
   */
  const offerBackend = (entry: PluginConfigEntry) => {
    const pkgs = backendToOffer(entry, machine ?? THIS_SERVER_KEY);
    if (pkgs !== null) setOffered(pkgs);
  };
  const closePrompt = (dontAskAgain: boolean) => {
    if (dontAskAgain) dismissBackendPrompt(machine ?? THIS_SERVER_KEY);
    setOffered(null);
  };

  /**
   * Installs the offered backends the way the Plugins page does, one after another: into this
   * Project's table for the machine on screen only — this server's own machine id when the card
   * shows this server, so no other machine is asked to run it. A request that fails stops the
   * run and is reported; either way the prompt closes and the card's live parts (notices, the
   * backend report) are read again, so what did install shows; drafts being edited are kept.
   */
  const installOffered = async (dontAskAgain: boolean) => {
    if (offered === null || installing) return;
    if (projectId === null) {
      toastError(S.settings.sandboxBackendPrompt.noProject);
      return;
    }
    setInstalling(true);
    let target = machine;
    await installInOrder(
      offered,
      async (pkg) => {
        const to = (target ??= (await api.getInstalledPlugins(projectId, null)).machineId);
        const res = await api.installPlugin(projectId, pkg, to);
        return res.plugins.find((p) => p.specifier === pkg)?.error;
      },
      {
        installed: (pkg) => toastSuccess(S.plugins.deploymentInstalledToast(pkg)),
        failed: (pkg, error) => toastError(S.plugins.deploymentFailedToast(pkg, error)),
        threw: (e) => toastApiError(e),
      },
    );
    closePrompt(dontAskAgain);
    try {
      const config = await api.adminGetPluginConfig(machine);
      setEntries((prev) => withLiveParts(prev ?? [], config.plugins));
    } catch (e) {
      toastApiError(e);
    } finally {
      setInstalling(false);
    }
  };

  // Only when there is another machine to pick: a single server has nothing to switch to.
  const picker =
    machineIds.length > 0 ? (
      <ConfigMachinePicker
        machine={machine}
        machineIds={machineIds}
        nameOf={nameOf}
        disabled={busy !== null}
        onPick={setMachine}
      />
    ) : null;

  // This browser's view of the Plugins page, ruled off from the server's settings below it.
  const viewRow = (
    <SettingsGroup>
      <ToggleRow
        label={S.settings.pluginsIncompatibleOnly}
        checked={incompatibleOnly}
        onChange={(on) => writePluginsIncompatibleOnly(on)}
      />
    </SettingsGroup>
  );

  if (entries === null) {
    return (
      <SettingsSection>
        {viewRow}
        {picker !== null && <div className={SERVER_PART}>{picker}</div>}
      </SettingsSection>
    );
  }

  // A card per entry with no parent on the page; an entry whose parent is not listed stands
  // on its own rather than disappearing.
  const names = new Set(entries.map((e) => e.name));
  const cards = entries.filter((e) => e.parent === undefined || !names.has(e.parent));
  return (
    <SettingsSection>
      {viewRow}
      {(picker !== null || loadError !== null || cards.length > 0) && (
        <div className={SERVER_PART}>
          {picker}
          {machine !== null && loadError !== null && (
            <NoticeStrip tone="attention" as="p" className="rounded-md px-3 py-2 text-xs">
              {S.plugins.machineUnreadable(nameOf(machine), loadError)}
            </NoticeStrip>
          )}
          <FocusCard focus={focus} ready={entries.length > 0} />
          {cards.map((card) => (
            <PluginCard
              key={card.name}
              members={[card, ...entries.filter((e) => e.parent === card.name)]}
              machine={machine}
              busy={busy}
              setBusy={setBusy}
              locale={locale}
              onStored={adoptOne}
              onStoredAll={adopt}
              onAction={askAction}
              onSwitchedOn={offerBackend}
            />
          ))}
        </div>
      )}
      <ConfirmModal
        open={pendingAction !== null}
        title={S.settings.pluginActionTitle}
        tone="primary"
        onClose={() => setPendingAction(null)}
        onConfirm={() => {
          if (pendingAction !== null) void runAction(pendingAction.entry, pendingAction.id);
          setPendingAction(null);
        }}
        confirmLabel={S.settings.pluginActionRun}
        cancelLabel={S.common.cancel}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {pendingAction !== null
            ? S.settings.pluginActionConfirm(
                pendingAction.title,
                machine === null ? null : nameOf(machine),
              )
            : ""}
        </p>
      </ConfirmModal>
      <SandboxBackendPrompt
        pkgs={offered}
        machineName={machine === null ? S.plugins.thisServer : nameOf(machine)}
        busy={installing}
        onInstall={(dontAskAgain) => void installOffered(dontAskAgain)}
        onLater={(dontAskAgain) => {
          if (!installing) closePrompt(dontAskAgain);
        }}
      />
    </SettingsSection>
  );
}

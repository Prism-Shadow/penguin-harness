/**
 * Plugin options (admin only, server-global): one card per settings entry
 * — a group a module contributes (the sandbox) or a loaded plugin's declared configuration —
 * drawn from its schema: a string, a secret, a boolean, a number, a choice, a list of lines or
 * a table (a row per preset, say; plugin-config-table.tsx) per field, so the page knows nothing
 * about any particular entry. Fields a group marks `advanced` sit in a fold under the others,
 * collapsed by default (advanced-fold.tsx). A group with a `switch` draws that field alone while
 * it is off, and one that reports a `backend` it lacks offers to install it when the switch is
 * turned on (sandbox-backend-prompt.tsx). An entry naming a
 * `parent` is drawn inside that card (the plugin index's sources inside plugin sources) and
 * saved with it; notices the entry reports sit under its title. How a card commits — switches
 * when flipped, everything typed on the card's own Save — is plugin-config-card.tsx. A secret
 * field always starts empty and shows the stored value's mask under it: blank keeps what is
 * stored, typing replaces it, and the clear checkbox drops it. The server validates against the
 * same schema and answers a rejected field by name, which renders under that field.
 *
 * Each server keeps its own values, so the page edits one machine at a time: a picker at the
 * top switches between this server and the machines the Project holds a connection to, and
 * every read, save and action goes to the picked machine through this server's tunnel.
 * Nothing is copied between machines. Picking another machine replaces every card, so with an
 * unsaved card it asks first. A page opens on this server, except a plugin's page that only a
 * machine has (`machine`), which opens on that machine.
 *
 * Values hydrate when the section mounts and every stored response is adopted as the new
 * truth; a card with unsaved edits keeps them against it. The plugin picks a change up through
 * its watch, so nothing here says "restart".
 *
 * The same page serves every page of the Settings dialog's Plugins group, each settings group as
 * a status page (plugin-group-page.tsx): the plugin sources page (`host: "sources"`), the Agent
 * sandbox page (`host: "sandbox"`) and a plugin's own page (`plugin`, plugin-page.tsx). Which page
 * draws which group is plugin-config-groups.ts, so each group is drawn in exactly one place.
 */
import { useEffect, useRef, useState } from "react";
import type { PluginConfigEntry } from "@prismshadow/penguin-server/api";
import * as api from "@prismshadow/penguin-web/internal";
import {
  S,
  localizedText,
  apiErrorText,
  useSessionsIfAny,
  useProjectIfAny,
  MachinePicker,
  toastApiError,
  toastFailure,
  toldFailure,
} from "@prismshadow/penguin-web/internal";
import { webLocale } from "@prismshadow/penguin-web-plugin";
import {
  THIS_SERVER_KEY,
  backendToOffer,
  dismissBackendPrompt,
  installInOrder,
} from "./lib/sandbox-backend-prompt";
import { SETTINGS_SCOPE } from "./lib/unsaved/scopes";
import { PluginCard } from "./plugin-config-card";
import { cardsOn, type GroupPage } from "./plugin-config-groups";
import { withLiveParts } from "./plugin-config-live";
import { SandboxBackendPrompt } from "./sandbox-backend-prompt";
import {
  ConfirmModal,
  NoticeStrip,
  SettingsSection,
  guardLeave,
  toastError,
  toastSuccess,
} from "@prismshadow/penguin-ui";

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

const NO_MACHINES: readonly string[] = [];
const NO_LABELS: ReadonlyMap<string, string> = new Map();

export function PluginsSection({
  focus,
  plugin,
  machine: initialMachine = null,
  host = "sources",
}: {
  focus?: string;
  /** On a plugin's page: its package — only its settings groups. */
  plugin?: string;
  /** The machine the page opens on: null for this server (a plugin only a machine has names it). */
  machine?: string | null;
  /** Without `plugin`: which of the host's own pages this is. */
  host?: "sources" | "sandbox";
} = {}) {
  const page: GroupPage =
    plugin !== undefined
      ? { kind: "plugin", plugin }
      : host === "sandbox"
        ? { kind: "sandbox" }
        : { kind: "sources" };
  // The language on screen, as the dictionary switch tells it (a remount follows every switch).
  const locale = webLocale();
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
  // The Project's connected machines; none outside the app's providers (a test, the gallery).
  const sessions = useSessionsIfAny();
  const machineIds = sessions?.machineIds ?? NO_MACHINES;
  const machineLabels = sessions?.machineLabels ?? NO_LABELS;
  /** The machine whose settings the page shows and saves: null for this server. */
  const [machine, setMachine] = useState<string | null>(initialMachine);
  /** Why the picked machine's settings could not be read, when they could not. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const nameOf = (id: string) => machineLabels.get(id) ?? id;
  const projectId = useProjectIfAny()?.currentProject?.projectId ?? null;
  /** The backend package the install prompt offers, while it is open. */
  const [offered, setOffered] = useState<string[] | null>(null);
  const [installing, setInstalling] = useState(false);

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
  const inProgress = (entries ?? []).some(
    (e) =>
      (e.notices ?? []).some((n) => n.tone === "progress") ||
      e.report?.version?.state === "preparing",
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
              const { notices: _n, actions: _a, report: _r, ...rest } = e;
              return {
                ...rest,
                ...(next.notices !== undefined ? { notices: next.notices } : {}),
                ...(next.actions !== undefined ? { actions: next.actions } : {}),
                ...(next.report !== undefined ? { report: next.report } : {}),
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
   * A group action's button: asks first, with the action's own title (see pendingAction) — except
   * the action the group's own report names as its "check again", which only reads and runs at
   * once. Decided here from the stored entry, never from what the button says about itself.
   */
  const askAction = (entry: PluginConfigEntry, id: string) => {
    if (entry.report?.recheck === id) {
      void runAction(entry, id);
      return;
    }
    const action = entry.actions?.find((a) => a.id === id);
    setPendingAction({
      entry,
      id,
      title: (action && localized(action.title, action.titleZh)) ?? action?.title ?? id,
    });
  };

  /**
   * Runs a group's action: what the deployment must DO once on the machine (the Windows
   * sandbox's local accounts). The result's own words are what the person sees — the module
   * knows what happened, this page does not — and the groups it answers with replace ours,
   * because a setup that worked changes what the card says about itself.
   */
  const runAction = async (entry: PluginConfigEntry, action: string) => {
    setBusy(`${entry.name}\0${action}`);
    try {
      const res = await api.adminRunPluginConfigAction({ name: entry.name, action }, machine);
      adopt(res.plugins);
      const message = localized(res.message, res.messageZh) ?? res.message;
      if (res.ok) toastSuccess(message);
      else
        toastFailure(
          toldFailure(message, {
            what: "a plugin's action failed",
            facts: [
              ["Plugin", entry.name],
              ["Action", action],
            ],
            detail: res.message,
          }),
        );
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
        failed: (pkg, error) =>
          toastFailure(
            toldFailure(S.plugins.deploymentFailedToast(pkg, error), {
              what: "a plugin failed to load after it was installed",
              facts: [["Plugin", pkg]],
              detail: error,
            }),
          ),
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

  const partClass = "space-y-6";

  if (entries === null) {
    return (
      <SettingsSection>
        {picker !== null && <div className={partClass}>{picker}</div>}
      </SettingsSection>
    );
  }

  // The cards this page draws; each group lands on exactly one page.
  const cards = cardsOn(page, entries);
  return (
    <SettingsSection>
      {(picker !== null || loadError !== null || cards.length > 0) && (
        <div className={partClass}>
          {picker}
          {machine !== null && loadError !== null && (
            <NoticeStrip tone="attention" as="p" className="rounded-md px-3 py-2 text-xs">
              {S.plugins.machineUnreadable(nameOf(machine), loadError)}
            </NoticeStrip>
          )}
          <FocusCard focus={focus} ready={entries.length > 0} />
          {plugin !== undefined &&
            (machine !== null || initialMachine !== null) &&
            loadError === null &&
            cards.length === 0 && (
              <p className="text-sm text-fg-muted">
                {/* On this server, only a plugin a machine alone has shows nothing here; a machine
                    that names any group's plugin is new enough that this one has none there. */}
                {machine === null
                  ? S.settings.pluginPage.notOnThisServer
                  : entries.some((e) => e.plugin !== undefined)
                    ? S.settings.pluginPage.noneOnMachine(nameOf(machine))
                    : S.settings.pluginPage.onAdminPage(nameOf(machine), S.settings.pluginsTitle)}
              </p>
            )}
          {cards.map((card) => (
            <PluginCard
              key={card.name}
              layout="page"
              titled={cards.length > 1}
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

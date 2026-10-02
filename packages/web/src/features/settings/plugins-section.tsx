/**
 * Plugin options (admin only, server-global): one card per settings entry — a group a module
 * contributes (the sandbox) or a loaded plugin's declared configuration — drawn from its
 * schema: a string, a secret, a boolean, a number, a choice, a list of lines or a table (a
 * row per preset, say; plugin-config-table.tsx) per field, so the page knows nothing about any
 * particular entry. Fields a group marks `advanced` sit in a fold under the others, collapsed
 * by default (advanced-fold.tsx). A group that reports a `backend` it lacks offers to install
 * it when its `enabled` switch is turned on (sandbox-backend-prompt.tsx). An entry naming a
 * `parent` is drawn inside that card (a sandbox backend's own options inside the sandbox's) and
 * saved with it; notices the entry reports sit under its title. Each card saves on its own;
 * nothing is written until its Save, which sends each changed entry of the card in one PUT. A secret field always starts empty and shows
 * the stored value's mask under it: blank keeps what is stored, typing replaces it, and the
 * clear checkbox drops it. The server validates against the same schema and answers a
 * rejected field by name, which renders under that field.
 *
 * Each server keeps its own values, so the page edits one machine at a time: a picker at the
 * top switches between this server and the machines the Project holds a connection to, and
 * every read, save and action goes to the picked machine through this server's tunnel.
 * Nothing is copied between machines.
 *
 * Values hydrate when the section mounts and the saved response is adopted as the new
 * baseline, the proxy page's rule; the plugin picks the change up through its watch, so
 * nothing here says "restart".
 */
import { useEffect, useRef, useState } from "react";
import type { PluginConfigEntry, PluginConfigField } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { useLocale } from "../../state/locale";
import { localizedText } from "../chat/skill-use";
import { apiErrorText } from "../../lib/api-error";
import { useSessions } from "../../state/sessions";
import { useProject } from "../../state/project";
import { backendToOffer, dismissBackendPrompt } from "../../lib/sandbox-backend-prompt";
import { dispatchPluginConfigSaved } from "../../lib/plugin-config-event";
import { MachinePicker } from "../machines/machine-picker";
import { AdvancedFold } from "./advanced-fold";
import { baselineOf, draftOf, sameValue, valueOf } from "./plugin-config-draft";
import type { Draft } from "./plugin-config-draft";
import { ConfigField } from "./plugin-config-field";
import { ConfigHeading } from "./plugin-config-heading";
import { SandboxBackendPrompt } from "./sandbox-backend-prompt";
import {
  Button,
  ConfirmModal,
  NoticeStrip,
  SettingsSection,
  toastError,
  toastInfo,
  toastSuccess,
} from "@prismshadow/penguin-ui";

/** The picker's value for this server; a machine id is never this short. */
const THIS_SERVER = "*";

/**
 * The boolean field that is a group's on/off switch. Turning it on in a group that reports a
 * `backend` it lacks (the sandbox) offers to install that backend.
 */
const SWITCH_FIELD = "enabled";

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

export function PluginsSection({ focus }: { focus?: string } = {}) {
  const { locale } = useLocale();
  const localized = (en: string | undefined, zhText: string | undefined) =>
    en === undefined ? undefined : localizedText(locale, en, zhText);
  const [entries, setEntries] = useState<PluginConfigEntry[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  /** Secret fields whose stored value the next Save drops, keyed `<plugin>\0<field>`. */
  const [clearing, setClearing] = useState<Set<string>>(new Set());
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
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
  const [offered, setOffered] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  const adopt = (list: PluginConfigEntry[]) => {
    setEntries(list);
    setDrafts(Object.fromEntries(list.map((e) => [e.name, draftOf(e)])));
    setClearing(new Set());
  };

  /** One plugin's saved entry becomes its new baseline; every other form keeps its draft. */
  const adoptOne = (saved: PluginConfigEntry) => {
    setEntries((prev) => (prev ?? []).map((e) => (e.name === saved.name ? saved : e)));
    setDrafts((prev) => ({ ...prev, [saved.name]: draftOf(saved) }));
    setClearing((prev) => new Set([...prev].filter((k) => !k.startsWith(`${saved.name}\0`))));
  };
  const clearErrorsOf = (plugin: string) =>
    setFieldErrors((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(`${plugin}\0`))),
    );

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setLoadError(null);
    setFieldErrors({});
    void api.adminGetPluginConfig(machine).then(
      (config) => {
        if (!cancelled) adopt(config.plugins);
      },
      (e: unknown) => {
        if (cancelled) return;
        if (machine === null) {
          toastError(apiErrorText(e));
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
   * The update one entry's draft makes, or `null` when it changes nothing; `false` when a
   * number box does not parse (its error is set, and nothing in the card is sent).
   */
  const updateOf = (entry: PluginConfigEntry): Record<string, unknown> | null | false => {
    const draft = drafts[entry.name] ?? {};
    const values: Record<string, unknown> = {};
    let changed = false;
    for (const [name, field] of Object.entries(entry.configuration.properties)) {
      if (field.type === "secret") {
        const typed = typeof draft[name] === "string" ? (draft[name] as string).trim() : "";
        if (typed !== "") {
          values[name] = typed;
          changed = true;
        } else if (clearing.has(`${entry.name}\0${name}`)) {
          values[name] = null;
          changed = true;
        }
        continue;
      }
      const v = valueOf(field, draft[name]);
      if (typeof v === "number" && !Number.isFinite(v)) {
        setFieldErrors((prev) => ({
          ...prev,
          [`${entry.name}\0${name}`]: S.settings.pluginFieldNotNumber,
        }));
        return false;
      }
      // Only what changed: sending an untouched field would store its default as a value,
      // pinning it against a later change of the default.
      if (sameValue(v, baselineOf(field, entry.values[name]))) continue;
      values[name] = v;
      changed = true;
    }
    return changed ? values : null;
  };

  /** Saves a card: its entry and the entries drawn inside it, each changed one in its own PUT. */
  const save = async (card: PluginConfigEntry, members: PluginConfigEntry[]) => {
    if (busy !== null) return;
    const updates: Array<[PluginConfigEntry, Record<string, unknown>]> = [];
    for (const entry of members) {
      const update = updateOf(entry);
      if (update === false) return;
      if (update !== null) updates.push([entry, update]);
    }
    if (updates.length === 0) {
      toastInfo(S.common.noChangesToSave);
      return;
    }
    setBusy(card.name);
    for (const [entry] of updates) clearErrorsOf(entry.name);
    try {
      for (const [entry, values] of updates) {
        try {
          const res = await api.adminPutPluginConfig({ name: entry.name, values }, machine);
          const saved = res.plugins.find((e) => e.name === entry.name);
          if (saved !== undefined) adoptOne(saved);
          else adopt(res.plugins);
        } catch (e) {
          // A rejected field is named in the message as `"field" …`; it renders under that field.
          const named =
            e instanceof ApiError && e.code === "plugin_config_invalid"
              ? /^"([^"]+)"/.exec(e.message)?.[1]
              : undefined;
          if (named !== undefined) {
            setFieldErrors({ [`${entry.name}\0${named}`]: apiErrorText(e) });
          } else toastError(apiErrorText(e));
          return;
        }
      }
      toastSuccess(S.common.saved);
      // Pages showing what the card configures (the composer's permission menu) read it again.
      for (const [entry] of updates) {
        dispatchPluginConfigSaved({ group: entry.name, card: card.name });
      }
    } finally {
      setBusy(null);
    }
  };

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
      toastError(apiErrorText(e));
    } finally {
      setBusy(null);
    }
  };

  /**
   * The switch was turned on: if the machine reports no sandbox backend for its OS, ask whether
   * to install its default one. The switch stays on in the draft whatever the answer.
   */
  const offerBackend = (entry: PluginConfigEntry) => {
    const pkg = backendToOffer(entry, machine ?? THIS_SERVER);
    if (pkg !== null) setOffered(pkg);
  };
  const closePrompt = (dontAskAgain: boolean) => {
    if (dontAskAgain) dismissBackendPrompt(machine ?? THIS_SERVER);
    setOffered(null);
  };

  /**
   * Installs the offered backend the way the Plugins page does: into this Project's table for
   * the machine on screen only — this server's own machine id when the card shows this server,
   * so no other machine is asked to run it. Afterwards the card's live parts (notices, the
   * backend report) are read again; drafts being edited are kept.
   */
  const installOffered = async (dontAskAgain: boolean) => {
    if (offered === null || installing) return;
    if (projectId === null) {
      toastError(S.settings.sandboxBackendPrompt.noProject);
      return;
    }
    const pkg = offered;
    setInstalling(true);
    try {
      const target = machine ?? (await api.getInstalledPlugins(projectId)).machineId;
      const res = await api.installPlugin(projectId, pkg, target);
      const row = res.plugins.find((p) => p.specifier === pkg);
      if (row?.error !== undefined) toastError(S.plugins.deploymentFailedToast(pkg, row.error));
      else toastSuccess(S.plugins.deploymentInstalledToast(pkg));
      closePrompt(dontAskAgain);
      const config = await api.adminGetPluginConfig(machine);
      setEntries((prev) =>
        (prev ?? []).map((e) => {
          const next = config.plugins.find((p) => p.name === e.name);
          if (next === undefined) return e;
          const { notices: _n, actions: _a, backend: _b, unavailable: _u, ...rest } = e;
          return {
            ...rest,
            ...(next.notices !== undefined ? { notices: next.notices } : {}),
            ...(next.actions !== undefined ? { actions: next.actions } : {}),
            ...(next.backend !== undefined ? { backend: next.backend } : {}),
            ...(next.unavailable !== undefined ? { unavailable: next.unavailable } : {}),
          };
        }),
      );
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setInstalling(false);
    }
  };

  // Only when there is another machine to pick: a single server has nothing to switch to.
  const picker =
    machineIds.length > 0 ? (
      <div className="flex justify-end">
        <MachinePicker
          aria-label={S.settings.pluginConfigMachine}
          choices={[
            { value: THIS_SERVER, label: S.plugins.thisServer },
            ...machineIds.map((id) => ({ value: id, label: nameOf(id) })),
          ]}
          value={machine ?? THIS_SERVER}
          onChange={(v) => {
            if (busy === null) setMachine(v === THIS_SERVER ? null : v);
          }}
        />
      </div>
    ) : null;

  if (entries === null) return <SettingsSection>{picker}</SettingsSection>;

  const patch = (plugin: string, name: string, value: unknown) => {
    setDrafts((prev) => ({ ...prev, [plugin]: { ...(prev[plugin] ?? {}), [name]: value } }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[`${plugin}\0${name}`];
      return next;
    });
  };

  const control = (entry: PluginConfigEntry, name: string, field: PluginConfigField) => {
    const key = `${entry.name}\0${name}`;
    const choiceField = field.rowChoice?.field;
    return (
      <ConfigField
        key={name}
        entry={entry}
        name={name}
        field={field}
        value={drafts[entry.name]?.[name]}
        error={fieldErrors[key]}
        // A refused cell is named `<field>.<row>.<column>`; the table lists them under itself.
        tableErrors={Object.entries(fieldErrors)
          .filter(([k]) => k === key || k.startsWith(`${key}.`))
          .map(([, text]) => text)}
        {...(choiceField !== undefined
          ? {
              choice: drafts[entry.name]?.[choiceField],
              onChoice: (row: string) => patch(entry.name, choiceField, row),
            }
          : {})}
        clearing={clearing.has(key)}
        onChange={(value) => {
          patch(entry.name, name, value);
          // Typing a new secret is not also clearing it.
          if (field.type === "secret") setClearingKey(key, false);
          if (field.type === "boolean" && value === true && name === SWITCH_FIELD) {
            offerBackend(entry);
          }
        }}
        onClearingChange={(on) => setClearingKey(key, on)}
        disabled={busy !== null}
        locale={locale}
      />
    );
  };
  const setClearingKey = (key: string, on: boolean) =>
    setClearing((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  /** An entry's fields in declaration order: the basic ones, then the Advanced fold, if any. */
  const fields = (entry: PluginConfigEntry) => {
    // A field a table's single-choice column stores into is drawn only as that column.
    const drawnByTable = new Set(
      Object.values(entry.configuration.properties).flatMap((f) =>
        f.rowChoice !== undefined ? [f.rowChoice.field] : [],
      ),
    );
    const all = Object.entries(entry.configuration.properties).filter(
      ([n]) => !drawnByTable.has(n),
    );
    const advanced = all.filter(([, field]) => field.advanced === true);
    return (
      <>
        {all.filter(([, field]) => field.advanced !== true).map(([n, f]) => control(entry, n, f))}
        {advanced.length > 0 && (
          <AdvancedFold>{advanced.map(([n, f]) => control(entry, n, f))}</AdvancedFold>
        )}
      </>
    );
  };

  // A card per entry with no parent on the page; an entry whose parent is not listed stands
  // on its own rather than disappearing.
  const names = new Set(entries.map((e) => e.name));
  const cards = entries.filter((e) => e.parent === undefined || !names.has(e.parent));
  return (
    <SettingsSection>
      {picker}
      {machine !== null && loadError !== null && (
        <NoticeStrip tone="attention" as="p" className="rounded-md px-3 py-2 text-xs">
          {S.plugins.machineUnreadable(nameOf(machine), loadError)}
        </NoticeStrip>
      )}
      <FocusCard focus={focus} ready={entries.length > 0} />
      {cards.map((card) => {
        const children = entries.filter((e) => e.parent === card.name);
        return (
          <section
            key={card.name}
            data-plugin-config={card.name}
            className="space-y-3 rounded-md border border-gray-200 p-4 dark:border-gray-800"
          >
            <ConfigHeading
              entry={card}
              draft={drafts[card.name]}
              nested={false}
              disabled={busy !== null}
              onAction={(action) => askAction(card, action)}
              locale={locale}
            />
            {fields(card)}
            {children.map((child) => (
              <div
                key={child.name}
                className="space-y-3 border-t border-gray-100 pt-3 dark:border-gray-800/60"
              >
                <ConfigHeading
                  entry={child}
                  draft={drafts[child.name]}
                  nested
                  disabled={busy !== null}
                  onAction={(action) => askAction(child, action)}
                  locale={locale}
                />
                {fields(child)}
              </div>
            ))}
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="primary"
                disabled={busy !== null}
                onClick={() => void save(card, [card, ...children])}
              >
                {busy === card.name ? S.common.saving : S.common.save}
              </Button>
            </div>
          </section>
        );
      })}
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
        pkg={offered}
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

/**
 * Plugin options (admin only, server-global): one card per settings entry — a group a module
 * contributes (the sandbox) or a loaded plugin's declared configuration — drawn from its
 * schema: a string, a secret, a boolean, a number, a choice, a list of lines or a table (a
 * row per preset, say) per field, so the page knows nothing about any particular entry. An entry naming a
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
import { toneInk } from "../../lib/tone";
import { useSessions } from "../../state/sessions";
import { MachinePicker } from "../machines/machine-picker";
import {
  Button,
  Checkbox,
  ConfirmModal,
  Input,
  NoticeStrip,
  PasswordInput,
  Select,
  SettingsSection,
  Spinner,
  Textarea,
  ToggleRow,
  toastError,
  toastInfo,
  toastSuccess,
} from "@prismshadow/penguin-ui";

/** The picker's value for this server; a machine id is never this short. */
const THIS_SERVER = "*";

/**
 * A field's draft: strings and numbers as typed (a number stays the string in the box until
 * Save, so "1." or "-" survives the keystroke), booleans as values; a secret's clear box
 * beside it.
 */
type Draft = Record<string, unknown>;

/** A `table` field's draft: every row's cells. */
type TableDraft = Record<string, Record<string, string | boolean>>;

/**
 * A table's draft from its stored cells (only those that differ are stored): a text cell is
 * what was saved into it, empty for the declared text (shown as the placeholder, in the page's
 * language); every other cell is its value. Sent whole: an emptied text cell goes back to the
 * declared text.
 */
function tableDraftOf(field: PluginConfigField, stored: unknown): TableDraft {
  const saved = (stored ?? {}) as Record<string, Record<string, unknown> | undefined>;
  return Object.fromEntries(
    (field.rows ?? []).map((row) => [
      row.id,
      Object.fromEntries(
        (field.columns ?? []).map((c) => {
          const v = saved[row.id]?.[c.name];
          if (c.type === "string") return [c.name, typeof v === "string" ? v : ""];
          return [c.name, v !== undefined ? (v as string | boolean) : row.values[c.name]!];
        }),
      ),
    ]),
  );
}

/** The draft a plugin's form starts from: every non-secret value as stored, every secret empty. */
function draftOf(entry: PluginConfigEntry): Draft {
  const out: Draft = {};
  for (const [name, field] of Object.entries(entry.configuration.properties)) {
    if (field.type === "secret") continue;
    if (field.type === "table") {
      out[name] = tableDraftOf(field, entry.values[name]);
      continue;
    }
    const v = entry.values[name];
    if (v === undefined) continue;
    out[name] =
      field.type === "number"
        ? String(v)
        : field.type === "list"
          ? (Array.isArray(v) ? v : []).join("\n")
          : v;
  }
  return out;
}

/** What a field's saved value is compared with, in the draft's terms (a table as its draft). */
function baselineOf(field: PluginConfigField, stored: unknown): unknown {
  return field.type === "table" ? tableDraftOf(field, stored) : stored;
}

/** The value a draft sends for a field: a number parsed from its box, a list split into lines, everything else as is. */
function valueOf(field: PluginConfigField, draft: unknown): unknown {
  if (field.type === "list") {
    const lines = (typeof draft === "string" ? draft : "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    return lines.length === 0 ? null : lines;
  }
  if (field.type !== "number") return draft ?? null;
  const text = typeof draft === "string" ? draft.trim() : "";
  return text === "" ? null : Number(text);
}

/** Whether two field values are the same (lists compared by content). */
const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

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
    const draft = drafts[entry.name] ?? {};
    const key = `${entry.name}\0${name}`;
    const error = fieldErrors[key];
    const label = localized(field.title, field.titleZh) ?? name;
    const hint = localized(field.description, field.descriptionZh);
    const disabled = busy !== null;
    switch (field.type) {
      case "table": {
        const table = (draft[name] ?? {}) as TableDraft;
        const setCell = (row: string, column: string, value: string | boolean) =>
          patch(entry.name, name, { ...table, [row]: { ...table[row], [column]: value } });
        // A refused cell is named `<field>.<row>.<column>`; the table lists them under itself.
        const errors = Object.entries(fieldErrors)
          .filter(([k]) => k === key || k.startsWith(`${key}.`))
          .map(([, text]) => text);
        const th = "px-2 py-1.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400";
        return (
          <div key={name} className="space-y-1.5">
            <p className="text-sm font-medium">{label}</p>
            {hint !== undefined && (
              <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800">
                    {(field.columns ?? []).map((c) => (
                      <th key={c.name} scope="col" className={th}>
                        {localized(c.title, c.titleZh)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(field.rows ?? []).map((row) => (
                    <tr key={row.id} className="border-b border-gray-100 dark:border-gray-800/60">
                      {(field.columns ?? []).map((c) => {
                        const cell = table[row.id]?.[c.name];
                        const locked = row.locked?.includes(c.name) === true;
                        const cellLabel = `${localizedText(locale, String(row.values.name ?? row.id), row.valuesZh?.name)} · ${localized(c.title, c.titleZh)}`;
                        return (
                          <td key={c.name} className="px-2 py-1 align-middle">
                            {c.type === "boolean" ? (
                              <input
                                type="checkbox"
                                aria-label={cellLabel}
                                checked={cell === true}
                                disabled={disabled || locked}
                                onChange={(e) => setCell(row.id, c.name, e.target.checked)}
                              />
                            ) : c.type === "enum" ? (
                              <Select
                                size="sm"
                                aria-label={cellLabel}
                                value={typeof cell === "string" ? cell : ""}
                                disabled={disabled || locked}
                                onChange={(e) => setCell(row.id, c.name, e.target.value)}
                              >
                                {(c.options ?? []).map((option) => {
                                  const off = entry.unavailable?.find(
                                    (u) =>
                                      u.field === name &&
                                      u.column === c.name &&
                                      u.value === option.value,
                                  );
                                  const title = localized(option.title, option.titleZh);
                                  return (
                                    <option
                                      key={option.value}
                                      value={option.value}
                                      disabled={off !== undefined}
                                    >
                                      {off === undefined
                                        ? title
                                        : S.settings.pluginOptionUnavailable(
                                            title ?? option.value,
                                            localized(off.reason, off.reasonZh) ?? off.reason,
                                          )}
                                    </option>
                                  );
                                })}
                              </Select>
                            ) : (
                              <Input
                                size="sm"
                                aria-label={cellLabel}
                                value={typeof cell === "string" ? cell : ""}
                                placeholder={localizedText(
                                  locale,
                                  String(row.values[c.name] ?? ""),
                                  row.valuesZh?.[c.name],
                                )}
                                disabled={disabled || locked}
                                autoComplete="off"
                                onChange={(e) => setCell(row.id, c.name, e.target.value)}
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {errors.map((text, i) => (
              <p key={i} className={`text-xs ${toneInk.danger}`}>
                {text}
              </p>
            ))}
          </div>
        );
      }
      case "enum":
        return (
          <Select
            key={name}
            size="sm"
            label={label}
            {...(hint !== undefined ? { hint } : {})}
            {...(error !== undefined ? { error } : {})}
            value={typeof draft[name] === "string" ? (draft[name] as string) : ""}
            disabled={disabled}
            onChange={(e) => patch(entry.name, name, e.target.value)}
          >
            {(field.options ?? []).map((option) => {
              // An option this machine cannot honour stays listed, greyed out, with the reason.
              const off = entry.unavailable?.find(
                (u) => u.field === name && u.value === option.value,
              );
              const title = localized(option.title, option.titleZh);
              return (
                <option key={option.value} value={option.value} disabled={off !== undefined}>
                  {off === undefined
                    ? title
                    : S.settings.pluginOptionUnavailable(
                        title ?? option.value,
                        localized(off.reason, off.reasonZh) ?? off.reason,
                      )}
                </option>
              );
            })}
          </Select>
        );
      case "list":
        return (
          <Textarea
            key={name}
            label={label}
            rows={3}
            {...(hint !== undefined ? { hint } : {})}
            {...(error !== undefined ? { error } : {})}
            value={typeof draft[name] === "string" ? (draft[name] as string) : ""}
            placeholder={field.placeholder ?? ""}
            disabled={disabled}
            onChange={(e) => patch(entry.name, name, e.target.value)}
          />
        );
      case "boolean":
        return (
          <ToggleRow
            key={name}
            variant="plain"
            label={label}
            hint={hint}
            checked={draft[name] === true}
            onChange={(v) => patch(entry.name, name, v)}
            disabled={disabled}
          />
        );
      case "secret": {
        const masked = typeof entry.values[name] === "string" ? (entry.values[name] as string) : "";
        const typed = typeof draft[name] === "string" ? (draft[name] as string) : "";
        return (
          <div key={name} className="space-y-1">
            <PasswordInput
              size="sm"
              label={label}
              {...(hint !== undefined ? { hint } : {})}
              {...(error !== undefined ? { error } : {})}
              value={typed}
              placeholder={
                masked !== "" ? S.settings.pluginSecretKeepHint : (field.placeholder ?? "")
              }
              disabled={disabled}
              autoComplete="off"
              onChange={(e) => {
                patch(entry.name, name, e.target.value);
                setClearing((prev) => {
                  const next = new Set(prev);
                  next.delete(key);
                  return next;
                });
              }}
            />
            {masked !== "" && typed === "" && (
              <div className="flex items-center gap-x-3 text-xs text-gray-500 dark:text-gray-400">
                <span className="font-mono">{masked}</span>
                <Checkbox
                  checked={clearing.has(key)}
                  disabled={disabled}
                  label={S.settings.pluginSecretClear}
                  onChange={(on) =>
                    setClearing((prev) => {
                      const next = new Set(prev);
                      if (on) next.add(key);
                      else next.delete(key);
                      return next;
                    })
                  }
                />
              </div>
            )}
          </div>
        );
      }
      case "number":
        return (
          <Input
            key={name}
            size="sm"
            type="number"
            label={label}
            {...(hint !== undefined ? { hint } : {})}
            {...(error !== undefined ? { error } : {})}
            value={typeof draft[name] === "string" ? (draft[name] as string) : ""}
            placeholder={field.placeholder ?? ""}
            disabled={disabled}
            onChange={(e) => patch(entry.name, name, e.target.value)}
          />
        );
      default:
        return (
          <Input
            key={name}
            size="sm"
            label={label}
            {...(hint !== undefined ? { hint } : {})}
            {...(error !== undefined ? { error } : {})}
            value={typeof draft[name] === "string" ? (draft[name] as string) : ""}
            placeholder={field.placeholder ?? ""}
            disabled={disabled}
            autoComplete="off"
            onChange={(e) => patch(entry.name, name, e.target.value)}
          />
        );
    }
  };

  /** An entry's title, its store name, its description and its notices. */
  const heading = (entry: PluginConfigEntry, nested: boolean) => {
    const description = localized(
      entry.configuration.description,
      entry.configuration.descriptionZh,
    );
    return (
      <div className="space-y-1.5">
        <div>
          <p className={nested ? "text-xs font-semibold" : "text-sm font-semibold"}>
            {localized(entry.configuration.title, entry.configuration.titleZh) ?? entry.name}
          </p>
          <p className="font-mono text-xs text-gray-500 dark:text-gray-400">{entry.name}</p>
          {description !== undefined && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{description}</p>
          )}
        </div>
        {(entry.actions ?? []).length > 0 && (
          <div className="space-y-2">
            {(entry.actions ?? []).map((action) => {
              const description = localized(action.description, action.descriptionZh);
              return (
                <div key={action.id} className="flex items-start gap-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() =>
                      setPendingAction({
                        entry,
                        id: action.id,
                        title: localized(action.title, action.titleZh) ?? action.title,
                      })
                    }
                  >
                    {localized(action.title, action.titleZh) ?? action.title}
                  </Button>
                  {description !== undefined && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {(entry.notices ?? []).map((notice, i) =>
          notice.tone === "progress" ? (
            <p key={i} className={`flex items-center gap-2 text-xs ${toneInk.busy}`}>
              <Spinner size="sm" label={S.common.loading} />
              <span className="min-w-0 break-words">{localized(notice.text, notice.textZh)}</span>
            </p>
          ) : notice.tone === "attention" ? (
            <NoticeStrip tone="attention" as="p" key={i} className="rounded-md px-3 py-2 text-xs">
              {localized(notice.text, notice.textZh)}
            </NoticeStrip>
          ) : (
            <p key={i} className="text-xs text-gray-500 dark:text-gray-400">
              {localized(notice.text, notice.textZh)}
            </p>
          ),
        )}
      </div>
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
            {heading(card, false)}
            {Object.entries(card.configuration.properties).map(([name, field]) =>
              control(card, name, field),
            )}
            {children.map((child) => (
              <div
                key={child.name}
                className="space-y-3 border-t border-gray-100 pt-3 dark:border-gray-800/60"
              >
                {heading(child, true)}
                {Object.entries(child.configuration.properties).map(([name, field]) =>
                  control(child, name, field),
                )}
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
    </SettingsSection>
  );
}

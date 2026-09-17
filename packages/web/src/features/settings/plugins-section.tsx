/**
 * Plugin options (admin only, server-global): one card per settings entry — a group a module
 * contributes (the sandbox) or a loaded plugin's declared configuration — drawn from its
 * schema: a string, a secret, a boolean, a number, a choice or a list of
 * lines per field, so the page knows nothing about any particular entry. An entry naming a
 * `parent` is drawn inside that card (a sandbox backend's own options inside the sandbox's) and
 * saved with it; notices the entry reports sit under its title. Each card saves on its own;
 * nothing is written until its Save, which sends each changed entry of the card in one PUT. A secret field always starts empty and shows
 * the stored value's mask under it: blank keeps what is stored, typing replaces it, and the
 * clear checkbox drops it. The server validates against the same schema and answers a
 * rejected field by name, which renders under that field.
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
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { PasswordInput } from "../../components/ui/password-input";
import { Select } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { toneStrip } from "../../lib/tone";
import { SectionShell } from "./section-shell";

/**
 * A field's draft: strings and numbers as typed (a number stays the string in the box until
 * Save, so "1." or "-" survives the keystroke), booleans as values; a secret's clear box
 * beside it.
 */
type Draft = Record<string, unknown>;

/** The draft a plugin's form starts from: every non-secret value as stored, every secret empty. */
function draftOf(entry: PluginConfigEntry): Draft {
  const out: Draft = {};
  for (const [name, field] of Object.entries(entry.configuration.properties)) {
    if (field.type === "secret") continue;
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
    void api.adminGetPluginConfig().then(
      (config) => {
        if (!cancelled) adopt(config.plugins);
      },
      (e: unknown) => {
        if (!cancelled) toastError(apiErrorText(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

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
      if (sameValue(v, entry.values[name])) continue;
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
          const res = await api.adminPutPluginConfig({ name: entry.name, values });
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
      const res = await api.adminRunPluginConfigAction({ name: entry.name, action });
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

  if (entries === null) return <SectionShell>{null}</SectionShell>;

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
            {(field.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {localized(option.title, option.titleZh)}
              </option>
            ))}
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
          <div key={name} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{label}</p>
              {hint !== undefined && (
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
              )}
            </div>
            <Switch
              checked={draft[name] === true}
              onChange={(v) => patch(entry.name, name, v)}
              disabled={disabled}
            />
          </div>
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
              <label className="flex items-center gap-x-3 text-xs text-gray-500 dark:text-gray-400">
                <span className="font-mono">{masked}</span>
                <span className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={clearing.has(key)}
                    disabled={disabled}
                    onChange={(e) =>
                      setClearing((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(key);
                        else next.delete(key);
                        return next;
                      })
                    }
                  />
                  {S.settings.pluginSecretClear}
                </span>
              </label>
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
          <p className={nested ? "text-[13px] font-semibold" : "text-sm font-semibold"}>
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
                    onClick={() => void runAction(entry, action.id)}
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
          notice.tone === "attention" ? (
            <p key={i} className={`rounded-md px-3 py-2 text-xs ${toneStrip.attention}`}>
              {localized(notice.text, notice.textZh)}
            </p>
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
    <SectionShell>
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
    </SectionShell>
  );
}

/**
 * Plugin options (admin only, server-global): one form per loaded plugin that declares a
 * configuration, drawn from the schema the plugin's package carries — a string, a secret, a
 * boolean, a number or a Project picker per field — so the page knows nothing about any
 * particular plugin. Each plugin saves on its own; nothing is written until its Save, which
 * sends every field of that plugin in one PUT. A secret field always starts empty and shows
 * the stored value's mask under it: blank keeps what is stored, typing replaces it, and the
 * clear checkbox drops it. The server validates against the same schema and answers a
 * rejected field by name, which renders under that field.
 *
 * Values hydrate when the section mounts and the saved response is adopted as the new
 * baseline, the proxy page's rule; the plugin picks the change up through its watch, so
 * nothing here says "restart".
 */
import { useEffect, useState } from "react";
import type {
  PluginConfigEntry,
  PluginConfigField,
  ProjectSummary,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S, zh } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { PasswordInput } from "../../components/ui/password-input";
import { Select } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { SectionShell } from "./section-shell";

/** A field's draft: strings as typed, others as values; a secret's clear box beside it. */
type Draft = Record<string, unknown>;

/** The localized half of a schema string: `…Zh` under the Chinese UI, the plain one otherwise. */
function localized(en: string | undefined, zhText: string | undefined): string | undefined {
  return S === zh ? (zhText ?? en) : en;
}

/** The draft a plugin's form starts from: every non-secret value as stored, every secret empty. */
function draftOf(entry: PluginConfigEntry): Draft {
  const out: Draft = {};
  for (const [name, field] of Object.entries(entry.configuration.properties)) {
    if (field.type === "secret") continue;
    const v = entry.values[name];
    if (v !== undefined) out[name] = v;
  }
  return out;
}

export function PluginsSection() {
  const [entries, setEntries] = useState<PluginConfigEntry[] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
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

  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.adminGetPluginConfig(), api.listProjects()])
      .then(([config, list]) => {
        if (cancelled) return;
        adopt(config.plugins);
        setProjects(list.projects);
      })
      .catch((e: unknown) => {
        if (!cancelled) toastError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (entry: PluginConfigEntry) => {
    if (busy !== null) return;
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
      const v = draft[name];
      if (v !== entry.values[name]) changed = true;
      values[name] = v === undefined ? null : v;
    }
    if (!changed) {
      toastInfo(S.common.noChangesToSave);
      return;
    }
    setBusy(entry.name);
    setFieldErrors({});
    try {
      const res = await api.adminPutPluginConfig({ name: entry.name, values });
      adopt(res.plugins);
      toastSuccess(S.common.saved);
    } catch (e) {
      // A rejected field is named in the message as `"field" …`; it renders under that field.
      const named =
        e instanceof ApiError && e.code === "plugin_config_invalid"
          ? /^"([^"]+)"/.exec(e.message)?.[1]
          : undefined;
      if (named !== undefined) setFieldErrors({ [`${entry.name}\0${named}`]: apiErrorText(e) });
      else toastError(apiErrorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (entries === null) return <SectionShell>{null}</SectionShell>;
  if (entries.length === 0) {
    return (
      <SectionShell>
        <p className="text-sm text-gray-500 dark:text-gray-400">{S.settings.pluginsNone}</p>
      </SectionShell>
    );
  }

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
    const disabled = busy === entry.name;
    switch (field.type) {
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
      case "project":
        return (
          <Select
            key={name}
            label={label}
            {...(hint !== undefined ? { hint } : {})}
            {...(error !== undefined ? { error } : {})}
            value={typeof draft[name] === "string" ? (draft[name] as string) : ""}
            disabled={disabled}
            onChange={(e) => patch(entry.name, name, e.target.value)}
          >
            <option value="">{S.settings.pluginProjectNone}</option>
            {projects.map((p) => (
              <option key={p.projectId} value={p.projectId}>
                {p.name !== undefined && p.name !== "" ? `${p.name} (${p.projectId})` : p.projectId}
              </option>
            ))}
          </Select>
        );
      case "number":
        return (
          <Input
            key={name}
            size="sm"
            type="number"
            label={label}
            {...(hint !== undefined ? { hint } : {})}
            {...(error !== undefined ? { error } : {})}
            value={typeof draft[name] === "number" ? String(draft[name]) : ""}
            placeholder={field.placeholder ?? ""}
            disabled={disabled}
            onChange={(e) =>
              patch(entry.name, name, e.target.value === "" ? undefined : Number(e.target.value))
            }
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

  return (
    <SectionShell>
      {entries.map((entry) => (
        <section
          key={entry.name}
          className="space-y-3 rounded-md border border-gray-200 p-4 dark:border-gray-800"
        >
          <div>
            <p className="text-sm font-semibold">
              {localized(entry.configuration.title, entry.configuration.titleZh) ?? entry.name}
            </p>
            <p className="font-mono text-xs text-gray-500 dark:text-gray-400">{entry.name}</p>
            {localized(entry.configuration.description, entry.configuration.descriptionZh) !==
              undefined && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {localized(entry.configuration.description, entry.configuration.descriptionZh)}
              </p>
            )}
          </div>
          {Object.entries(entry.configuration.properties).map(([name, field]) =>
            control(entry, name, field),
          )}
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="primary"
              disabled={busy !== null}
              onClick={() => void save(entry)}
            >
              {busy === entry.name ? S.common.saving : S.common.save}
            </Button>
          </div>
        </section>
      ))}
    </SectionShell>
  );
}

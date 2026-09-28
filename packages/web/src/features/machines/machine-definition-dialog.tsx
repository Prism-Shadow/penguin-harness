/**
 * The form that defines a machine by hand, for any kind that takes one — an ssh Host block, a
 * container — or configures one already defined. The fields are the KIND's (its `form`, in the
 * shape plugin settings use), so this page knows nothing about ssh or containers: a string, a
 * number, a choice, a switch or a list of lines per field, the name first.
 *
 * The server checks the definition with the kind and answers a refused field by name
 * (`<field>: <why>`), which lands under that field. A definition the kind says may not be
 * rewritten (a hand-written ssh block) is shown and not saved. One the server keeps (a
 * container's) can be forgotten here; nothing over there is removed.
 */
import { useState } from "react";
import type {
  MachineDefinitionResponse,
  MachineKindInfo,
  MachinesResponse,
  PluginConfigField,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toneStrip } from "../../lib/tone";
import { useLocale } from "../../state/locale";
import { localizedText } from "../chat/skill-use";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { Select } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { toastSuccess } from "../../components/ui/toast";

/** Defining a new machine (a kind to choose among those with a form), or configuring one read back. */
export type DefinitionFormMode =
  { kind: "add" } | { kind: "edit"; machineKind: string; definition: MachineDefinitionResponse };

/** A field's draft: what its box holds (a list as its lines, a number as typed), a switch as a boolean. */
type Draft = Record<string, unknown>;

function draftOf(
  fields: Record<string, PluginConfigField>,
  values: Record<string, unknown>,
): Draft {
  const out: Draft = {};
  for (const [name, field] of Object.entries(fields)) {
    const v = values[name] ?? field.default;
    if (v === undefined || v === null) continue;
    out[name] =
      field.type === "list"
        ? (Array.isArray(v) ? v : []).join("\n")
        : field.type === "number"
          ? String(v)
          : v;
  }
  return out;
}

/** The value a draft sends: a list split into lines, a number parsed, the rest as it is. */
function valueOf(field: PluginConfigField, draft: unknown): unknown {
  if (field.type === "list") {
    return (typeof draft === "string" ? draft : "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
  }
  if (field.type === "number") {
    const text = typeof draft === "string" ? draft.trim() : "";
    return text === "" ? null : Number(text);
  }
  return draft ?? null;
}

/**
 * Mount with a `key` that changes with the mode, so the form starts from the right values each
 * time it opens; it keeps no state across modes.
 */
export function MachineDefinitionDialog({
  mode,
  kinds,
  projectId,
  onClose,
  onSaved,
}: {
  mode: DefinitionFormMode;
  /** The kinds loaded here; a new machine is of one that has a form. */
  kinds: MachineKindInfo[];
  projectId: string;
  onClose: () => void;
  /** The machines list as the server answered it after the write. */
  onSaved: (state: MachinesResponse) => void;
}) {
  const d = S.machines.definition;
  const { locale } = useLocale();
  const localized = (en: string | undefined, zh: string | undefined) =>
    en === undefined ? undefined : localizedText(locale, en, zh);
  const definable = kinds.filter((k) => k.form !== null);
  const editing = mode.kind === "edit";
  const [kindName, setKindName] = useState<string>(
    mode.kind === "edit" ? mode.machineKind : (definable[0]?.kind ?? ""),
  );
  const kind = kinds.find((k) => k.kind === kindName) ?? null;
  const form = kind?.form ?? null;
  const locked = mode.kind === "edit" && !mode.definition.editable;
  const [name, setName] = useState(mode.kind === "edit" ? mode.definition.name : "");
  const [draft, setDraft] = useState<Draft>(() =>
    form === null ? {} : draftOf(form.fields, mode.kind === "edit" ? mode.definition.values : {}),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const kindTitle = kind === null ? kindName : (localized(kind.title, kind.titleZh) ?? kind.kind);

  const chooseKind = (next: string) => {
    setKindName(next);
    const nextForm = kinds.find((k) => k.kind === next)?.form ?? null;
    setDraft(nextForm === null ? {} : draftOf(nextForm.fields, {}));
    setErrors({});
  };
  const patch = (field: string, value: unknown) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  /** A refusal naming a field lands under it; anything else under the name. */
  const place = (text: string) => {
    const fields = form === null ? [] : ["name", ...Object.keys(form.fields)];
    const hit = fields.find((field) => text.startsWith(`${field}: `));
    setErrors(hit === undefined ? { name: text } : { [hit]: text.slice(hit.length + 2) });
  };

  const submit = async () => {
    if (locked || form === null || kind === null) return;
    if (name.trim() === "") {
      setErrors({ name: S.common.requiredField });
      return;
    }
    const values: Record<string, unknown> = {};
    for (const [field, spec] of Object.entries(form.fields)) {
      const value = valueOf(spec, draft[field]);
      if (spec.required === true && (value === null || value === "")) {
        setErrors({ [field]: S.common.requiredField });
        return;
      }
      if (value !== null) values[field] = value;
    }
    setBusy(true);
    try {
      if (mode.kind === "edit") {
        onSaved(await api.updateMachineDefinition(projectId, kind.kind, name, values));
        toastSuccess(d.saved(name));
      } else {
        onSaved(await api.defineMachine(projectId, kind.kind, name.trim(), values));
        toastSuccess(d.added(name.trim()));
      }
      onClose();
    } catch (err) {
      place(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    if (mode.kind !== "edit") return;
    setBusy(true);
    try {
      onSaved(await api.forgetMachineDefinition(projectId, mode.machineKind, mode.definition.name));
      toastSuccess(d.forgotten(mode.definition.name));
      onClose();
    } catch (err) {
      place(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const control = (field: string, spec: PluginConfigField) => {
    const label = localized(spec.title, spec.titleZh) ?? field;
    const hint = localized(spec.description, spec.descriptionZh);
    const error = errors[field];
    const common = {
      ...(hint !== undefined ? { hint } : {}),
      ...(error !== undefined ? { error } : {}),
      disabled: busy || locked,
    };
    const text = typeof draft[field] === "string" ? (draft[field] as string) : "";
    switch (spec.type) {
      case "enum":
        return (
          <Select
            key={field}
            size="sm"
            label={label}
            {...common}
            value={text}
            onChange={(e) => patch(field, e.target.value)}
          >
            {(spec.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {localized(option.title, option.titleZh) ?? option.value}
              </option>
            ))}
          </Select>
        );
      case "list":
        return (
          <Textarea
            key={field}
            label={label}
            rows={3}
            {...common}
            className="font-mono"
            value={text}
            placeholder={spec.placeholder ?? ""}
            onChange={(e) => patch(field, e.target.value)}
          />
        );
      case "boolean":
        return (
          <div key={field} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{label}</p>
              {hint !== undefined && (
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
              )}
            </div>
            <Switch
              checked={draft[field] === true}
              onChange={(v) => patch(field, v)}
              disabled={busy || locked}
            />
          </div>
        );
      default:
        return (
          <Input
            key={field}
            size="sm"
            label={label}
            required={spec.required === true}
            {...common}
            className="font-mono"
            type={spec.type === "secret" ? "password" : "text"}
            inputMode={spec.type === "number" ? "numeric" : undefined}
            value={text}
            placeholder={spec.placeholder ?? ""}
            autoComplete="off"
            onChange={(e) => patch(field, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) void submit();
            }}
          />
        );
    }
  };

  return (
    <Modal
      open
      title={editing ? d.editTitle(kindTitle) : kind === null ? d.newTitle : d.addTitle(kindTitle)}
      onClose={onClose}
      footer={
        <>
          {mode.kind === "edit" && mode.definition.forgettable && (
            <Button
              size="sm"
              variant="danger"
              title={d.forgetWhy}
              disabled={busy}
              onClick={() => void forget()}
            >
              {d.forgetVerb}
            </Button>
          )}
          <Button size="sm" onClick={onClose}>
            {S.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || locked || form === null}
            onClick={() => void submit()}
          >
            {busy ? S.common.saving : editing ? S.common.save : d.add}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {definable.length === 0 && !editing && (
          <div className={`rounded-md border px-3 py-2 text-xs ${toneStrip.attention}`}>
            {d.noKinds}
          </div>
        )}
        {locked && (
          <div className={`rounded-md border px-3 py-2 text-xs ${toneStrip.attention}`}>
            {d.foreign}
          </div>
        )}
        {!editing && definable.length > 1 && (
          <Select
            size="sm"
            label={d.kind}
            value={kindName}
            disabled={busy}
            onChange={(e) => chooseKind(e.target.value)}
          >
            {definable.map((k) => (
              <option key={k.kind} value={k.kind}>
                {localized(k.title, k.titleZh) ?? k.kind}
              </option>
            ))}
          </Select>
        )}
        {form !== null && (
          <>
            <Input
              size="sm"
              label={localized(form.name.title, form.name.titleZh) ?? "name"}
              required
              {...(localized(form.name.description, form.name.descriptionZh) !== undefined &&
              !editing
                ? { hint: localized(form.name.description, form.name.descriptionZh)! }
                : {})}
              {...(errors.name !== undefined ? { error: errors.name } : {})}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((prev) => {
                  const next = { ...prev };
                  delete next.name;
                  return next;
                });
              }}
              className="font-mono"
              placeholder={form.name.placeholder ?? ""}
              autoComplete="off"
              autoFocus={!editing}
              disabled={editing || busy}
            />
            {Object.entries(form.fields).map(([field, spec]) => control(field, spec))}
          </>
        )}
      </div>
    </Modal>
  );
}

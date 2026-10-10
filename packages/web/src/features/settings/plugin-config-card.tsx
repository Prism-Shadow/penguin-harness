/**
 * One card of the Settings dialog's Plugins page: a settings entry and the entries drawn inside
 * it (a sandbox backend's group inside the sandbox's), under the settings commit model.
 *
 * - **Switches apply when flipped.** The card's `switch` and every `boolean` field write their
 *   own value alone, to their own entry, the moment they move; the switch shows the new position
 *   at once and settles on the server's answer, and a refused write puts it back with a toast.
 *   They are never part of the card's draft, so flipping one neither dirties the card nor
 *   touches what is typed beside it. Turning the `switch` on offers the backend install once the
 *   write has landed.
 * - **Everything typed waits for Save** — text, secrets (with the clear box, an instruction to
 *   the next Save), numbers, choices, lists and tables, a table's boolean cells included (its
 *   added rows exist only in the draft). Save is live only while the card differs from what is
 *   stored and every number parses (a box that does not is marked inline); it sends each
 *   changed entry in its own PUT, only the fields that changed. Reset puts the stored values
 *   back. A rejected field renders under that field; a save that fails keeps the draft.
 * - **A reload keeps the typing.** When the page re-reads the entries (a group action, a
 *   finished install), a clean card follows the new values and a dirty one keeps its draft
 *   against the new baseline (`useFormDraft`).
 *
 * The draft registers under the Settings dialog's scope, so switching pages, closing the dialog
 * or picking another machine with a dirty card asks first.
 */
import { useState } from "react";
import type { PluginConfigEntry, PluginConfigField } from "@prismshadow/penguin-server/api";
import { Button, toastError, toastSuccess, useFormDraft } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { dispatchPluginConfigSaved } from "../../lib/plugin-config-event";
import { SETTINGS_SCOPE } from "../../lib/unsaved/scopes";
import type { Locale } from "../../state/locale";
import { AdvancedFold } from "./advanced-fold";
import {
  baselineOf,
  drawnFields,
  sameValue,
  switchedOff,
  typedDraftOf,
  valueOf,
} from "./plugin-config-draft";
import type { Draft } from "./plugin-config-draft";
import { ConfigField } from "./plugin-config-field";
import { ConfigHeading } from "./plugin-config-heading";

/** A card's draft: each member entry's typed fields, and the secrets the next Save clears. */
export interface CardDraft {
  drafts: Record<string, Draft>;
  /** `<plugin>\0<field>` of every secret whose stored value the next Save drops. */
  clearing: string[];
}

const keyOf = (entry: string, field: string) => `${entry}\0${field}`;

const typedFields = (entry: PluginConfigEntry): Array<[string, PluginConfigField]> =>
  Object.entries(entry.configuration.properties).filter(([, field]) => field.type !== "boolean");

/** The draft the card's members start from: what is stored, every secret empty. */
export function cardDraftOf(members: readonly PluginConfigEntry[]): CardDraft {
  return {
    drafts: Object.fromEntries(members.map((e) => [e.name, typedDraftOf(e)])),
    clearing: [],
  };
}

/** A secret as typed: blank keeps what is stored. */
const typedSecret = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** What a Save of this draft would send, field by field: what dirtiness compares. */
function sentForm(members: readonly PluginConfigEntry[], draft: CardDraft): unknown {
  return {
    values: Object.fromEntries(
      members.map((entry) => [
        entry.name,
        Object.fromEntries(
          typedFields(entry).map(([name, field]) => {
            const typed = draft.drafts[entry.name]?.[name];
            return [name, field.type === "secret" ? typedSecret(typed) : valueOf(field, typed)];
          }),
        ),
      ]),
    ),
    clearing: [...draft.clearing].sort(),
  };
}

/**
 * The number boxes of the draft that hold no finite number, as `<plugin>\0<field>`: Save waits
 * while there is one. (A browser's own number box hands over "" rather than text it cannot
 * parse, so this guards what a draft can hold, not what is usually typed.)
 */
export function unparsedNumbers(members: readonly PluginConfigEntry[], draft: CardDraft): string[] {
  return members.flatMap((entry) =>
    typedFields(entry)
      .filter(([name, field]) => {
        const v = valueOf(field, draft.drafts[entry.name]?.[name]);
        return field.type === "number" && typeof v === "number" && !Number.isFinite(v);
      })
      .map(([name]) => keyOf(entry.name, name)),
  );
}

/**
 * The update one entry's draft makes, or `null` when it changes nothing. Only what changed is
 * sent: an untouched field would store its default as a value, pinning it against a later
 * change of the default.
 */
function updateOf(entry: PluginConfigEntry, draft: CardDraft): Record<string, unknown> | null {
  const own = draft.drafts[entry.name] ?? {};
  const values: Record<string, unknown> = {};
  for (const [name, field] of typedFields(entry)) {
    if (field.type === "secret") {
      const typed = typedSecret(own[name]);
      if (typed !== "") values[name] = typed;
      else if (draft.clearing.includes(keyOf(entry.name, name))) values[name] = null;
      continue;
    }
    const v = valueOf(field, own[name]);
    if (!sameValue(v, baselineOf(field, entry.values[name]))) values[name] = v;
  }
  return Object.keys(values).length > 0 ? values : null;
}

/** The draft with the saved entries' parts reset to what they now store. */
function withSaved(draft: CardDraft, saved: readonly PluginConfigEntry[]): CardDraft {
  return {
    drafts: { ...draft.drafts, ...cardDraftOf(saved).drafts },
    clearing: draft.clearing.filter((k) => !saved.some((e) => k.startsWith(`${e.name}\0`))),
  };
}

export interface PluginCardProps {
  /** The card's own entry, then the entries drawn inside it. */
  members: readonly PluginConfigEntry[];
  /** The machine whose settings are on screen: null for this server. */
  machine: string | null;
  /** What on the page is mid-write (a card's save, a switch, an action); everything waits for it. */
  busy: string | null;
  setBusy: (busy: string | null) => void;
  locale: Locale;
  /** One entry's stored state changed: the page takes it as the new truth. */
  onStored: (entry: PluginConfigEntry) => void;
  /** The server answered with every entry: the page takes them all. */
  onStoredAll: (entries: PluginConfigEntry[]) => void;
  /** A group action's button: the page asks before it runs. */
  onAction: (entry: PluginConfigEntry, action: string) => void;
  /** An entry's `switch` was turned on (and stored). */
  onSwitchedOn: (entry: PluginConfigEntry) => void;
}

export function PluginCard({
  members,
  machine,
  busy,
  setBusy,
  locale,
  onStored,
  onStoredAll,
  onAction,
  onSwitchedOn,
}: PluginCardProps) {
  const card = members[0]!;
  const form = useFormDraft(cardDraftOf(members), {
    scope: SETTINGS_SCOPE,
    normalize: (draft) => sentForm(members, draft),
  });
  /** Fields the server refused at the last save, by `<plugin>\0<field>` (a table's cells by `.row.column`). */
  const [refused, setRefused] = useState<Record<string, string>>({});
  /** Switches mid-write, at the position they were flipped to. */
  const [flipping, setFlipping] = useState<Record<string, boolean>>({});

  const unparsed = unparsedNumbers(members, form.draft);
  const errors: Record<string, string> = { ...refused };
  for (const key of unparsed) errors[key] = S.settings.pluginFieldNotNumber;

  /** A boolean field as it stands: the position it is being flipped to, else the stored one. */
  const switchValue = (entry: PluginConfigEntry, name: string) =>
    flipping[keyOf(entry.name, name)] ?? entry.values[name] === true;

  /** An entry as drawn: its typed draft with its switches as they stand. */
  const viewOf = (entry: PluginConfigEntry): Draft => {
    const view: Draft = { ...(form.draft.drafts[entry.name] ?? {}) };
    for (const [name, field] of Object.entries(entry.configuration.properties)) {
      if (field.type === "boolean") view[name] = switchValue(entry, name);
    }
    return view;
  };

  const patch = (entry: string, name: string, value: unknown) => {
    form.setDraft((prev) => ({
      ...prev,
      drafts: { ...prev.drafts, [entry]: { ...(prev.drafts[entry] ?? {}), [name]: value } },
    }));
    setRefused((prev) => {
      const next = { ...prev };
      delete next[keyOf(entry, name)];
      return next;
    });
  };

  const setClearing = (key: string, on: boolean) =>
    form.setDraft((prev) => ({
      ...prev,
      clearing: on ? [...new Set([...prev.clearing, key])] : prev.clearing.filter((k) => k !== key),
    }));

  /** A switch: its own value, to its own entry, now. */
  const flip = async (entry: PluginConfigEntry, name: string, next: boolean) => {
    if (busy !== null) return;
    const key = keyOf(entry.name, name);
    setFlipping((prev) => ({ ...prev, [key]: next }));
    setBusy(key);
    try {
      const res = await api.adminPutPluginConfig(
        { name: entry.name, values: { [name]: next } },
        machine,
      );
      const stored = res.plugins.find((e) => e.name === entry.name);
      if (stored !== undefined) onStored(stored);
      else onStoredAll(res.plugins);
      dispatchPluginConfigSaved({ group: entry.name, card: card.name });
      if (next && name === entry.configuration.switch) onSwitchedOn(stored ?? entry);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setFlipping((prev) => {
        const rest = { ...prev };
        delete rest[key];
        return rest;
      });
      setBusy(null);
    }
  };

  /** Saves the card: each changed entry in its own PUT, stopping at the first refusal. */
  const save = async () => {
    if (busy !== null || !form.dirty || unparsed.length > 0) return;
    const draft = form.draft;
    const updates = members.flatMap((entry) => {
      const update = updateOf(entry, draft);
      return update === null ? [] : [[entry, update] as const];
    });
    setBusy(card.name);
    setRefused({});
    const saved: PluginConfigEntry[] = [];
    try {
      for (const [entry, values] of updates) {
        try {
          const res = await api.adminPutPluginConfig({ name: entry.name, values }, machine);
          const stored = res.plugins.find((e) => e.name === entry.name);
          if (stored !== undefined) {
            onStored(stored);
            saved.push(stored);
          } else onStoredAll(res.plugins);
        } catch (e) {
          // A rejected field is named in the message as `"field" …`; it renders under that field.
          const named =
            e instanceof ApiError && e.code === "plugin_config_invalid"
              ? /^"([^"]+)"/.exec(e.message)?.[1]
              : undefined;
          if (named !== undefined) setRefused({ [keyOf(entry.name, named)]: apiErrorText(e) });
          else toastError(apiErrorText(e));
          // What did land is stored now; the rest of the draft stays, still unsaved.
          if (saved.length > 0) form.setDraft((prev) => withSaved(prev, saved));
          return;
        }
      }
      form.adopt(withSaved(draft, saved));
      toastSuccess(S.common.saved);
      // Pages showing what the card configures (the composer's permission menu) read it again.
      for (const [entry] of updates) {
        dispatchPluginConfigSaved({ group: entry.name, card: card.name });
      }
    } finally {
      setBusy(null);
    }
  };

  const control = (entry: PluginConfigEntry, name: string, field: PluginConfigField) => {
    const key = keyOf(entry.name, name);
    const own = form.draft.drafts[entry.name];
    const choiceField = field.rowChoice?.field;
    const isSwitch = field.type === "boolean";
    return (
      <ConfigField
        key={name}
        entry={entry}
        name={name}
        field={field}
        value={isSwitch ? switchValue(entry, name) : own?.[name]}
        error={errors[key]}
        // A refused cell is named `<field>.<row>.<column>`; the table lists them under itself.
        tableErrors={Object.entries(errors)
          .filter(([k]) => k === key || k.startsWith(`${key}.`))
          .map(([, text]) => text)}
        {...(choiceField !== undefined
          ? {
              choice: own?.[choiceField],
              onChoice: (row: string) => patch(entry.name, choiceField, row),
            }
          : {})}
        clearing={form.draft.clearing.includes(key)}
        onChange={(value) => {
          if (isSwitch) {
            void flip(entry, name, value === true);
            return;
          }
          patch(entry.name, name, value);
          // Typing a new secret is not also clearing it.
          if (field.type === "secret") setClearing(key, false);
        }}
        onClearingChange={(on) => setClearing(key, on)}
        disabled={busy !== null}
        locale={locale}
      />
    );
  };

  /** An entry's fields in declaration order: the basic ones, then the Advanced fold, if any. */
  const fields = (entry: PluginConfigEntry) => {
    const all = drawnFields(entry, viewOf(entry));
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

  const children = members.slice(1);
  return (
    <section
      data-plugin-config={card.name}
      className="space-y-3 rounded-md border border-gray-200 p-4 dark:border-gray-800"
    >
      <ConfigHeading
        entry={card}
        draft={viewOf(card)}
        nested={false}
        disabled={busy !== null}
        onAction={(action) => onAction(card, action)}
        locale={locale}
      />
      {fields(card)}
      {(switchedOff(card, viewOf(card)) ? [] : children).map((child) => (
        <div
          key={child.name}
          className="space-y-3 border-t border-gray-100 pt-3 dark:border-gray-800/60"
        >
          <ConfigHeading
            entry={child}
            draft={viewOf(child)}
            nested
            disabled={busy !== null}
            onAction={(action) => onAction(child, action)}
            locale={locale}
          />
          {fields(child)}
        </div>
      ))}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          size="sm"
          disabled={!form.dirty || busy !== null}
          onClick={() => {
            form.reset();
            setRefused({});
          }}
        >
          {S.common.reset}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!form.dirty || unparsed.length > 0 || busy !== null}
          onClick={() => void save()}
        >
          {busy === card.name ? S.common.saving : S.common.save}
        </Button>
      </div>
    </section>
  );
}

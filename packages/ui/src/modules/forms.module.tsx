/**
 * Forms: the Appearance and General settings as preference rows (segmented controls, swatches,
 * switches, a select), a dialog form with every field type (a select, an input with a leading affix,
 * a password, a textarea, a checkbox group, a radio group, a search field), the same form with two
 * field errors, and the settings with the rows a server policy holds disabled. The settings and the
 * dialog form are the reader's to fill in; the errors play how a sent form answers. Static
 * stand-ins for W2's form controls and `PrefRow`.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { fixturesFor } from "../fixtures";
import type { Fixtures, FormFieldFixture } from "../fixtures";
import { defineModule } from "../module";
import type { SceneSpec } from "../module";
import { reached, useScene } from "../scene";
import {
  Button,
  Checkbox,
  Field,
  GlyphIcon,
  Input,
  Modal,
  Notice,
  PrefRow,
  Radio,
  RuledSection,
  SearchInput,
  Segmented,
  Select,
  Switch,
  SwatchPicker,
} from "./parts";
import { isHostAndPath } from "./interaction";

/** What the Appearance and General rows hold. */
interface Prefs {
  theme: number;
  fontSize: number;
  accent: number;
  launcher: boolean;
  aliases: boolean;
  language: string;
  sendWith: number;
  notify: boolean;
}

/** The values the settings open on: the system theme, the middle size, the theme's own accent. */
function restingPrefs(f: Fixtures): Prefs {
  const auth = f.copy.auth;
  return {
    theme: 2,
    fontSize: 1,
    accent: 0,
    launcher: true,
    aliases: false,
    language: f.lang === "zh" ? auth.langZh : auth.langEn,
    sendWith: 0,
    notify: false,
  };
}

/**
 * The settings: the Appearance rows, then the General section — or, with `disabled`, the server
 * section a policy holds. Given `set`, every control is live and writes its row's value back; the
 * disabled rows stay held either way.
 */
function SettingsForm({
  f,
  disabled = false,
  prefs = restingPrefs(f),
  set,
}: {
  f: Fixtures;
  disabled?: boolean;
  prefs?: Prefs;
  set?: (patch: Partial<Prefs>) => void;
}) {
  const s = f.copy.settings;
  const auth = f.copy.auth;
  // The one field a server policy holds: shown, explained, not editable.
  const held = f.forms.fields.find((field) => field.disabled);
  const on = <K extends keyof Prefs>(key: K) =>
    set === undefined ? undefined : (value: Prefs[K]) => set({ [key]: value } as Partial<Prefs>);
  const appearance: readonly [string, ReactNode][] = [
    [
      "theme",
      <PrefRow
        label={s.theme}
        hint={s.themeInfo}
        control={
          <Segmented
            options={[s.light, s.dark, s.system]}
            value={prefs.theme}
            onChange={on("theme")}
          />
        }
      />,
    ],
    [
      "font-size",
      <PrefRow
        label={s.fontSize}
        control={
          <Segmented
            options={[s.fontSizes.sm, s.fontSizes.md, s.fontSizes.lg]}
            value={prefs.fontSize}
            onChange={on("fontSize")}
          />
        }
      />,
    ],
    [
      "accent",
      <PrefRow
        label={s.accent}
        control={
          <SwatchPicker value={prefs.accent} swatches={f.forms.swatches} onChange={on("accent")} />
        }
      />,
    ],
    [
      "launcher",
      <PrefRow
        label={s.launcher}
        hint={s.launcherInfo}
        control={<Switch on={prefs.launcher} label={s.launcher} onChange={on("launcher")} />}
      />,
    ],
    [
      "tool-aliases",
      <PrefRow
        label={s.toolAliases}
        info
        control={<Switch on={prefs.aliases} label={s.toolAliases} onChange={on("aliases")} />}
      />,
    ],
  ];
  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <RuledSection title={s.pages.appearance}>
        <div className="divide-y divide-line-muted">
          {appearance.map(([key, row]) => (
            <div key={key}>{row}</div>
          ))}
        </div>
      </RuledSection>
      {disabled ? (
        <RuledSection title={s.groupServer}>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
            <Notice tone="neutral" title={s.managedTitle}>
              {s.managedBody}
            </Notice>
            <div className="divide-y divide-line-muted">
              {held && (
                <PrefRow
                  label={held.label}
                  hint={held.hint}
                  control={<Input value={held.value} state="disabled" mono />}
                />
              )}
              <PrefRow
                label={s.pages.uploads}
                hint={s.uploadsInfo}
                control={<Segmented options={s.uploadSizes} value={1} disabled />}
              />
              <PrefRow label={s.pages.company} control={<Switch on disabled />} />
            </div>
          </div>
        </RuledSection>
      ) : (
        <RuledSection title={s.pages.general}>
          <div className="divide-y divide-line-muted">
            <PrefRow
              label={auth.language}
              control={
                <div className="w-40">
                  <Select
                    value={prefs.language}
                    options={[auth.langZh, auth.langEn]}
                    label={auth.language}
                    onValueChange={on("language")}
                  />
                </div>
              }
            />
            <PrefRow
              label={s.sendWith}
              control={
                <Segmented options={s.sendKeys} value={prefs.sendWith} onChange={on("sendWith")} />
              }
            />
            <PrefRow
              label={s.notify}
              hint={s.notifyInfo}
              control={<Switch on={prefs.notify} label={s.notify} onChange={on("notify")} />}
            />
          </div>
        </RuledSection>
      )}
    </div>
  );
}

/** The settings as the reader uses them: every row's control changes its value. */
function LiveSettings({ f }: { f: Fixtures }) {
  const [prefs, setPrefs] = useState(() => restingPrefs(f));
  return (
    <SettingsForm f={f} prefs={prefs} set={(patch) => setPrefs((now) => ({ ...now, ...patch }))} />
  );
}

/**
 * A live dialog form's hold on one field: its value, whether it has focus and whether it shows
 * its error, and the handlers the field reports through.
 */
interface FieldLive {
  value: string;
  focused: boolean;
  wrong: boolean;
  edit: (value: string) => void;
  focus: () => void;
  blur: () => void;
}

/**
 * One field of the dialog in its kind's control. `filled` is whether the invalid field holds a
 * value yet — before the form is filled in, its placeholder shows — and `errors` whether the form
 * has been sent and said what is wrong. A `live` field takes its value, focus and error from the
 * reader instead.
 */
function FormField({
  field,
  filled,
  errors,
  live,
}: {
  field: FormFieldFixture;
  filled: boolean;
  errors: boolean;
  live?: FieldLive;
}) {
  const invalid = field.error !== undefined;
  const value = live ? live.value : invalid && !filled ? "" : field.value;
  const wrong = live ? live.wrong : invalid && errors;
  const state = wrong ? "error" : live?.focused ? "focus" : "rest";
  const edits = live && { onValueChange: live.edit, onFocus: live.focus, onBlur: live.blur };
  const control =
    field.kind === "select" ? (
      <Select
        value={value}
        options={live && field.options}
        label={field.label}
        onValueChange={live?.edit}
      />
    ) : field.kind === "textarea" ? (
      <Input
        value={value}
        placeholder={field.placeholder}
        multiline
        state={live?.focused ? "focus" : "rest"}
        label={field.label}
        {...edits}
      />
    ) : (
      <Input
        value={value}
        placeholder={field.placeholder}
        leading={
          field.prefix === undefined ? undefined : (
            <span className="font-mono text-xs">{field.prefix}</span>
          )
        }
        trailing={field.kind === "password" ? <GlyphIcon name="eye" size={14} /> : undefined}
        state={state}
        type={live && field.kind === "password" ? "password" : "text"}
        label={field.label}
        mono
        {...edits}
      />
    );
  return (
    <Field
      label={field.label}
      required={field.required}
      hint={field.hint}
      error={wrong ? field.error : undefined}
    >
      {control}
    </Field>
  );
}

/** The live state of the dialog form, as `LiveDialogForm` keeps it. */
interface FormLive {
  field: (field: FormFieldFixture) => FieldLive;
  search: string;
  setSearch: (value: string) => void;
  checked: (group: number, choice: number) => boolean;
  choose: (group: number, choice: number) => void;
  submit: () => void;
}

function DialogForm({
  f,
  errors = false,
  filled = errors,
  live,
}: {
  f: Fixtures;
  errors?: boolean;
  /** Whether the fields hold their values; a form says what is wrong only once it is filled in. */
  filled?: boolean;
  /** The reader's hold on the form: values, focus, errors and the choices. */
  live?: FormLive;
}) {
  const form = f.forms;
  const [first, ...rest] = form.fields.filter((field) => !field.disabled);
  const wrong = live
    ? form.fields.some((field) => !field.disabled && live.field(field).wrong)
    : errors;
  return (
    <div className="flex justify-center">
      <Modal
        className="w-full max-w-xl"
        title={form.title}
        description={form.description}
        footer={
          <>
            {wrong && (
              <div className="mr-auto">
                <Notice tone="danger" variant="inline">
                  {form.errorSummary}
                </Notice>
              </div>
            )}
            <Button variant="secondary" size="sm">
              {form.cancel}
            </Button>
            <Button
              variant="primary"
              size="sm"
              state={wrong ? "disabled" : "rest"}
              onClick={live?.submit}
            >
              {form.submit}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 px-5 py-2">
          <div className="grid grid-cols-2 gap-4">
            {first && (
              <FormField field={first} filled={filled} errors={errors} live={live?.field(first)} />
            )}
            <Field label={form.search.label}>
              <SearchInput
                placeholder={form.search.placeholder}
                value={live?.search}
                clearLabel={f.copy.common.remove}
                onValueChange={live?.setSearch}
              />
            </Field>
          </div>
          {rest.map((field) => (
            <FormField
              key={field.name}
              field={field}
              filled={filled}
              errors={errors}
              live={live?.field(field)}
            />
          ))}
          <div className="grid grid-cols-2 gap-4">
            {form.groups.map((group, g) => (
              <fieldset
                key={group.label}
                className="grid grid-cols-[minmax(0,1fr)] content-start gap-2"
              >
                <legend className="mb-2 text-sm font-(--ui-weight-medium) text-fg">
                  {group.label}
                </legend>
                {group.choices.map((choice, c) =>
                  group.kind === "checkboxes" ? (
                    <Checkbox
                      key={choice.label}
                      checked={live ? live.checked(g, c) : choice.checked}
                      label={choice.label}
                      hint={choice.hint}
                      onChange={live && (() => live.choose(g, c))}
                    />
                  ) : (
                    <Radio
                      key={choice.label}
                      checked={live ? live.checked(g, c) : choice.checked}
                      label={choice.label}
                      hint={choice.hint}
                      onChange={live && (() => live.choose(g, c))}
                    />
                  ),
                )}
              </fieldset>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}

/**
 * The dialog form as the reader fills it in. It opens as the still does — the base URL empty, no
 * error — and every field takes typing, the provider opens its list, and the boxes and options
 * toggle. The base URL is checked when it loses focus, and from then on as it is typed, so the
 * fixtures' error comes and goes with the value and holds the submit button while it shows;
 * pressing submit checks it at once.
 */
function LiveDialogForm({ f }: { f: Fixtures }) {
  const form = f.forms;
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      form.fields.map((field) => [field.name, field.error === undefined ? field.value : ""]),
    ),
  );
  const [checked, setChecked] = useState(() =>
    form.groups.map((group) => group.choices.map((choice) => choice.checked)),
  );
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const wrongValue = (field: FormFieldFixture) =>
    field.error !== undefined && !isHostAndPath(values[field.name] ?? "");
  const live: FormLive = {
    field: (field) => ({
      value: values[field.name] ?? "",
      focused: focused === field.name,
      wrong: touched.has(field.name) && wrongValue(field),
      edit: (value) => setValues((now) => ({ ...now, [field.name]: value })),
      focus: () => setFocused(field.name),
      blur: () => {
        setFocused(null);
        setTouched((now) => new Set(now).add(field.name));
      },
    }),
    search,
    setSearch,
    checked: (g, c) => checked[g]?.[c] === true,
    choose: (g, c) =>
      setChecked((now) =>
        now.map((choices, i) =>
          i !== g
            ? choices
            : form.groups[g]?.kind === "radios"
              ? choices.map((_, j) => j === c)
              : choices.map((on, j) => (j === c ? !on : on)),
        ),
      ),
    submit: () =>
      setTouched(new Set(form.fields.filter((field) => field.error).map((field) => field.name))),
  };
  return <DialogForm f={f} live={live} />;
}

const VALIDATE: SceneSpec = {
  frames: [
    { key: "filled", title: "Filled", hold: 1400 },
    { key: "errors", title: "Errors", hold: 1600 },
  ],
};

/**
 * The same dialog, filled in and sent: the fields hold their values with the form still willing to
 * take them; then it is sent, the two that do not pass say what is wrong and the submit button is
 * held — the state this variant shows when nothing is playing.
 */
function Validate({ f }: { f: Fixtures }) {
  const clock = useScene();
  return <DialogForm f={f} filled errors={reached(clock, "errors")} />;
}

const VARIANTS = {
  settings: (f: Fixtures) => <LiveSettings f={f} />,
  "dialog-form": (f: Fixtures) => <LiveDialogForm f={f} />,
  errors: (f: Fixtures) => <Validate f={f} />,
  disabled: (f: Fixtures) => <SettingsForm f={f} disabled />,
} as const;

export const module = defineModule({
  id: "forms",
  title: "Forms",
  description:
    "The Appearance and General settings as preference rows, and a dialog form with every field type, its errors and its disabled state.",
  width: "wide",
  variants: [
    { key: "settings", title: "Settings", kind: "interactive" },
    { key: "dialog-form", title: "Dialog form", kind: "interactive" },
    { key: "errors", title: "Errors", kind: "animated", scene: VALIDATE },
    { key: "disabled", title: "Disabled", kind: "static" },
  ],
  parts: [
    "forms-field",
    "forms-input",
    "forms-select",
    "forms-picker-list",
    "forms-checkbox",
    "forms-radio",
    "forms-switch",
    "forms-toggle-row",
    "forms-segmented",
    "forms-search-input",
    "forms-swatch-picker",
    "forms-pref-row",
    "layout-ruled-section",
  ],
  render: (variant, { lang }) =>
    (VARIANTS[variant as keyof typeof VARIANTS] ?? VARIANTS.settings)(fixturesFor(lang)),
});

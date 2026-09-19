/**
 * Forms: the Appearance and General settings as preference rows (segmented controls, swatches,
 * switches, a select), a dialog form with every field type (a select, an input with a leading affix,
 * a password, a textarea, a checkbox group, a radio group, a search field), the same form with two
 * field errors, and the settings with the rows a server policy holds disabled. Static stand-ins for
 * W2's form controls and `PrefRow`.
 */
import { fixturesFor } from "../fixtures";
import type { Fixtures, FormFieldFixture } from "../fixtures";
import { defineModule } from "../module";
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

function SettingsForm({ f, disabled = false }: { f: Fixtures; disabled?: boolean }) {
  const s = f.copy.settings;
  const auth = f.copy.auth;
  // The one field a server policy holds: shown, explained, not editable.
  const held = f.forms.fields.find((field) => field.disabled);
  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <RuledSection title={s.pages.appearance}>
        <div className="divide-y divide-line-muted">
          <PrefRow
            label={s.theme}
            hint={s.themeInfo}
            control={<Segmented options={[s.light, s.dark, s.system]} value={2} />}
          />
          <PrefRow
            label={s.fontSize}
            control={
              <Segmented options={[s.fontSizes.sm, s.fontSizes.md, s.fontSizes.lg]} value={1} />
            }
          />
          <PrefRow
            label={s.accent}
            control={<SwatchPicker value={0} swatches={f.forms.swatches} />}
          />
          <PrefRow label={s.launcher} hint={s.launcherInfo} control={<Switch on />} />
          <PrefRow label={s.toolAliases} info control={<Switch on={false} />} />
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
                  <Select value={f.lang === "zh" ? auth.langZh : auth.langEn} />
                </div>
              }
            />
            <PrefRow label={s.sendWith} control={<Segmented options={s.sendKeys} value={0} />} />
            <PrefRow label={s.notify} hint={s.notifyInfo} control={<Switch on={false} />} />
          </div>
        </RuledSection>
      )}
    </div>
  );
}

/**
 * One field of the dialog in its kind's control. Before the form is sent the invalid field is
 * still empty (its placeholder shows); after, it holds the wrong value and says what is wrong.
 */
function FormField({ field, errors }: { field: FormFieldFixture; errors: boolean }) {
  const invalid = field.error !== undefined;
  const value = invalid && !errors ? "" : field.value;
  const control =
    field.kind === "select" ? (
      <Select value={value} />
    ) : field.kind === "textarea" ? (
      <Input value={value} placeholder={field.placeholder} multiline />
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
        state={invalid && errors ? "error" : "rest"}
        mono
      />
    );
  return (
    <Field
      label={field.label}
      required={field.required}
      hint={field.hint}
      error={errors ? field.error : undefined}
    >
      {control}
    </Field>
  );
}

function DialogForm({ f, errors = false }: { f: Fixtures; errors?: boolean }) {
  const form = f.forms;
  const [first, ...rest] = form.fields.filter((field) => !field.disabled);
  return (
    <div className="flex justify-center">
      <Modal
        className="w-full max-w-xl"
        title={form.title}
        description={form.description}
        footer={
          <>
            {errors && (
              <div className="mr-auto">
                <Notice tone="danger" variant="inline">
                  {form.errorSummary}
                </Notice>
              </div>
            )}
            <Button variant="secondary" size="sm">
              {form.cancel}
            </Button>
            <Button variant="primary" size="sm" state={errors ? "disabled" : "rest"}>
              {form.submit}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 px-5 py-2">
          <div className="grid grid-cols-2 gap-4">
            {first && <FormField field={first} errors={errors} />}
            <Field label={form.search.label}>
              <SearchInput placeholder={form.search.placeholder} />
            </Field>
          </div>
          {rest.map((field) => (
            <FormField key={field.name} field={field} errors={errors} />
          ))}
          <div className="grid grid-cols-2 gap-4">
            {form.groups.map((group) => (
              <fieldset
                key={group.label}
                className="grid grid-cols-[minmax(0,1fr)] content-start gap-2"
              >
                <legend className="mb-2 text-sm font-(--ui-weight-medium) text-fg">
                  {group.label}
                </legend>
                {group.choices.map((choice) =>
                  group.kind === "checkboxes" ? (
                    <Checkbox
                      key={choice.label}
                      checked={choice.checked}
                      label={choice.label}
                      hint={choice.hint}
                    />
                  ) : (
                    <Radio
                      key={choice.label}
                      checked={choice.checked}
                      label={choice.label}
                      hint={choice.hint}
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

const VARIANTS = {
  settings: (f: Fixtures) => <SettingsForm f={f} />,
  "dialog-form": (f: Fixtures) => <DialogForm f={f} />,
  errors: (f: Fixtures) => <DialogForm f={f} errors />,
  disabled: (f: Fixtures) => <SettingsForm f={f} disabled />,
} as const;

export const module = defineModule({
  id: "forms",
  title: "Forms",
  description:
    "The Appearance and General settings as preference rows, and a dialog form with every field type, its errors and its disabled state.",
  width: "wide",
  variants: [
    { key: "settings", title: "Settings" },
    { key: "dialog-form", title: "Dialog form" },
    { key: "errors", title: "Errors" },
    { key: "disabled", title: "Disabled" },
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

/**
 * 选择器: the package's Select, Segmented, Slider, ChoiceGroup, Switch, ToggleRow, SwatchPicker,
 * OptionMenu and Dropdown, each holding its own choice, and the Menu rows at both densities. The
 * control sizes group sets a Select beside an Input and a Button of the same rung: one row, one
 * height. The choice groups show every shape and mode — chips that act on a press, chips that
 * toggle, cards led by the disc with a muted "Other…", checkbox cards — and an answered one, closed.
 */
import { useState } from "react";
import type { ChoiceGroupOption, ControlSize } from "@prismshadow/penguin-ui";
import {
  ACCENT_PRESETS,
  Button,
  ChevronDown,
  ChoiceGroup,
  Dropdown,
  FieldLegend,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Input,
  Menu,
  MenuItem,
  MenuLabel,
  MenuRadioItem,
  MenuSeparator,
  OptionMenu,
  Pill,
  Segmented,
  Select,
  Slider,
  SwatchPicker,
  Switch,
  ToggleRow,
  menuPanelClass,
} from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

/** The value of the "Other…" entry, which no listed option takes. */
const OTHER = "other";

export function PickersBoard() {
  const { S, state } = useGallery();
  const t = S.library.pickers;
  const [model, setModel] = useState(t.options[0] ?? "");
  const [segment, setSegment] = useState(t.segments[0] ?? "");
  const [notify, setNotify] = useState(true);
  const [shortNames, setShortNames] = useState(false);
  const [launcher, setLauncher] = useState(true);
  const [proxy, setProxy] = useState(false);
  const [memory, setMemory] = useState(true);
  const swatches = ACCENT_PRESETS[state.theme].map((preset) => ({
    value: preset.id as string,
    color: preset.swatch,
    label: preset.id,
  }));
  const [swatch, setSwatch] = useState(swatches[0]?.value ?? "");
  const [permission, setPermission] = useState<string | null>(t.choices[1]?.value ?? null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [groupBy, setGroupBy] = useState<"workspace" | "agent">("workspace");
  const [sortBy, setSortBy] = useState<"recent" | "manual">("recent");
  const [share, setShare] = useState(60);
  const [temperature, setTemperature] = useState(0.7);
  const [merge, setMerge] = useState<string | null>(null);
  const [features, setFeatures] = useState<string[]>(["cdn", "logs"]);
  const [database, setDatabase] = useState<string | null>("pg");
  const [regions, setRegions] = useState<string[]>(["eu-west"]);
  const mergeOptions: ChoiceGroupOption[] = t.mergeOptions.map((label, i) => ({
    value: String(i),
    label:
      i === 0 ? (
        <span className="inline-flex items-center gap-1.5">
          {label}
          <Pill tone="info">{t.recommended}</Pill>
        </span>
      ) : (
        label
      ),
  }));
  const databases: ChoiceGroupOption[] = [
    ...t.databases,
    {
      value: OTHER,
      label: t.other,
      muted: true,
      // A pen in the disc's place: this one is written, not picked.
      lead: <GlyphIcon d={ICONS.penLine} size={ICON_SIZE.rowLead} />,
    },
  ];
  return (
    <div className="gf-board">
      <BoardGroup title={t.select}>
        <div className="lib-stack">
          <Select
            label={t.selectLabel}
            value={model}
            onChange={(event) => setModel(event.target.value)}
          >
            {t.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </div>
      </BoardGroup>
      <BoardGroup title={t.sizes}>
        <div className="lib-stack lib-stack-wide">
          {(["sm", "base"] as const satisfies readonly ControlSize[]).map((size) => (
            <div key={size}>
              <p className="lib-caption">{t.sizeRow(size)}</p>
              <div className="lib-row">
                <div className="w-44">
                  <Select
                    size={size}
                    aria-label={t.selectLabel}
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                  >
                    {t.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="w-44">
                  <Input size={size} aria-label={t.sizeSearch} placeholder={t.sizeSearch} />
                </div>
                {/* A button's sm and base rungs are the controls' own heights. */}
                <Button size={size} variant="primary">
                  {t.sizeButton}
                </Button>
                <Button size={size}>{t.sizeButton}</Button>
              </div>
            </div>
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.segmented}>
        <div className="lib-stack">
          <Segmented
            options={t.segments.map((label) => ({ value: label, label }))}
            value={segment}
            onChange={setSegment}
            cols={3}
          />
        </div>
      </BoardGroup>
      <BoardGroup title={t.slider}>
        <div className="lib-stack">
          <Slider
            label={t.sliderShare}
            min={0}
            max={100}
            step={5}
            unit={t.sliderUnit}
            value={share}
            onChange={setShare}
          />
          <Slider
            label={t.sliderTemperature}
            hint={t.sliderTemperatureHint}
            min={0}
            max={1}
            step={0.1}
            value={temperature}
            onChange={setTemperature}
          />
          <Slider
            label={t.sliderTopP}
            hint={t.sliderTopPHint}
            min={0}
            max={1}
            step={0.05}
            value={0.9}
            onChange={() => {}}
            disabled
          />
        </div>
      </BoardGroup>
      <BoardGroup title={t.choiceGroup}>
        <div className="lib-stack">
          {/* Acts on the press: one tab stop, resting on the recommended option. */}
          <fieldset className="min-w-0">
            <FieldLegend>{t.choiceMerge}</FieldLegend>
            <ChoiceGroup
              shape="chip"
              options={mergeOptions}
              value={merge}
              onChange={setMerge}
              initialStop="0"
            />
          </fieldset>
          <fieldset className="min-w-0">
            <FieldLegend>{t.choiceFeatures}</FieldLegend>
            <ChoiceGroup
              shape="chip"
              size="sm"
              multiple
              options={t.features}
              value={features}
              onChange={setFeatures}
            />
          </fieldset>
          <fieldset className="min-w-0">
            <FieldLegend>{t.choiceDatabase}</FieldLegend>
            <ChoiceGroup
              shape="card"
              options={databases}
              value={database}
              // "Other…" hands the answer to the reader's own words, so nothing stays pressed.
              onChange={(value) => setDatabase(value === OTHER ? null : value)}
            />
          </fieldset>
          <fieldset className="min-w-0">
            <FieldLegend>{t.choiceRegions}</FieldLegend>
            <ChoiceGroup
              shape="card"
              multiple
              options={t.regions}
              value={regions}
              onChange={setRegions}
            />
          </fieldset>
          {/* An answered question still on screen: every option closed. */}
          <fieldset className="min-w-0">
            <FieldLegend>{t.choiceAnswered}</FieldLegend>
            <ChoiceGroup
              shape="chip"
              options={mergeOptions}
              value="1"
              onChange={() => {}}
              disabled
            />
          </fieldset>
        </div>
      </BoardGroup>
      <BoardGroup title={t.switches}>
        <div className="lib-stack">
          <label className="ui-field flex items-center justify-between gap-4">
            <span>
              <span className="block">{t.switchLabel}</span>
              <span className="lib-caption">{t.switchHint}</span>
            </span>
            <Switch checked={notify} onChange={setNotify} />
          </label>
          <label className="ui-field flex items-center justify-between gap-4">
            <span>{t.switchOff}</span>
            <Switch checked={shortNames} onChange={setShortNames} />
          </label>
        </div>
      </BoardGroup>
      <BoardGroup title={t.toggleRows}>
        <div className="lib-stack">
          {/* The three frames: a ruled settings list, a spaced stack, a panel's master switch. */}
          <div className="divide-y divide-line-muted">
            <ToggleRow
              label={t.toggleRowLabel}
              info={t.toggleRowInfo}
              checked={launcher}
              onChange={setLauncher}
            />
            <ToggleRow label={t.switchOff} checked={shortNames} onChange={setShortNames} />
          </div>
          <ToggleRow
            variant="plain"
            label={t.togglePlainLabel}
            hint={t.togglePlainHint}
            checked={proxy}
            onChange={setProxy}
          />
          <ToggleRow
            variant="card"
            label={t.toggleCardLabel}
            checked={memory}
            onChange={setMemory}
          />
        </div>
      </BoardGroup>
      <BoardGroup title={t.swatches}>
        <div className="lib-row">
          <SwatchPicker
            options={swatches}
            value={swatches.some((option) => option.value === swatch) ? swatch : ""}
            onChange={setSwatch}
          />
        </div>
      </BoardGroup>
      <BoardGroup title={t.optionMenu}>
        <div className="lib-stack">
          <OptionMenu
            label={t.optionLabel}
            mono
            options={t.choices.map((choice) => ({
              value: choice.value,
              triggerLabel: choice.trigger,
              label: choice.label,
              description: choice.description,
            }))}
            value={permission}
            onChange={setPermission}
          />
        </div>
      </BoardGroup>
      <BoardGroup title={t.dropdown}>
        <div className="lib-row">
          <Dropdown
            open={menuOpen}
            setOpen={setMenuOpen}
            button={
              <Button
                size="sm"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(!menuOpen)}
              >
                <span>{t.menu}</span>
                <ChevronDown />
              </Button>
            }
          >
            <Menu>
              <MenuItem glyph={ICONS.pin} label={t.menuPin} onSelect={() => setMenuOpen(false)} />
              <MenuItem
                glyph={ICONS.pencil}
                label={t.menuRename}
                onSelect={() => setMenuOpen(false)}
              />
              <MenuItem label={t.menuMove} onSelect={() => setMenuOpen(false)} />
              <MenuSeparator />
              <MenuItem
                glyph={ICONS.trash}
                label={t.menuDelete}
                danger
                onSelect={() => setMenuOpen(false)}
              />
            </Menu>
          </Dropdown>
        </div>
      </BoardGroup>
      <BoardGroup title={t.menuRows} aside={t.menuRowsHint}>
        {/* The rows as an open panel shows them, side by side: the body rung, then the small. */}
        <div className="lib-row items-start">
          <div className={`${menuPanelClass} w-56`}>
            <Menu density="md">
              <MenuItem label={t.menuSettings} />
              <MenuItem label={t.menuAppInfo} trailing={t.menuVersion} />
              <MenuItem label={t.menuSignOut} danger />
            </Menu>
          </div>
          <div className={`${menuPanelClass} w-44`}>
            <Menu density="sm">
              <MenuLabel>{t.menuGroupBy}</MenuLabel>
              <MenuRadioItem
                glyph={ICONS.folder}
                label={t.menuByWorkspace}
                checked={groupBy === "workspace"}
                onSelect={() => setGroupBy("workspace")}
              />
              <MenuRadioItem
                glyph={ICONS.robot}
                label={t.menuByAgent}
                checked={groupBy === "agent"}
                onSelect={() => setGroupBy("agent")}
              />
              <MenuSeparator />
              <MenuLabel>{t.menuSortBy}</MenuLabel>
              <MenuRadioItem
                glyph={ICONS.clock}
                label={t.menuRecent}
                checked={sortBy === "recent"}
                onSelect={() => setSortBy("recent")}
              />
              <MenuRadioItem
                glyph={ICONS.arrowUpDown}
                label={t.menuManual}
                checked={sortBy === "manual"}
                onSelect={() => setSortBy("manual")}
              />
            </Menu>
          </div>
        </div>
      </BoardGroup>
    </div>
  );
}

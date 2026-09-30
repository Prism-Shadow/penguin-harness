/**
 * 选择器: the package's Select, Segmented, Switch, ToggleRow, SwatchPicker and OptionMenu, and the
 * app's Dropdown, each holding its own choice.
 */
import { useState } from "react";
import {
  ACCENT_PRESETS,
  Button,
  ChevronDown,
  OptionMenu,
  Segmented,
  Select,
  SwatchPicker,
  Switch,
  ToggleRow,
} from "@prismshadow/penguin-ui";
import { Dropdown, menuItemClass } from "../../../../web/src/components/ui/dropdown";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

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
            {t.menuItems.map((item) => (
              <button
                key={item}
                type="button"
                role="menuitem"
                className={menuItemClass}
                onClick={() => setMenuOpen(false)}
              >
                {item}
              </button>
            ))}
          </Dropdown>
        </div>
      </BoardGroup>
    </div>
  );
}

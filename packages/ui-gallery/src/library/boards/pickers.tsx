/** 选择器: the app's Select, Segmented, Switch, OptionMenu and Dropdown, each holding its own choice. */
import { useState } from "react";
import { Button } from "../../../../web/src/components/ui/button";
import { Dropdown, menuItemClass } from "../../../../web/src/components/ui/dropdown";
import { ChevronDown } from "../../../../web/src/components/ui/icons";
import { OptionMenu } from "../../../../web/src/components/ui/option-menu";
import { Segmented } from "../../../../web/src/components/ui/segmented";
import { Select } from "../../../../web/src/components/ui/select";
import { Switch } from "../../../../web/src/components/ui/switch";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

export function PickersBoard() {
  const { S } = useGallery();
  const t = S.library.pickers;
  const [model, setModel] = useState(t.options[0] ?? "");
  const [segment, setSegment] = useState(t.segments[0] ?? "");
  const [notify, setNotify] = useState(true);
  const [shortNames, setShortNames] = useState(false);
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

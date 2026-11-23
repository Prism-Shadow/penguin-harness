import { createRoot } from "react-dom/client";
import { useState } from "react";
import { FormPicker, MenuSelectBody, ModelSelect } from "@prismshadow/penguin-ui";

export type Model = { provider: string; modelId: string; label?: string };

export function mountModelControl(element: HTMLElement, choose: () => void) {
  const root = createRoot(element);
  return (
    model: Model | null,
    label: string,
    name: string,
    disabled: boolean,
    expanded: boolean,
  ) => {
    const display = model?.label || model?.modelId || label;
    element.title = name + " · " + display;
    root.render(
      <ModelSelect
        label={display}
        provider={model?.provider ?? null}
        ariaLabel={name + " · " + display}
        tooltip={name + " · " + display}
        variant="form"
        disabled={disabled}
        muted={!model}
        expanded={expanded}
        onClick={choose}
      />,
    );
  };
}

type Thinking = {
  defaultLevel: string;
  title: string;
  names: Record<string, string>;
  options: Array<{ value: string; label: string }>;
};

function EffortControl({
  levels,
  value,
  disabled,
  pick,
}: {
  levels: Thinking;
  value: string;
  disabled: boolean;
  pick: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const name = levels.names[value] ?? value;
  return (
    <FormPicker
      open={open}
      setOpen={setOpen}
      disabled={disabled}
      label={name}
      ariaLabel={levels.title + " · " + name}
      menuClass="w-max min-w-36"
    >
      <MenuSelectBody
        title={levels.title}
        options={levels.options}
        value={value}
        onPick={(level) => {
          setOpen(false);
          pick(level);
        }}
      />
    </FormPicker>
  );
}

export function mountEffortControl(element: HTMLElement, pick: (value: string) => void) {
  const root = createRoot(element);
  return (levels: Thinking | null, pin: string | null, disabled: boolean) => {
    root.render(
      levels && (
        <EffortControl
          levels={levels}
          value={pin || levels.defaultLevel}
          disabled={disabled}
          pick={pick}
        />
      ),
    );
  };
}

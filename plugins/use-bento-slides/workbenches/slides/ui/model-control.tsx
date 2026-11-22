import { createRoot } from "react-dom/client";
import { ModelSelect } from "@prismshadow/penguin-ui";

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

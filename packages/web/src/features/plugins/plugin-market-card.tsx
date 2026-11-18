import type { ReactNode } from "react";
import { CoverCard } from "@prismshadow/penguin-ui";
import "./plugin-market-card.css";

interface MarketAction {
  label: string;
  disabled: boolean;
  onClick: () => void;
  hint?: string | undefined;
}

interface MarketPluginCardProps {
  layout: "row" | "cover";
  title: string;
  description: string;
  cover: ReactNode;
  icon: ReactNode;
  onOpen: () => void;
  detailsLabel: string;
  install: MarketAction;
  quick: MarketAction;
  name?: string | undefined;
}

export function MarketPluginCard({
  layout,
  title,
  description,
  cover,
  icon,
  onOpen,
  detailsLabel,
  install,
  quick,
  name,
}: MarketPluginCardProps) {
  return (
    <CoverCard
      className="market-plugin-card"
      data-plugin={name}
      data-market-layout={layout}
      aria-label={title}
      cover={layout === "cover" ? cover : icon}
      title={title}
      titleHint={detailsLabel}
      description={description}
      onOpen={onOpen}
    >
      <div className="market-plugin-actions">
        {[install, quick].map((action, index) => (
          <button
            type="button"
            key={index}
            disabled={action.disabled}
            aria-label={action.label + " · " + title}
            data-tooltip={action.hint}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
      </div>
    </CoverCard>
  );
}

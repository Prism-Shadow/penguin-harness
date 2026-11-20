/**
 * The plugin market's card: the UI package's `CoverCard` with its version chip and its bar of two
 * one-line text actions, install and quick start. In the list layout the card is one compact row
 * led by the plugin's icon instead of its cover, the two actions at the row's end. This module
 * only maps a plugin's facts onto the card; the look is the showcase family's (showcase.css), the
 * same card the public catalog draws.
 */
import type { ReactNode } from "react";
import { CoverCard } from "@prismshadow/penguin-ui";

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
  version?: string | undefined;
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
  version,
}: MarketPluginCardProps) {
  return (
    <CoverCard
      data-plugin={name}
      aria-label={title}
      cover={layout === "cover" ? cover : icon}
      title={title}
      titleHint={detailsLabel}
      description={description}
      onOpen={onOpen}
      {...(version ? { version: `v${version}` } : {})}
      bar={[
        { key: "install", ...install },
        { key: "quick", ...quick },
      ]}
    />
  );
}

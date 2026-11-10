/**
 * Modular `<figure>` adapter for blog posts (`MD_COMPONENTS.figure` in `pages/blog-post.tsx`).
 *
 * Ordinary drawn figures (`<figure class="post-figure" data-figure="…">`) pass straight through
 * untouched. When a post carries `data-widget="<id>"`, the matching interactive component mounts
 * above the figure's `<ol class="fig-steps">` and `<figcaption>`.
 */
import type { ComponentPropsWithoutRef } from "react";
import type { ExtraProps } from "react-markdown";
import { SuperAgentArchitectureWidget } from "./super-agent-architecture";
import { AgentTakeoverEvolutionWidget } from "./agent-takeover-evolution";
import { SkillAdamWidget } from "./gdpevo-skilladam";
import { GdpevoOrchestrationWidget } from "./gdpevo-orchestration";

type MdFigureProps = ComponentPropsWithoutRef<"figure"> &
  ExtraProps & {
    "data-widget"?: string;
  };

export function MdFigure({ node: _node, children, ...figureProps }: MdFigureProps) {
  const widget = figureProps["data-widget"];
  return (
    <figure {...figureProps}>
      {widget === "super-agent-architecture" && <SuperAgentArchitectureWidget />}
      {widget === "agent-takeover-evolution" && <AgentTakeoverEvolutionWidget />}
      {widget === "skilladam-loop" && <SkillAdamWidget />}
      {widget === "gdpevo-orchestration" && <GdpevoOrchestrationWidget />}
      {children}
    </figure>
  );
}

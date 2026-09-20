/**
 * The demo contract: what a `<name>.demo.tsx` beside a component exports for the gallery.
 *
 *   // components/actions/button/button.demo.tsx
 *   export const demo = defineDemo({
 *     id: "actions-button",                  // = its catalog.ts section id
 *     title: "Button",
 *     description: "Five variants, five sizes, loading and disabled.",
 *     axes: { variant: ["primary", "secondary", "danger"], size: ["sm", "md"] },
 *     matrix: true,
 *     tokensUsed: ["--ui-accent", "--ui-accent-fg", "--ui-radius-md"],
 *     render: ({ variant, size }, { lang }) => <Button variant={variant} size={size}>…</Button>,
 *   });
 *
 * The gallery collects every `*.demo.tsx` under `src/` with `import.meta.glob`, orders them by
 * `catalog.ts`, and renders one preview card per demo with a pill row per axis. A selection is
 * addressed by its variant key — the chosen axis values joined with `.` in declaration order
 * (`danger.sm`) — so axis values are lowercase words and digits joined by `-`, never a `.`.
 *
 * `render` receives the selection and the context separately, so an axis may be named anything
 * without shadowing a context field. Hover and focus are axis values the component honours through
 * `data-state` attributes, never real pointer state, so screenshots reproduce them.
 */
import type { ReactNode } from "react";
import type { ThemeModeName, TokenName } from "./tokens";

/** Axis name → its values, first value = the default. */
export type DemoAxes = Readonly<Record<string, readonly string[]>>;

/** One value per axis. */
export type DemoSelection<A extends DemoAxes> = { readonly [K in keyof A]: A[K][number] };

/**
 * What the gallery tells a demo about the frame it renders in. The theme is deliberately absent: a
 * demo renders the same markup in every theme, exactly like the component it shows.
 */
export interface DemoContext {
  lang: "en" | "zh";
  mode: ThemeModeName;
}

export interface Demo<A extends DemoAxes = DemoAxes> {
  /** The catalog section id this demo fills. */
  id: string;
  title: string;
  description: string;
  axes?: A;
  /** Offer an "all" pill that renders every combination at once — the fastest theme review. */
  matrix?: boolean;
  /** The contract tokens the component reads, listed in the section's token drawer. */
  tokensUsed?: readonly TokenName[];
  /** Method syntax on purpose: a `Demo<{ size: … }>` must still be assignable to `Demo`. */
  render(selection: DemoSelection<A>, context: DemoContext): ReactNode;
}

/** Identity, for inference: the axes' literal values type the selection `render` receives. */
export function defineDemo<const A extends DemoAxes>(demo: Demo<A>): Demo<A> {
  return demo;
}

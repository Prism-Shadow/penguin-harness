/**
 * The sidebar's slots for a web module that waits for its server module (lib/module-gate.ts):
 * the contributions with every drawn part following the gate, applied by the sidebar module at
 * boot.
 *
 * - A section's block, overlays and rail form draw nothing while its module is not shown. Its
 *   `Scope` wraps the whole column, which turning on and off would remount, so a gated module's
 *   scope is never mounted (said once on the console); the column renders without it.
 * - A mode is not offered (`available: false`) while its module is not shown; its rail entry and
 *   its badge draw nothing.
 * - A badge's note falls silent and its mark draws nothing while its module is not shown.
 */
import { createElement, type ComponentType } from "react";
import type { Contributed } from "@prismshadow/penguin-core/kernel";
import {
  gatedComponent,
  isGated,
  useContributionShown,
  warnUngatable,
} from "../../lib/module-gate";
import type {
  NavBadge,
  SidebarMode,
  SidebarScopeProps,
  SidebarSection,
} from "../../lib/sidebar-contributions";

const gatedOptional = <P extends object>(
  from: string,
  Component: ComponentType<P> | undefined,
): { Component?: ComponentType<P> } =>
  Component === undefined ? {} : { Component: gatedComponent(from, Component) };

/** A section's scope, left out (its children rendered bare) for a module that declares a server module. */
function scopeOf(from: string, Scope: ComponentType<SidebarScopeProps>) {
  return function GatedScope(props: SidebarScopeProps) {
    if (!isGated(from)) return createElement(Scope, props);
    warnUngatable(from, "SidebarModule.sections Scope");
    return props.children;
  };
}

export function gatedSections(contributions: readonly Contributed[]): Contributed[] {
  return contributions.map((c) => {
    const section = c.code as SidebarSection;
    const overlays = gatedOptional(c.from, section.Overlays).Component;
    const rail = gatedOptional(c.from, section.Rail).Component;
    const gated: SidebarSection = {
      Full: gatedComponent(c.from, section.Full),
      ...(section.Scope !== undefined ? { Scope: scopeOf(c.from, section.Scope) } : {}),
      ...(overlays !== undefined ? { Overlays: overlays } : {}),
      ...(rail !== undefined ? { Rail: rail } : {}),
    };
    return { ...c, code: gated };
  });
}

export function gatedModes(contributions: readonly Contributed[]): Contributed[] {
  return contributions.map((c) => {
    const mode = c.code as SidebarMode;
    const from = c.from;
    const railTop = gatedOptional(from, mode.RailTop).Component;
    const gated: SidebarMode = {
      ...mode,
      useMode: () => {
        const state = mode.useMode();
        return useContributionShown(from) ? state : { ...state, available: false };
      },
      ...(railTop !== undefined ? { RailTop: railTop } : {}),
      ...(mode.badge !== undefined
        ? { badge: { ...mode.badge, Node: gatedComponent(from, mode.badge.Node) } }
        : {}),
    };
    return { ...c, code: gated };
  });
}

export function gatedBadges(contributions: readonly Contributed[]): Contributed[] {
  return contributions.map((c) => {
    const badge = c.code as NavBadge;
    const from = c.from;
    const useNote = badge.useNote;
    const mark = gatedOptional(from, badge.Mark).Component;
    const gated: NavBadge = {
      ...(useNote !== undefined
        ? {
            useNote: () => {
              const note = useNote();
              return useContributionShown(from) ? note : null;
            },
          }
        : {}),
      ...(mark !== undefined ? { Mark: mark } : {}),
    };
    return { ...c, code: gated };
  });
}

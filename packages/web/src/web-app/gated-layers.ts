/**
 * The layers of a web module that waits for its server module (`WebAppModule.serverModules`):
 * each is mounted only while that module runs (lib/module-gate.ts), and mounts the moment it
 * starts. A layer of a module that declares nothing is mounted as it is.
 */
import { createElement, type ComponentType } from "react";
import type { Contributed } from "@prismshadow/penguin-core/kernel";
import type { ServerModuleData } from "@prismshadow/penguin-web-plugin";
import { useContributionShown } from "../lib/module-gate";
import type { WebAppLayer } from "./deps";

/** Each web module's declared server modules, by the web module's name. */
export function gatesOf(contributions: readonly Contributed[]): Map<string, string[]> {
  const gates = new Map<string, string[]>();
  for (const c of contributions) {
    const list = gates.get(c.from) ?? [];
    list.push((c.data as unknown as ServerModuleData).module);
    gates.set(c.from, list);
  }
  return gates;
}

function gatedLayer(from: string, Layer: ComponentType): ComponentType {
  return function GatedLayer() {
    return useContributionShown(from) ? createElement(Layer) : null;
  };
}

/** The layers in their order, a gated module's each behind its gate. */
export function layersOf(
  layers: ReadonlyArray<{ id: string; from: string; Component: ComponentType }>,
  gates: ReadonlyMap<string, readonly string[]>,
): WebAppLayer[] {
  return layers.map((layer) => ({
    id: layer.id,
    Component: gates.has(layer.from) ? gatedLayer(layer.from, layer.Component) : layer.Component,
  }));
}

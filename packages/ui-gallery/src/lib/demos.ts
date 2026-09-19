/**
 * Demo collection and variant keys — pure, so the glob wiring (registry.ts) stays a thin shell
 * and every rule here is unit-tested.
 *
 * A demo is a component's atomic preview (`*.demo.tsx`, demo.ts), shown in a module's Parts drawer.
 * A variant key is a selection's axis values joined with `.` in the axes' declaration order
 * (`danger.sm`); `all` selects the matrix of every combination. An unknown or malformed key reads
 * as the demo's default pick, so a stale link still opens the part.
 */
import type { ComponentSection } from "../../../ui/src/catalog";
import type { Demo, DemoAxes } from "../../../ui/src/demo";

export const MATRIX_KEY = "all";

/** Axis values double as URL and file-name segments. */
const AXIS_VALUE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type VariantPick =
  { kind: "matrix" } | { kind: "single"; selection: Readonly<Record<string, string>> };

/** The pick a part opens on: the matrix for a matrix demo, otherwise every axis's first value. */
export function defaultPick(axes: DemoAxes | undefined, matrix: boolean | undefined): VariantPick {
  if (matrix && axes && Object.keys(axes).length > 0) return { kind: "matrix" };
  return { kind: "single", selection: firstSelection(axes) };
}

function firstSelection(axes: DemoAxes | undefined): Record<string, string> {
  const selection: Record<string, string> = {};
  for (const [axis, values] of Object.entries(axes ?? {})) {
    if (values[0] !== undefined) selection[axis] = values[0];
  }
  return selection;
}

export function parseVariantKey(
  axes: DemoAxes | undefined,
  matrix: boolean | undefined,
  key: string | undefined,
): VariantPick {
  if (key === undefined) return defaultPick(axes, matrix);
  if (key === MATRIX_KEY && matrix) return { kind: "matrix" };
  const names = Object.keys(axes ?? {});
  const values = key.split(".");
  if (names.length === 0 || values.length !== names.length) return defaultPick(axes, matrix);
  const selection: Record<string, string> = {};
  for (const [i, axis] of names.entries()) {
    const value = values[i];
    if (value === undefined || !axes?.[axis]?.includes(value)) return defaultPick(axes, matrix);
    selection[axis] = value;
  }
  return { kind: "single", selection };
}

export function formatVariantKey(axes: DemoAxes | undefined, pick: VariantPick): string {
  if (pick.kind === "matrix") return MATRIX_KEY;
  return Object.keys(axes ?? {})
    .map((axis) => pick.selection[axis] ?? axes?.[axis]?.[0] ?? "")
    .join(".");
}

/** The pick as breadcrumb qualifiers: `["danger", "sm"]` or `["all"]`. */
export function pickLabels(axes: DemoAxes | undefined, pick: VariantPick): string[] {
  if (pick.kind === "matrix") return [MATRIX_KEY];
  return Object.keys(axes ?? {}).map((axis) => pick.selection[axis] ?? "");
}

/** Every combination of the axes, in declaration order — the matrix view's cells. */
export function allSelections(axes: DemoAxes | undefined): Record<string, string>[] {
  let rows: Record<string, string>[] = [{}];
  for (const [axis, values] of Object.entries(axes ?? {})) {
    rows = rows.flatMap((row) => values.map((value) => ({ ...row, [axis]: value })));
  }
  return rows;
}

export interface CollectedDemo {
  demo: Demo;
  /** The glob path the demo came from, for the code drawer and problem reports. */
  path: string;
}

export interface DemoRegistry {
  /** Catalogued demos by part id. */
  byId: ReadonlyMap<string, CollectedDemo>;
  /** Human-readable problems, shown above the modules. */
  problems: readonly string[];
}

/**
 * Validates and indexes glob results against the catalog. A module without a `demo` export, a
 * duplicate id, an id no catalog section has, or an axis value that cannot be a key segment is
 * reported and skipped rather than thrown, so one broken demo never blanks the page.
 */
export function collectDemos(
  modules: Readonly<Record<string, { demo?: Demo }>>,
  sections: readonly Pick<ComponentSection, "id">[],
): DemoRegistry {
  const known = new Set(sections.map((section) => section.id));
  const byId = new Map<string, CollectedDemo>();
  const problems: string[] = [];

  for (const path of Object.keys(modules).sort()) {
    const demo = modules[path]?.demo;
    if (!demo || typeof demo.render !== "function" || typeof demo.id !== "string") {
      problems.push(`${path}: no \`demo\` export (export const demo = defineDemo({ … }))`);
      continue;
    }
    const earlier = byId.get(demo.id);
    if (earlier !== undefined) {
      problems.push(`${path}: demo id "${demo.id}" is already used by ${earlier.path}`);
      continue;
    }
    const badValues = Object.entries(demo.axes ?? {}).flatMap(([axis, values]) =>
      values.length === 0
        ? [`${axis} (empty)`]
        : values.filter((v) => !AXIS_VALUE.test(v)).map((v) => `${axis}=${v}`),
    );
    if (badValues.length > 0) {
      problems.push(
        `${path}: axis values must be lowercase words joined by "-": ${badValues.join(", ")}`,
      );
      continue;
    }
    if (!known.has(demo.id)) {
      problems.push(`${path}: "${demo.id}" is not a catalog.ts section, so no module lists it`);
      continue;
    }
    byId.set(demo.id, { demo, path });
  }
  return { byId, problems };
}

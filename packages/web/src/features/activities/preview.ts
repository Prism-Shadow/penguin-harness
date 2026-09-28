/** Pure helpers behind the activities landing and the embedded module preview. */

export type ModuleViewport = { width: number; height: number };

/**
 * The module's declared viewport from spec.runtime.resolution ("640x480");
 * anything unreadable falls back to Loom's smallest sandbox group.
 */
export function parseResolution(value: unknown): ModuleViewport {
  const match = typeof value === "string" && /^(\d{2,5})x(\d{2,5})$/i.exec(value.trim());
  return match
    ? { width: Number(match[1]), height: Number(match[2]) }
    : { width: 1024, height: 768 };
}

/**
 * Screens an activity can be tried at besides its own: the classroom tablets and laptops
 * it will meet, landscape and portrait. Only the preview changes; the spec keeps its own.
 */
export const PREVIEW_RESOLUTIONS: readonly string[] = [
  "1024x768",
  "1280x800",
  "1366x768",
  "1920x1080",
  "768x1024",
];

/** Uniform scale fitting the viewport into the box, never upscaled past 1. */
export function fitScale(viewport: ModuleViewport, box: { width: number; height: number }): number {
  if (viewport.width <= 0 || viewport.height <= 0 || box.width <= 0 || box.height <= 0) return 1;
  return Math.min(1, box.width / viewport.width, box.height / viewport.height);
}

/**
 * The assembled module's preview URL. `scene` and `language` are preview
 * overrides honored by module runtimes assembled after the embedded preview
 * shipped; older previews simply ignore the extra query parameters.
 */
export function previewUrl(
  sessionId: string,
  options: { scene?: string; language?: string } = {},
): string {
  const base = `/api/sessions/${encodeURIComponent(sessionId)}/files/preview-redirect?path=preview%2Findex.html`;
  const params = new URLSearchParams();
  if (options.scene) params.set("scene", options.scene);
  if (options.language) params.set("language", options.language);
  const query = params.toString();
  return query ? `${base}&${query}` : base;
}

/** Two-letter mark for a project card, from the title or the product code. */
export function activityInitials(title: string, productCode: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? productCode.trim();
  if (!first) return "??";
  const second = words[1] ?? first[1] ?? "";
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
}

export function filterActivities<T extends { productCode: string; refNum: number; title: string }>(
  items: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...items];
  return items.filter((item) =>
    [item.title, item.productCode, String(item.refNum)].some((field) =>
      field.toLowerCase().includes(needle),
    ),
  );
}

/** Scene ids from a saved specification, for the preview's start-scene selector. */
export function sceneIds(spec: Record<string, unknown> | null | undefined): string[] {
  const scenes = spec?.scenes ?? spec?.stages;
  if (!Array.isArray(scenes)) return [];
  return scenes
    .map((scene) =>
      scene && typeof scene === "object" && typeof scene.id === "string" ? scene.id : "",
    )
    .filter(Boolean);
}

/** The newest assembled module that can be previewed, if any. */
export function latestModuleRun<
  T extends { kind: string; status: string; sessionId?: string | null },
>(runs: readonly T[]): T | undefined {
  return runs.find((run) => run.kind === "module" && run.status === "succeeded" && run.sessionId);
}

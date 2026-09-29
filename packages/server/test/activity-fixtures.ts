import fs from "node:fs/promises";
import path from "node:path";

export const activitySpec = {
  id: "sight-words",
  moduleFolder: "waf-module-sight-words",
  title: "Sight words",
  runtime: {
    engine: "html",
    layout: "mainOnly",
    theme: "park",
    resolution: "640x480",
    usesAssessment: false,
  },
  activityDescription: "Practice sight words",
  scenes: [{ id: "intro", description: "Choose a word" }],
};

/** A book with a cover and one story page per line of narration. */
export function catBookSpec(stories: string[] = ["The cat sat.", "The cat ran."]) {
  return {
    ...activitySpec,
    scenes: [
      {
        id: "scene-1-cover",
        role: "cover",
        description: "Cover",
        media: { images: [{ key: "cover", description: "A cat on a mat" }] },
      },
      ...stories.map((script, index) => ({
        id: `scene-${index + 2}-story`,
        role: "story",
        description: `Story page ${index + 1}`,
        media: { images: [{ key: `story-${index + 1}`, description: "A cat" }] },
        audio: {
          tracks: [{ key: `narration-${index + 1}`, description: "Narration", script }],
        },
      })),
    ],
  };
}

/**
 * Makes ref 1 of a product whose module sits in a WAF checkout, with the specification the
 * checkout keeps for it (Loom's `generated/<code>/refs/<code>-1/spec/activity_spec.json`).
 * The module folder is the default one, `waf-module-<code>`. Returns the activity's id.
 */
export async function createCheckoutActivity(
  client: {
    post(url: string, body: unknown): Response | Promise<Response>;
  },
  projectId: string,
  root: string,
  productCode: string,
): Promise<string> {
  const spec = JSON.parse(
    await fs.readFile(
      path.join(
        root,
        "modules",
        `waf-module-${productCode}`,
        "generated",
        productCode,
        "refs",
        `${productCode}-1`,
        "spec",
        "activity_spec.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
  // Penguin writes its own files for the product here; opening Loom's refs in place is later.
  await fs.rm(path.join(root, "modules", `waf-module-${productCode}`, "generated", productCode), {
    recursive: true,
    force: true,
  });
  const base = `/api/projects/${projectId}/activities`;
  const created = await client.post(base, { productCode, refNum: 1, title: String(spec.title) });
  if (created.status !== 201) throw new Error(`create: ${created.status} ${await created.text()}`);
  const activity = (await created.json()) as { id: string; draft: { contentRevision: string } };
  const applied = await client.post(`${base}/${activity.id}/apply-generated-spec`, {
    expectedRevision: activity.draft.contentRevision,
    spec,
  });
  if (applied.status !== 200) throw new Error(`spec: ${applied.status} ${await applied.text()}`);
  return activity.id;
}

/**
 * Where a ref's draft files are in the WAF checkout createTestApp gives every test:
 * `modules/<module>/generated/<pc>/refs/<pc>-<ref>/spec`.
 */
export function refFilesDir(
  root: string,
  productCode: string,
  refNum: number,
  moduleFolder = `waf-module-${productCode}`,
): string {
  return path.join(
    root,
    "waf-checkout",
    "modules",
    moduleFolder,
    "generated",
    productCode,
    "refs",
    `${productCode}-${refNum}`,
    "spec",
  );
}

/**
 * Where a ref's media are in the WAF checkout createTestApp gives every test, in Loom's layout:
 * `media/loom/<pc>/<pc>-<ref>` (uploads/, candidates/, images/<language>/, audios/<language>/…).
 */
export function refMediaDir(root: string, productCode: string, refNum: number): string {
  return path.join(root, "waf-checkout", "media", "loom", productCode, `${productCode}-${refNum}`);
}

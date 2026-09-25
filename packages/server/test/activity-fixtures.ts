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

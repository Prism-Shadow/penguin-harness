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

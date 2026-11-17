// Every set is bundled with the workbench. Only these names can become asset URLs.
export const SCENES = ["postroom", "library", "teahouse", "rooftop", "plain"];

export function phaseOf(hour) {
  if (hour >= 7 && hour < 16) return "day";
  if ((hour >= 16 && hour < 19) || (hour >= 5 && hour < 7)) return "dusk";
  return "night";
}

export function scene(name, phase) {
  const set = SCENES.includes(name) ? name : "plain";
  const light = ["day", "dusk", "night"].includes(phase) ? phase : "day";
  const art = set === "plain" ? "" : `<img alt="" src="./art/${set}.svg" />`;
  return `<div class="scene" data-scene="${set}" data-phase="${light}">${art}</div>`;
}

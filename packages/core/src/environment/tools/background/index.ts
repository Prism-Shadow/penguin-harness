/**
 * Barrel for shared background-session infrastructure.
 */
export { BackgroundRegistry } from "./registry.js";
export type { BackgroundTask } from "./registry.js";
export { clampYield } from "./limits.js";
export { WakeSignal } from "./wake-signal.js";
export { CappedTextBuffer } from "./capped-buffer.js";

/**
 * Whether the studio's side panel fills the workspace, and its scrolling body, for content
 * that sizes itself to what is on screen: the preview fits the panel's height only then.
 */
import { createContext } from "react";

export const SidePanelFill = createContext<{ expanded: boolean; body: HTMLElement | null }>({
  expanded: false,
  body: null,
});

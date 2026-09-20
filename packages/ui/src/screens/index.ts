/**
 * The gallery's full-viewport compositions (`/screens/:name`): static mock-ups of the real app
 * built from token utilities, the declared style hooks and `fixtures/`, so the three themes can
 * be judged on whole screens before the components exist. Each wave swaps a stand-in piece for
 * the package component it imitates.
 *
 * Every screen takes `lang` and nothing else it needs from outside: theme, mode and the root
 * font tier are attributes on <html>, set by whoever renders the page.
 */
import type { ComponentType } from "react";
import type { FixtureLang } from "../fixtures";
import { ChatScreen } from "./chat";
import { LoginScreen } from "./login";
import { SettingsScreen } from "./settings";
import { TracesScreen } from "./traces";

export { ChatScreen, LoginScreen, SettingsScreen, TracesScreen };

export const SCREEN_IDS = ["chat", "traces", "settings", "login"] as const;
export type ScreenId = (typeof SCREEN_IDS)[number];

export interface ScreenEntry {
  id: ScreenId;
  /** English title for the gallery's chrome. */
  title: string;
  /** One line on what the screen shows. */
  description: string;
  Component: ComponentType<{ lang: FixtureLang }>;
}

export const SCREENS: readonly ScreenEntry[] = [
  {
    id: "chat",
    title: "Chat",
    description:
      "A Task mid-run: a settled answer, an opened diff, a running subagent, a pending approval, the composer and the Subagents dock.",
    Component: ChatScreen,
  },
  {
    id: "traces",
    title: "Traces",
    description:
      "The Trajectories dock: file switcher, Overall summary, a turn's execution timeline, legend and event rows.",
    Component: TracesScreen,
  },
  {
    id: "settings",
    title: "Settings",
    description:
      "The paged settings dialog on Appearance over the chat: rail, segmented controls, swatches, switches and an open info popover.",
    Component: SettingsScreen,
  },
  {
    id: "login",
    title: "Login",
    description:
      "The sign-in card over the decorative canvas, with the language and mode switches.",
    Component: LoginScreen,
  },
];

export function screenById(id: string): ScreenEntry | undefined {
  return SCREENS.find((s) => s.id === id);
}

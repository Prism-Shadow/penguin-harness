/**
 * Hero: the gallery's opening section, and the app a reader can click through.
 *
 * - App shell: the product line, its title, the pitch and two buttons over the app window at its
 *   own proportions. The sidebar's entries switch the main column between the chat and the
 *   Agents, Plugins, Models, Cost Center, Evaluation Center and Settings pages, each the
 *   composition its module draws; session rows open their transcripts; the sidebar folds to the
 *   rail and back; the dock's tabs switch panels; the model trigger opens the picker; and the
 *   composer sends, which plays the scripted reply;
 * - Empty: the same window before a Session exists, until the reader's first send starts one.
 *
 * Both are interactive: nothing plays until the reader sends. The composition itself is
 * `src/hero/`, not this file, because the landing page imports it from the package; this module
 * only gives it a page and two addresses.
 */
import { Hero } from "../hero";
import { APP_WINDOW_WIDTH, defineModule } from "../module";

export const module = defineModule({
  id: "hero",
  title: "Hero",
  description:
    "The opening: a product line, one display title, a sentence and two buttons over the app itself — its sidebar switches pages, its sessions open, it folds to the rail, and its composer takes a prompt and answers it.",
  width: "wide",
  viewport: APP_WINDOW_WIDTH,
  variants: [
    { key: "shell", title: "App shell", kind: "interactive" },
    { key: "empty", title: "Empty", kind: "interactive" },
  ],
  parts: [
    "content-typography",
    "actions-button",
    "icons-avatars",
    "forms-field",
    "forms-select",
    "navigation-nav-list",
    "navigation-group-header",
    "navigation-dock-tabs",
    "chat-message-bubble",
    "chat-assistant-text",
    "chat-work-group",
    "chat-tool-call-card",
    "chat-subagent-chip",
    "chat-task-stats-line",
    "chat-composer",
    "shell-app-shell",
    "shell-sidebar",
    "shell-dock-frame",
  ],
  render: (variant, { lang, mode }) => (
    <Hero lang={lang} mode={mode} variant={variant === "empty" ? "empty" : "shell"} />
  ),
});

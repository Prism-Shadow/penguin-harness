/**
 * Hero: the gallery's opening section.
 *
 * - Settled: the product line, its title, the pitch and two buttons over the app window with a
 *   Task in it — and, played, the prompt typing in, the work group running, the dock filling and
 *   the reply streaming to its stats line;
 * - Empty: the same opening over the window before a Session exists.
 *
 * The composition itself is `src/hero/`, not this file, because the landing page imports it from
 * the package; this module only gives it a card, a scene and two addresses.
 */
import { Hero, HERO_SCENE } from "../hero";
import { APP_WINDOW_WIDTH, defineModule } from "../module";

export const module = defineModule({
  id: "hero",
  title: "Hero",
  description:
    "The opening: a product line, one display title, a sentence and two buttons over an app window a reader can use — session rows switch the transcript, dock tabs switch panels, and the composer takes a prompt and answers it.",
  width: "wide",
  viewport: APP_WINDOW_WIDTH,
  variants: [
    { key: "settled", title: "Settled", scene: HERO_SCENE },
    { key: "empty", title: "Empty" },
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
  render: (variant, { lang }) => (
    <Hero lang={lang} variant={variant === "empty" ? "empty" : "settled"} />
  ),
});

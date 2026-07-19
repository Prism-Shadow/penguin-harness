/**
 * Feature grid mirroring the Web App's menu: multi-session chat, agent hub, skill
 * library, scheduled tasks, subagents, cost center, trace view, agent evaluation,
 * multi-user management — icon + title + one-line description.
 */
import { S } from "../lib/strings";
import { Section } from "../components/section";
import {
  ActivityIcon,
  BarChartIcon,
  BotIcon,
  ClockIcon,
  MessageSquareIcon,
  PieChartIcon,
  ShareIcon,
  SparklesIcon,
  UsersIcon,
} from "../components/icons";

/** Icon order matches S.features.items. */
const ICONS = [
  MessageSquareIcon,
  BotIcon,
  SparklesIcon,
  ClockIcon,
  ShareIcon,
  PieChartIcon,
  ActivityIcon,
  BarChartIcon,
  UsersIcon,
];

export function Features() {
  return (
    <Section
      id="features"
      eyebrow={S.features.eyebrow}
      title={S.features.title}
      subtitle={S.features.subtitle}
    >
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {S.features.items.map((item, i) => {
          const IconCmp = ICONS[i] ?? SparklesIcon;
          return (
            <article
              key={item.title}
              className="relative overflow-hidden rounded-xl border border-gray-200 bg-white p-5 transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
            >
              {/* Oversized faint icon as the card backdrop (decorative). */}
              <IconCmp
                strokeWidth={1.25}
                className="pointer-events-none absolute -right-5 -bottom-5 h-26 w-26 text-gray-100 dark:text-gray-800"
              />
              <h3 className="relative text-[15px] font-semibold tracking-tight">{item.title}</h3>
              <p className="relative mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">
                {item.desc}
              </p>
            </article>
          );
        })}
      </div>
    </Section>
  );
}

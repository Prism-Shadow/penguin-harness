/** Security strip: the enterprise-grade runtime boundary in four points. */
import { S } from "../lib/strings";
import { Section } from "../components/section";
import { FileCheckIcon, FrameIcon, KeyIcon, ShieldCheckIcon } from "../components/icons";

const ICONS = [ShieldCheckIcon, FrameIcon, FileCheckIcon, KeyIcon];

export function Security() {
  return (
    <Section
      id="security"
      eyebrow={S.security.eyebrow}
      title={S.security.title}
      subtitle={S.security.subtitle}
    >
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {S.security.items.map((item, i) => {
          const IconCmp = ICONS[i] ?? ShieldCheckIcon;
          return (
            <article
              key={item.title}
              className="relative overflow-hidden rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900"
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

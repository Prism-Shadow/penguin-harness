/**
 * Community links, closing the page: Discord / X / WeChat group / GitHub as
 * outbound cards — discuss, follow, and build with us.
 */
import { S } from "../lib/strings";
import { REPO_URL } from "../lib/links";
import { Section } from "../components/section";
import { ArrowRightIcon } from "../components/icons";

const HREFS = {
  discord: "https://discord.gg/eFHKqqcU3D",
  x: "https://x.com/code_hiyouga",
  wechat: "https://github.com/Prism-Shadow/penguin-harness-community/blob/main/wechat/group.jpg",
  github: REPO_URL,
} as const;

export function Community() {
  const items = (Object.keys(HREFS) as Array<keyof typeof HREFS>).map((key) => ({
    key,
    href: HREFS[key],
    ...S.community.items[key],
  }));
  return (
    <Section
      id="community"
      eyebrow={S.community.eyebrow}
      title={S.community.title}
      subtitle={S.community.subtitle}
    >
      <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <a
            key={item.key}
            href={item.href}
            target="_blank"
            rel="noreferrer"
            className="group rounded-xl border border-gray-200 bg-white p-5 transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
          >
            <p className="flex items-center justify-between text-[15px] font-semibold tracking-tight">
              {item.name}
              <ArrowRightIcon className="h-4 w-4 text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-gray-600 dark:group-hover:text-gray-300" />
            </p>
            <p className="mt-1.5 text-sm leading-6 text-gray-600 dark:text-gray-400">{item.desc}</p>
          </a>
        ))}
      </div>
    </Section>
  );
}

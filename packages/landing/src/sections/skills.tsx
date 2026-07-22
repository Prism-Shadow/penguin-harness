/** Built-in Skill library at a glance: the four Skill groups with their member Skills as chips. */
import { S } from "../lib/strings";
import { Section } from "../components/section";

export function Skills() {
  return (
    <Section
      id="skills"
      eyebrow={S.skills.eyebrow}
      title={S.skills.title}
      subtitle={S.skills.subtitle}
    >
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {S.skills.groups.map((group) => (
          <article
            key={group.title}
            className="rounded-xl border border-gray-200 bg-white p-5 transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
          >
            <h3 className="text-[15px] font-semibold tracking-tight">{group.title}</h3>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {group.skills.map((name) => (
                <li
                  key={name}
                  className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 font-mono text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400"
                >
                  {name}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </Section>
  );
}

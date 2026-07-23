/**
 * Customer deployments: real-world production stories (health-screening report QC,
 * factory line inspection), each a photo card with a one-paragraph story and a
 * metric strip. Unlike the Cases screenshots the photos are theme-agnostic, so a
 * single asset serves light and dark. SHOTS is index-aligned with S.customers.items.
 */
import { S } from "../lib/strings";
import { Section } from "../components/section";
import medicalShot from "../assets/case-medical-qc.webp";
import lineShot from "../assets/case-line-inspection.webp";

const SHOTS = [medicalShot, lineShot];

export function Customers() {
  return (
    <Section
      id="customers"
      eyebrow={S.customers.eyebrow}
      title={S.customers.title}
      subtitle={S.customers.subtitle}
    >
      <div className="grid gap-6 md:grid-cols-2">
        {S.customers.items.map((c, i) => (
          <figure
            key={c.title}
            className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
          >
            <img
              src={SHOTS[i]}
              alt={c.alt}
              loading="lazy"
              className="aspect-[16/9] w-full object-cover"
            />
            <figcaption className="p-6">
              <h3 className="text-base font-semibold">{c.title}</h3>
              <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">{c.body}</p>
              <dl className="mt-4 flex gap-8">
                {c.metrics.map((m) => (
                  <div key={m.label}>
                    <dd className="text-xl font-semibold tracking-tight text-brand-700 dark:text-brand-300">
                      {m.value}
                    </dd>
                    <dt className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{m.label}</dt>
                  </div>
                ))}
              </dl>
            </figcaption>
          </figure>
        ))}
      </div>
    </Section>
  );
}
